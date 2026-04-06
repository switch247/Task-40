import { Controller, Get, Param, Patch, UseGuards, Version } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { PermissionGuard } from "../../common/guards/permission.guard";
import { SessionGuard } from "../../common/guards/session.guard";
import { JobsService } from "../../modules/jobs/jobs.service";
import { PrismaService } from "../../modules/prisma/prisma.service";
import { CsrfGuard } from "../../security/csrf/csrf.guard";

@ApiTags("alerts-v1")
@Controller("alerts")
@UseGuards(SessionGuard, PermissionGuard)
@Permissions("alerts.read")
export class AlertsV1Controller {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService
  ) {}

  @Get("dashboard")
  @Version("1")
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
      status
    };
  }

  @Patch(":id/resolve")
  @Version("1")
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
