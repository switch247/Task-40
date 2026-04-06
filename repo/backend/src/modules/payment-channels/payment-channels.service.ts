import { ConflictException, HttpException, Injectable } from "@nestjs/common";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { PrismaService } from "../prisma/prisma.service";
import { TransactionsService } from "../transactions/transactions.service";
import { ChannelChargeDto } from "./dto/channel-charge.dto";
import { SignatureVerifierService } from "../../security/signatures/signature-verifier.service";
import { PaymentChannel } from "./payment-channel.enum";

@Injectable()
export class PaymentChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signatures: SignatureVerifierService,
    private readonly transactions: TransactionsService,
    private readonly auditLogs: AuditLogsService
  ) {}

  async processSignedCharge(input: {
    channel: PaymentChannel;
    payload: ChannelChargeDto;
    systemIdentity: string;
    signature: string;
    timestamp: string;
    nonce: string;
    idempotencyKey: string;
  }) {
    const verification = this.signatures.verify({
      channel: input.channel,
      timestamp: input.timestamp,
      nonce: input.nonce,
      idempotencyKey: input.idempotencyKey,
      signature: input.signature,
      payload: input.payload
    });

    const duplicate = await this.findByIdempotency(input.channel, input.idempotencyKey);

    if (duplicate) {
      if (duplicate.payloadHash !== verification.payloadHash) {
        return this.reject(
          {
            ...input,
            payloadHash: verification.payloadHash,
            verificationStatus: "REJECTED",
            rejectionReason: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
            duplicateDetected: true,
            replayDetected: false,
            transactionId: duplicate.transactionId
          },
          409
        );
      }

      await this.auditLogs.write({
        userId: input.systemIdentity,
        actionType: "PAYMENT_CHANNEL_ACTION",
        entityType: "payment_channel_request",
        entityId: duplicate.id,
        notes: "Idempotent duplicate callback accepted without mutation",
        metadata: {
          verificationStatus: duplicate.verificationStatus,
          idempotencyKey: input.idempotencyKey,
          systemIdentity: input.systemIdentity,
          duplicateDetected: true
        }
      });

      return {
        status: "ok",
        idempotent: true,
        transactionId: duplicate.transactionId,
        reason: "Duplicate callback ignored; original result returned."
      };
    }

    const isFresh = this.signatures.isFresh(input.timestamp);
    if (!isFresh) {
      return this.reject(
        {
          ...input,
          payloadHash: verification.payloadHash,
          verificationStatus: "REJECTED",
          rejectionReason: "REPLAY_WINDOW_EXCEEDED_5_MINUTES",
          duplicateDetected: false,
          replayDetected: true
        },
        401
      );
    }

    if (!verification.valid) {
      return this.reject(
        {
          ...input,
          payloadHash: verification.payloadHash,
          verificationStatus: "REJECTED",
          rejectionReason: "SIGNATURE_MISMATCH_OR_TAMPERED_PAYLOAD",
          duplicateDetected: false,
          replayDetected: false
        },
        401
      );
    }

    const nonceSeen = await this.prisma.paymentChannelRequest.findFirst({
      where: {
        channel: input.channel,
        nonce: input.nonce
      },
      orderBy: { createdAt: "desc" }
    });
    if (nonceSeen) {
      return this.reject(
        {
          ...input,
          payloadHash: verification.payloadHash,
          verificationStatus: "REJECTED",
          rejectionReason: "NONCE_ALREADY_USED",
          duplicateDetected: false,
          replayDetected: true,
          transactionId: nonceSeen.transactionId
        },
        409
      );
    }

    const transaction = await this.transactions.postApprovedChargeFromChannel({
      channel: input.channel,
      systemIdentity: input.systemIdentity,
      bundleCount: input.payload.bundleCount,
      amountCents: input.payload.amountCents,
      storyVersionId: input.payload.storyVersionId,
      idempotencyKey: input.idempotencyKey
    });

    let request;
    try {
      request = await this.prisma.paymentChannelRequest.create({
        data: {
          channel: input.channel,
          operation: "CHARGE_POST",
          systemIdentity: input.systemIdentity,
          idempotencyKey: input.idempotencyKey,
          nonce: input.nonce,
          requestTimestamp: this.signatures.parseTimestamp(input.timestamp),
          payloadHash: verification.payloadHash,
          signature: input.signature,
          verificationStatus: "VERIFIED",
          duplicateDetected: false,
          replayDetected: false,
          transactionId: transaction.id,
          responseCode: 200,
          responseBody: {
            transactionId: transaction.id,
            status: "APPROVED"
          }
        }
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }

      const existing = await this.findByIdempotency(input.channel, input.idempotencyKey);
      if (!existing) {
        throw new ConflictException({
          reason: "IDEMPOTENCY_KEY_ALREADY_EXISTS",
          code: 409
        });
      }

      if (existing.payloadHash !== verification.payloadHash) {
        throw new ConflictException({
          reason: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
          code: 409
        });
      }

      return {
        status: "ok",
        idempotent: true,
        transactionId: existing.transactionId,
        reason: "Duplicate callback ignored; original result returned."
      };
    }

    await this.auditLogs.write({
      userId: input.systemIdentity,
      actionType: "PAYMENT_CHANNEL_ACTION",
      entityType: "payment_channel_request",
      entityId: request.id,
      notes: "Signed channel payload verified and applied",
      metadata: {
        verificationStatus: "VERIFIED",
        idempotencyKey: input.idempotencyKey,
        systemIdentity: input.systemIdentity,
        channel: input.channel,
        transactionId: transaction.id
      }
    });

    return {
      status: "ok",
      idempotent: false,
      transactionId: transaction.id,
      reason: "Signed channel payload accepted"
    };
  }

  private async reject(
    data: {
      channel: PaymentChannel;
      payloadHash: string;
      systemIdentity: string;
      idempotencyKey: string;
      nonce: string;
      timestamp: string;
      signature: string;
      verificationStatus: "REJECTED";
      rejectionReason: string;
      duplicateDetected: boolean;
      replayDetected: boolean;
      transactionId?: string | null;
    },
    responseCode: number
  ) {
    const existing = await this.findByIdempotency(data.channel, data.idempotencyKey);
    if (existing) {
      throw new ConflictException({
        reason: data.rejectionReason,
        code: 409,
        existingRequestId: existing.id,
        transactionId: existing.transactionId ?? null
      });
    }

    let request;
    try {
      request = await this.prisma.paymentChannelRequest.create({
        data: {
          channel: data.channel,
          operation: "CHARGE_POST",
          systemIdentity: data.systemIdentity,
          idempotencyKey: data.idempotencyKey,
          nonce: data.nonce,
          requestTimestamp: this.signatures.parseTimestamp(data.timestamp),
          payloadHash: data.payloadHash,
          signature: data.signature,
          verificationStatus: data.verificationStatus,
          rejectionReason: data.rejectionReason,
          duplicateDetected: data.duplicateDetected,
          replayDetected: data.replayDetected,
          transactionId: data.transactionId ?? undefined,
          responseCode,
          responseBody: {
            reason: data.rejectionReason
          }
        }
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException({
          reason: data.rejectionReason,
          code: 409
        });
      }
      throw error;
    }

    await this.auditLogs.write({
      userId: data.systemIdentity,
      actionType: "PAYMENT_CHANNEL_ACTION",
      entityType: "payment_channel_request",
      entityId: request.id,
      notes: "Signed channel payload rejected",
      metadata: {
        verificationStatus: "REJECTED",
        rejectionReason: data.rejectionReason,
        idempotencyKey: data.idempotencyKey,
        systemIdentity: data.systemIdentity,
        channel: data.channel,
        duplicateDetected: data.duplicateDetected,
        replayDetected: data.replayDetected
      }
    });

    throw new HttpException({
      reason: data.rejectionReason,
      code: responseCode
    }, responseCode);
  }

  private async findByIdempotency(channel: PaymentChannel, idempotencyKey: string) {
    return this.prisma.paymentChannelRequest.findUnique({
      where: {
        channel_idempotencyKey: {
          channel,
          idempotencyKey
        }
      }
    });
  }

  private isUniqueConstraintError(error: unknown): boolean {
    if (error instanceof PrismaClientKnownRequestError) {
      return error.code === "P2002";
    }
    return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
  }
}
