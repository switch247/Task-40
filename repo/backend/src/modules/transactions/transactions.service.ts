import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuthActor, ensureActorObjectAccess } from "../../common/authz/object-access.policy";
import { HotReadCacheService } from "../cache/hot-read-cache.service";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { CreateChargeDto } from "./dto/create-charge.dto";
import { ApproveChargeDto } from "./dto/approve-charge.dto";
import { PaymentChannel } from "../payment-channels/payment-channel.enum";

@Injectable()
export class TransactionsService {
  private readonly unitChargeCents = Number(process.env.LICENSED_STORY_BUNDLE_CENTS ?? 2500);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly auditLogs: AuditLogsService,
    private readonly cache: HotReadCacheService
  ) {}

  async createCharge(userId: string | undefined, dto: CreateChargeDto) {
    if (dto.storyVersionId) {
      const exists = await this.prisma.storyVersion.findUnique({ where: { id: dto.storyVersionId } });
      if (!exists) {
        throw new NotFoundException("Story version for charge not found");
      }
    }

    const bundleCount = dto.bundleCount ?? 1;
    const totalAmountCents = this.unitChargeCents * bundleCount;
    const reference = `TX-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    const transaction = await this.prisma.transaction.create({
      data: {
        reference,
        channel: dto.channel,
        bundleCount,
        unitPriceCents: this.unitChargeCents,
        totalAmountCents,
        currency: "USD",
        status: "PENDING_APPROVAL",
        statusExplanation: "Charge is awaiting finance approval.",
        storyVersionId: dto.storyVersionId,
        createdByUserId: userId
      }
    });

    await this.auditLogs.write({
      userId,
      actionType: "CHARGE_REQUESTED",
      entityType: "transaction",
      entityId: transaction.id,
      notes: "Internal charge requested",
      metadata: {
        reference,
        channel: dto.channel,
        bundleCount,
        unitPriceCents: this.unitChargeCents,
        totalAmountCents,
        storyVersionId: dto.storyVersionId
      }
    });

    await this.invalidateTransactionHotReads();

    return transaction;
  }

  async postApprovedChargeFromChannel(input: {
    channel: PaymentChannel;
    systemIdentity: string;
    bundleCount: number;
    amountCents?: number;
    storyVersionId?: string;
    idempotencyKey: string;
  }) {
    if (input.storyVersionId) {
      const exists = await this.prisma.storyVersion.findUnique({ where: { id: input.storyVersionId } });
      if (!exists) {
        throw new NotFoundException("Story version for channel charge not found");
      }
    }

    const totalAmountCents = input.amountCents ?? this.unitChargeCents * input.bundleCount;
    const reference = `TX-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    const transaction = await this.prisma.transaction.create({
      data: {
        reference,
        channel: input.channel,
        bundleCount: input.bundleCount,
        unitPriceCents: Math.floor(totalAmountCents / input.bundleCount),
        totalAmountCents,
        currency: "USD",
        status: "APPROVED",
        statusExplanation: `Channel charge accepted from ${input.systemIdentity}.`,
        storyVersionId: input.storyVersionId,
        createdByUserId: input.systemIdentity,
        approvedByUserId: input.systemIdentity,
        approvedAt: new Date()
      }
    });

    await this.ledger.appendEntry({
      transactionId: transaction.id,
      entryType: "CHARGE",
      amountCents: totalAmountCents,
      createdByUserId: input.systemIdentity,
      metadata: {
        source: "payment_channel",
        idempotencyKey: input.idempotencyKey
      }
    });

    await this.auditLogs.write({
      userId: input.systemIdentity,
      actionType: "CHANNEL_CHARGE_POSTED",
      entityType: "transaction",
      entityId: transaction.id,
      notes: `Signed channel payload accepted for ${input.channel}`,
      metadata: {
        systemIdentity: input.systemIdentity,
        channel: input.channel,
        idempotencyKey: input.idempotencyKey,
        totalAmountCents,
        storyVersionId: input.storyVersionId
      }
    });

    await this.invalidateTransactionHotReads();

    return transaction;
  }

  async approveCharge(userId: string | undefined, transactionId: string, dto: ApproveChargeDto) {
    const tx = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!tx) {
      throw new NotFoundException("Transaction not found");
    }
    if (tx.status !== "PENDING_APPROVAL") {
      throw new BadRequestException("Only pending charges can be approved");
    }

    const updated = await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: "APPROVED",
        statusExplanation: "Charge approved and posted to ledger.",
        approvedByUserId: userId,
        approvedAt: new Date()
      }
    });

    await this.ledger.appendEntry({
      transactionId,
      entryType: "CHARGE",
      amountCents: tx.totalAmountCents,
      createdByUserId: userId,
      metadata: {
        note: dto.note,
        reference: tx.reference
      }
    });

    await this.auditLogs.write({
      userId,
      actionType: "CHARGE_APPROVED",
      entityType: "transaction",
      entityId: transactionId,
      notes: dto.note,
      metadata: {
        reference: tx.reference,
        beforeStatus: tx.status,
        afterStatus: "APPROVED",
        amountCents: tx.totalAmountCents
      }
    });

    await this.invalidateTransactionHotReads();

    return updated;
  }

  async list(actor?: AuthActor) {
    const key = `hot:transactions:list:${this.actorScope(actor)}`;
    return this.cache.getOrLoad(key, async () => {
      const transactions = await this.prisma.transaction.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          refunds: true,
          freezes: {
            orderBy: { frozenAt: "desc" },
            take: 1
          }
        }
      });

      return {
        items: transactions.map((tx: any) => ({
          ...tx,
          refundedCents: tx.refunds.reduce((sum: number, refund: any) => sum + refund.amountCents, 0),
          activeFreeze: tx.freezes.find((freeze: any) => freeze.status === "FROZEN") ?? null
        }))
      };
    });
  }

  async listStoryVersionOptions() {
    const versions = await this.prisma.storyVersion.findMany({
      orderBy: { createdAt: "desc" },
      take: 120,
      select: {
        id: true,
        storyId: true,
        versionNumber: true,
        title: true,
        canonicalUrl: true,
        source: true,
        publishedAt: true,
        createdAt: true
      }
    });

    return {
      items: versions.map((version: any) => ({
        versionId: version.id,
        storyId: version.storyId,
        versionNumber: version.versionNumber,
        title: version.title,
        canonicalUrl: version.canonicalUrl,
        source: version.source,
        publishedAt: version.publishedAt,
        createdAt: version.createdAt
      }))
    };
  }

  async history(actor: AuthActor | undefined, transactionId: string) {
    const key = `hot:transactions:history:${transactionId}:${this.actorScope(actor)}`;
    return this.cache.getOrLoad(key, async () => {
      const tx = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
      if (!tx) {
        throw new NotFoundException("Transaction not found");
      }

      ensureActorObjectAccess(actor, {
        ownerIds: [tx.createdByUserId, tx.approvedByUserId],
        context: "transaction history",
        allowIfAnyPermission: ["transactions.read", "audit.read", "auditor.release_freeze"],
        allowIfAnyRole: ["auditor"]
      });

      const [ledgerEntries, refunds, freezes, audits] = await Promise.all([
        this.prisma.fundLedger.findMany({ where: { transactionId }, orderBy: { createdAt: "asc" } }),
        this.prisma.refundCase.findMany({ where: { transactionId }, orderBy: { createdAt: "asc" } }),
        this.prisma.freezeCase.findMany({ where: { transactionId }, orderBy: { frozenAt: "asc" } }),
        this.prisma.immutableAuditLog.findMany({
          where: {
            entityType: "transaction",
            entityId: transactionId
          },
          orderBy: { createdAt: "asc" }
        })
      ]);

      const storyVersionIds = Array.from(
        new Set([tx.storyVersionId, ...refunds.map((refund: any) => refund.storyVersionId)].filter((value): value is string => Boolean(value)))
      );
      const storyVersions =
        storyVersionIds.length > 0
          ? await this.prisma.storyVersion.findMany({
              where: { id: { in: storyVersionIds } },
              select: {
                id: true,
                storyId: true,
                versionNumber: true,
                title: true,
                canonicalUrl: true,
                source: true,
                publishedAt: true,
                createdAt: true
              }
            })
          : [];

      return {
        transaction: tx,
        statusExplanation: tx.statusExplanation,
        ledgerEntries,
        refunds,
        freezes,
        storyVersions,
        audits,
        lifecycleSummary: this.makeLifecycleSummary(tx.status, ledgerEntries.length, refunds.length, freezes)
      };
    });
  }

  private async invalidateTransactionHotReads(): Promise<void> {
    await this.cache.invalidatePatterns(["hot:transactions:list:*", "hot:transactions:history:*"]);
  }

  private actorScope(actor?: AuthActor): string {
    const user = actor?.userId ?? "anon";
    const roles = (actor?.roles ?? []).slice().sort().join(",");
    const permissions = (actor?.permissions ?? []).slice().sort().join(",");
    return `${user}|${roles}|${permissions}`;
  }

  private makeLifecycleSummary(
    status: string,
    ledgerCount: number,
    refundCount: number,
    freezes: Array<{ status: string }>
  ): string {
    if (status === "FROZEN") {
      return "Transaction is frozen due to a dispute and cannot be further processed until auditor release.";
    }
    if (status === "REFUNDED_FULL") {
      return "Transaction has been fully refunded and closed.";
    }
    if (status === "REFUNDED_PARTIAL") {
      return "Transaction has one or more partial refunds; remaining collectible balance is still active.";
    }
    if (status === "APPROVED") {
      return `Transaction approved with ${ledgerCount} ledger entries and ${refundCount} refund events.`;
    }
    if (freezes.some((freeze) => freeze.status === "RELEASED")) {
      return "Transaction freeze was released by auditor and processing resumed.";
    }
    return "Transaction is pending finance action.";
  }
}
