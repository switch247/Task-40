import { Controller, Get, Version } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../cache/redis.service";
import { JobsService } from "../jobs/jobs.service";
import { ObservabilityService } from "../observability/observability.service";
import { SkipThrottle } from "../rate-limit/skip-throttle.decorator";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jobs: JobsService,
    private readonly observability: ObservabilityService
  ) {}

  @Get()
  @Version(["1", "2"])
  @SkipThrottle()
  async readiness(): Promise<Record<string, unknown>> {
    await this.prisma.$queryRaw`SELECT 1`;
    await this.redis.raw.ping();

    return {
      status: "ok",
      postgres: "up",
      redis: "up",
      timestamp: new Date().toISOString()
    };
  }

  @Get("summary")
  @Version(["1", "2"])
  @SkipThrottle()
  async summary(): Promise<Record<string, unknown>> {
    await this.prisma.$queryRaw`SELECT 1`;
    await this.redis.raw.ping();
    const jobs = await this.jobs.getStatusSummary();
    await this.observability.recordMetric("health_summary_requested", 1);

    return {
      status: "ok",
      offlineReady: true,
      dependencies: {
        postgres: "up",
        redis: "up"
      },
      jobs,
      timestamp: new Date().toISOString()
    };
  }
}
