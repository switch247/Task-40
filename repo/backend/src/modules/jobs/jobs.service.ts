import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { InputJsonValue } from "@prisma/client/runtime/library";
import { join } from "path";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { PrismaService } from "../prisma/prisma.service";
import { ObservabilityService } from "../observability/observability.service";
import { JobQueueService, JobType } from "./job-queue.service";
import { BackupCommandService } from "./backup-command.service";

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private scheduler: NodeJS.Timeout | null = null;
  private dailyRetentionKey = "jobs:last-retention-day";
  private dailyBackupKey = "jobs:last-backup-day";

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueueService,
    private readonly auditLogs: AuditLogsService,
    private readonly observability: ObservabilityService,
    private readonly backupCommands: BackupCommandService
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue.onJob(async (job) => this.processJob(job.type, job.payload));
    await this.queue.enqueue("reconciliation");
    await this.queue.enqueue("notification_banners");

    this.scheduler = setInterval(() => {
      void this.tickScheduler();
    }, 60_000);
  }

  onModuleDestroy(): void {
    if (this.scheduler) {
      clearInterval(this.scheduler);
      this.scheduler = null;
    }
  }

  async getStatusSummary() {
    const [queueDepth, jobRuns, alertsOpen, activeBanners] = await Promise.all([
      this.queue.depth(),
      this.prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 8 }),
      this.prisma.alertEvent.count({ where: { status: "OPEN" } }),
      this.prisma.notificationBanner.count({ where: { active: true } })
    ]);

    return {
      queueDepth,
      alertsOpen,
      activeBanners,
      recentJobs: jobRuns,
      backupPolicy: {
        nightlyRunAt: "02:00",
        retentionDays: 30,
        restoreTargetHours: 2
      },
      observabilityRetentionDays: 14
    };
  }

  private async tickScheduler() {
    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10);

    if (now.getHours() === 2 && now.getMinutes() === 0) {
      const done = await this.prisma.systemThresholdConfig.findUnique({ where: { key: this.dailyBackupKey } });
      if (!done || done.value !== dayKey) {
        await this.queue.enqueue("nightly_backup");
        await this.prisma.systemThresholdConfig.upsert({
          where: { key: this.dailyBackupKey },
          update: { value: dayKey },
          create: { key: this.dailyBackupKey, value: dayKey, description: "Last backup day" }
        });
      }
    }

    if (now.getHours() === 2 && now.getMinutes() === 30) {
      const done = await this.prisma.systemThresholdConfig.findUnique({ where: { key: this.dailyRetentionKey } });
      if (!done || done.value !== dayKey) {
        await this.queue.enqueue("retention_cleanup");
        await this.prisma.systemThresholdConfig.upsert({
          where: { key: this.dailyRetentionKey },
          update: { value: dayKey },
          create: { key: this.dailyRetentionKey, value: dayKey, description: "Last retention cleanup day" }
        });
      }
    }

    if (now.getMinutes() % 5 === 0) {
      await this.queue.enqueue("reconciliation");
    }
    if (now.getMinutes() % 10 === 0) {
      await this.queue.enqueue("notification_banners");
    }
  }

  private async processJob(type: JobType, payload?: Record<string, unknown>) {
    const started = Date.now();
    const run = await this.prisma.jobRun.create({
      data: {
        jobType: type,
        status: "RUNNING",
        details: (payload ?? {}) as InputJsonValue
      }
    });

    try {
      if (type === "reconciliation") {
        await this.runReconciliation();
      } else if (type === "notification_banners") {
        await this.runNotificationBanners();
      } else if (type === "nightly_backup") {
        await this.runNightlyBackup();
      } else if (type === "retention_cleanup") {
        await this.runRetentionCleanup();
      }

      await this.prisma.jobRun.update({
        where: { id: run.id },
        data: {
          status: "SUCCESS",
          finishedAt: new Date(),
          durationMs: Date.now() - started
        }
      });
      await this.observability.recordMetric("job_success", 1, { jobType: type });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown job failure";
      await this.prisma.jobRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          durationMs: Date.now() - started,
          details: { error: message } as InputJsonValue
        }
      });

      await this.prisma.alertEvent.create({
        data: {
          category: "queue_job_failure",
          severity: "HIGH",
          title: `${type} job failed`,
          message,
          relatedEntityType: "job_run",
          relatedEntityId: run.id,
          metadata: { jobType: type }
        }
      });

      await this.auditLogs.write({
        actionType: "JOB_FAILURE",
        entityType: "job_run",
        entityId: run.id,
        notes: message,
        metadata: {
          jobType: type
        }
      });
      await this.observability.recordMetric("job_failure", 1, { jobType: type });
      await this.observability.recordLog("error", "job failure", { jobType: type, error: message });
    }
  }

  private async runReconciliation() {
    const transactions = await this.prisma.transaction.findMany({
      where: { status: { in: ["APPROVED", "REFUNDED_PARTIAL", "REFUNDED_FULL"] } },
      include: { ledgerEntries: { orderBy: { createdAt: "asc" } }, refunds: true }
    });

    let mismatchCount = 0;
    for (const tx of transactions) {
      const expected = tx.totalAmountCents - tx.refunds.reduce((sum: number, item: { amountCents: number }) => sum + item.amountCents, 0);
      const net = tx.ledgerEntries.length > 0 ? tx.ledgerEntries[tx.ledgerEntries.length - 1].netAmountCents : 0;
      if (expected !== net) {
        mismatchCount += 1;
        await this.prisma.alertEvent.create({
          data: {
            category: "reconciliation_mismatch",
            severity: "HIGH",
            title: "Ledger mismatch detected",
            message: `Transaction ${tx.reference} expected net ${expected} but found ${net}.`,
            relatedEntityType: "transaction",
            relatedEntityId: tx.id,
            metadata: { expected, actual: net, reference: tx.reference }
          }
        });
      }
    }

    await this.auditLogs.write({
      actionType: mismatchCount > 0 ? "RECONCILIATION_MISMATCH" : "RECONCILIATION_OK",
      entityType: "reconciliation",
      notes: mismatchCount > 0 ? `${mismatchCount} mismatches detected` : "No mismatches detected",
      metadata: {
        mismatchCount,
        checkedTransactions: transactions.length
      }
    });

    await this.observability.recordMetric("reconciliation_mismatches", mismatchCount);
    await this.observability.recordTrace("jobs.reconciliation", {
      checked: transactions.length,
      mismatches: mismatchCount
    });
  }

  private async runNotificationBanners() {
    const alerts = await this.prisma.alertEvent.findMany({
      where: {
        status: "OPEN",
        severity: { in: ["HIGH", "CRITICAL"] }
      },
      orderBy: { createdAt: "desc" },
      take: 10
    });

    await this.prisma.notificationBanner.updateMany({
      where: { active: true },
      data: { active: false }
    });

    for (const alert of alerts) {
      await this.prisma.notificationBanner.create({
        data: {
          level: alert.severity,
          message: `${alert.title}: ${alert.message}`,
          sourceAlertId: alert.id,
          active: true,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });
    }

    await this.detectSuspiciousAuthPattern();
    await this.detectChannelSignatureViolations();

    await this.observability.recordMetric("notification_banners_active", alerts.length);
  }

  private async detectSuspiciousAuthPattern() {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const failed = await this.prisma.immutableAuditLog.count({
      where: {
        actionType: "AUTH_LOGIN_FAILED",
        createdAt: { gte: hourAgo }
      }
    });

    if (failed >= 10) {
      await this.prisma.alertEvent.create({
        data: {
          category: "suspicious_auth",
          severity: "HIGH",
          title: "Suspicious auth pattern",
          message: `${failed} failed login attempts in the last hour.`,
          metadata: { windowMinutes: 60, count: failed }
        }
      });
    }
  }

  private async detectChannelSignatureViolations() {
    const recent = await this.prisma.paymentChannelRequest.findMany({
      where: {
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
        verificationStatus: "REJECTED",
        rejectionReason: { in: ["SIGNATURE_MISMATCH_OR_TAMPERED_PAYLOAD", "REPLAY_WINDOW_EXCEEDED_5_MINUTES", "NONCE_ALREADY_USED"] }
      },
      take: 20,
      orderBy: { createdAt: "desc" }
    });

    if (recent.length > 0) {
      await this.prisma.alertEvent.create({
        data: {
          category: "channel_signature_violation",
          severity: "HIGH",
          title: "Channel signature/replay violations detected",
          message: `${recent.length} channel signature/replay violations in the last hour.`,
          metadata: {
            count: recent.length,
            reasons: [...new Set(recent.map((item: { rejectionReason: string | null }) => item.rejectionReason).filter(Boolean))]
          }
        }
      });
    }
  }

  private async runNightlyBackup() {
    const script = join(process.cwd(), "scripts", "backup.sh");
    try {
      const { stdout, stderr } = await this.backupCommands.runNightlyBackup(script);
      await this.auditLogs.write({
        actionType: "BACKUP_SUCCESS",
        entityType: "backup",
        notes: "Nightly backup completed",
        metadata: {
          stdout,
          stderr
        }
      });
      await this.observability.recordMetric("backup_success", 1);
      await this.observability.recordLog("info", "nightly backup success", { stdout });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Backup failed";
      await this.prisma.alertEvent.create({
        data: {
          category: "backup_failure",
          severity: "CRITICAL",
          title: "Nightly backup failed",
          message,
          metadata: { at: new Date().toISOString() }
        }
      });
      await this.auditLogs.write({
        actionType: "BACKUP_FAILURE",
        entityType: "backup",
        notes: message
      });
      throw error;
    }
  }

  async verifyBackupRestore(backupFilePath: string): Promise<{ stdout: string; stderr: string }> {
    const script = join(process.cwd(), "scripts", "restore_verify.sh");
    const result = await this.backupCommands.runRestoreVerification(script, backupFilePath);
    await this.observability.recordMetric("backup_restore_verify_success", 1);
    return result;
  }

  private async runRetentionCleanup() {
    const result = await this.observability.cleanupRetention();
    await this.auditLogs.write({
      actionType: "OBS_RETENTION_CLEANUP",
      entityType: "observability",
      notes: "Observability retention cleanup complete",
      metadata: {
        removedFiles: result.removed,
        retentionDays: 14
      }
    });
    await this.observability.recordMetric("obs_retention_removed_files", result.removed);
  }
}
