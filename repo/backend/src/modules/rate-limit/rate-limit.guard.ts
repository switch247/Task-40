import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash } from "crypto";
import { Request } from "express";
import { RedisService } from "../cache/redis.service";
import { RateLimitService } from "./rate-limit.service";
import { SKIP_THROTTLE_KEY } from "./skip-throttle.decorator";

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    private readonly rateLimitService: RateLimitService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_THROTTLE_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { auth?: { userId?: string } }>();
    const userId = this.getAuthenticatedUserId(request);
    const limit = await this.rateLimitService.getPerUserLimit(userId ?? undefined);
    const key = this.generateKey(request, userId);
    const count = await this.redis.raw.incr(key);

    if (count === 1) {
      await this.redis.raw.expire(key, 60);
    }

    if (count > limit) {
      throw new HttpException(`Rate limit exceeded (${limit} req/min)`, HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }

  private generateKey(
    request: Request & { auth?: { userId?: string }; user?: { id?: string } },
    authenticatedUserId: string | null
  ): string {
    if (authenticatedUserId) {
      return `rate:user:${authenticatedUserId}`;
    }

    const systemIdentity = this.readHeader(request, "x-system-id");
    if (systemIdentity) {
      return `rate:system:${systemIdentity}`;
    }

    const ip = this.getClientIp(request);
    const userAgent = this.readHeader(request, "user-agent") ?? "unknown-agent";
    const sessionId = request.cookies?.sid as string | undefined;
    const fingerprintSource = `${sessionId ?? ""}|${userAgent}`;
    const fingerprint = createHash("sha256").update(fingerprintSource).digest("hex").slice(0, 16);

    return `rate:anon:${ip}:${fingerprint}`;
  }

  private getAuthenticatedUserId(request: Request & { auth?: { userId?: string }; user?: { id?: string } }): string | null {
    return request.user?.id ?? request.auth?.userId ?? null;
  }

  private getClientIp(request: Request): string {
    const forwarded = this.readHeader(request, "x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) {
        return first;
      }
    }

    return request.ip || "unknown-ip";
  }

  private readHeader(request: Request, key: string): string | undefined {
    const value = request.headers[key] ?? request.headers[key.toLowerCase()];
    if (Array.isArray(value)) {
      return value[0];
    }
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    return undefined;
  }
}
