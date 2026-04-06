import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
  Version
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Request, Response } from "express";
import { createHash } from "crypto";
import { PermissionGuard } from "../../common/guards/permission.guard";
import { AuditLogsService } from "../../modules/audit-logs/audit-logs.service";
import { SessionGuard } from "../../common/guards/session.guard";
import { AuthService } from "../../security/auth/auth.service";
import { LoginDto } from "../../security/auth/dto/login.dto";
import { resolveSessionCookieOptions } from "../../security/auth/session-cookie.util";
import { SessionService } from "../../security/auth/session.service";
import { CsrfGuard } from "../../security/csrf/csrf.guard";
import { FieldEncryptionService } from "../../security/crypto/field-encryption.service";
import { VerifyTotpDto } from "../../security/mfa/dto/verify-totp.dto";
import { MfaService } from "../../security/mfa/mfa.service";
import { PrismaService } from "../../modules/prisma/prisma.service";

@ApiTags("auth-v1")
@Controller("auth")
export class AuthV1Controller {
  private readonly sessionCookieOptions = resolveSessionCookieOptions();

  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly auditLogs: AuditLogsService,
    private readonly mfaService: MfaService,
    private readonly encryption: FieldEncryptionService,
    private readonly prisma: PrismaService
  ) {}

  @Post("login")
  @Version("1")
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response
  ): Promise<Record<string, unknown>> {
    let result;
    try {
      result = await this.authService.login(dto);
    } catch (error) {
      await this.auditLogs.write({
        userId: undefined,
        actionType: "AUTH_LOGIN_FAILED",
        entityType: "auth",
        notes: "Local login failed",
        metadata: {
          username: dto.username
        }
      });
      throw error;
    }

    if (result.status === "mfa_required") {
      return { status: "mfa_required" };
    }

    response.cookie("sid", result.sessionId, this.sessionCookieOptions);

    await this.auditLogs.write({
      userId: result.user?.id,
      actionType: "AUTH_LOGIN_SUCCESS",
      entityType: "auth",
      entityId: result.user?.id,
      notes: "Local login success",
      metadata: {
        username: result.user?.username
      }
    });

    return {
      status: "ok",
      csrfToken: result.csrfToken,
      user: result.user
    };
  }

  @Post("logout")
  @Version("1")
  @UseGuards(SessionGuard, CsrfGuard)
  @HttpCode(200)
  async logout(
    @Req() request: Request & { auth?: { sessionId: string; userId?: string } },
    @Res({ passthrough: true }) response: Response
  ): Promise<{ status: string }> {
    await this.sessionService.revoke(request.auth!.sessionId);
    await this.auditLogs.write({
      userId: request.auth?.userId,
      actionType: "AUTH_LOGOUT",
      entityType: "auth",
      notes: "User logged out",
      metadata: {
        sessionId: request.auth?.sessionId
      }
    });
    response.clearCookie("sid", this.sessionCookieOptions);
    return { status: "ok" };
  }

  @Get("me")
  @Version("1")
  @UseGuards(SessionGuard, PermissionGuard)
  async me(@Req() request: Request & { auth?: Record<string, unknown> }): Promise<Record<string, unknown>> {
    const userId = request.auth?.userId as string;
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { username: true, mfaEnabled: true }
    });
    return {
      userId,
      username: user.username,
      roles: request.auth?.roles,
      permissions: request.auth?.permissions,
      mfaEnabled: user.mfaEnabled
    };
  }

  @Get("csrf")
  @Version("1")
  @UseGuards(SessionGuard)
  async csrf(@Req() request: Request & { auth?: { sessionId: string } }): Promise<{ csrfToken: string }> {
    const rawToken = this.mfaService.generateOpaqueToken();
    const hash = createHash("sha256").update(rawToken).digest("hex");
    await this.sessionService.rotateCsrfTokenHash(request.auth!.sessionId, hash);
    return { csrfToken: rawToken };
  }

  @Post("mfa/enroll")
  @Version("1")
  @UseGuards(SessionGuard, CsrfGuard)
  async enrollMfa(
    @Req() request: Request & { auth?: { userId: string } }
  ): Promise<Record<string, string>> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: request.auth!.userId } });
    const generated = this.mfaService.generateSecret(user.username);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        mfaSecretCipher: this.encryption.encrypt(generated.secret)
      }
    });

    await this.auditLogs.write({
      userId: user.id,
      actionType: "AUTH_MFA_ENROLL",
      entityType: "auth",
      entityId: user.id,
      notes: "MFA enrollment initiated",
      metadata: {
        username: user.username
      }
    });

    return {
      otpauth: generated.otpauth
    };
  }

  @Post("mfa/verify")
  @Version("1")
  @UseGuards(SessionGuard, CsrfGuard)
  async verifyMfa(
    @Req() request: Request & { auth?: { userId: string } },
    @Body() dto: VerifyTotpDto
  ): Promise<{ status: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: request.auth!.userId } });
    if (!user.mfaSecretCipher) {
      return { status: "missing_secret" };
    }
    const secret = this.encryption.decrypt(user.mfaSecretCipher);
    const valid = this.mfaService.verifyCode(secret, dto.code);
    if (!valid) {
      return { status: "invalid_code" };
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true }
    });

    await this.auditLogs.write({
      userId: user.id,
      actionType: "AUTH_MFA_VERIFIED",
      entityType: "auth",
      entityId: user.id,
      notes: "MFA verified and enabled"
    });

    return { status: "ok" };
  }
}
