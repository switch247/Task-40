import { Controller, Get, Param, Patch, UseGuards, Version } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { PermissionGuard } from "../../common/guards/permission.guard";
import { SessionGuard } from "../../common/guards/session.guard";
import { JobsService } from "../../modules/jobs/jobs.service";
import { PrismaService } from "../../modules/prisma/prisma.service";
import { CsrfGuard } from "../../security/csrf/csrf.guard";

@ApiTags("alerts-v2")
@Controller("alerts")
@UseGuards(SessionGuard, PermissionGuard)
@Permissions("alerts.read")
export class AlertsV2Controller {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService
  ) {}

  @Get("dashboard")
  @Version("2")
  async dashboard() {
    const [alerts, banners, status] = await Promise.all([
      this.prisma.alertEvent.findMany({
        where: { status: "OPEN" },
        orderBy: { createdAt: "desc" },
        take: 200
      }),
      this.prisma.notificationBanner.findMany({
        where: { active: true },
        orderBy: { createdAt: "desc" },
        take: 20
      }),
      this.jobs.getStatusSummary()
    ]);

    return {
      alerts,
      banners,
      status,
      categories: [
        "backup_failure",
        "reconciliation_mismatch",
        "queue_job_failure",
        "suspicious_auth",
        "channel_signature_violation"
      ]
    };
  }

  @Patch(":id/resolve")
  @Version("2")
  @UseGuards(CsrfGuard)
  async resolve(@Param("id") alertId: string) {
    const updated = await this.prisma.alertEvent.update({
      where: { id: alertId },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date()
      }
    });
    return {
      status: "ok",
      alert: updated
    };
  }
}
