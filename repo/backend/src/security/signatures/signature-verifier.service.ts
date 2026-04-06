import { BadRequestException, Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import { PaymentChannel } from "../../modules/payment-channels/payment-channel.enum";

@Injectable()
export class SignatureVerifierService {
  assertConfigured(): void {
    const missing = this.requiredSecretEntries().filter(([, value]) => !value).map(([key]) => key);
    const allowInsecureTestFallback =
      process.env.NODE_ENV === "test" && process.env.ALLOW_INSECURE_CHANNEL_SECRETS === "true";

    if (!allowInsecureTestFallback && missing.length > 0) {
      throw new Error(
        `Missing required payment channel secrets: ${missing.join(", ")}. Set all channel secrets before startup.`
      );
    }
  }

  verify(input: {
    channel: string;
    timestamp: string;
    nonce: string;
    idempotencyKey: string;
    signature: string;
    payload: unknown;
  }): { valid: boolean; payloadHash: string; canonicalPayload: string } {
    const canonicalPayload = this.stableStringify(input.payload);
    const payloadHash = createHmac("sha256", "payload-hash")
      .update(canonicalPayload)
      .digest("hex");

    const base = `${input.channel}|${input.timestamp}|${input.nonce}|${input.idempotencyKey}|${canonicalPayload}`;
    const expected = createHmac("sha256", this.secretFor(input.channel)).update(base).digest("hex");

    const valid = this.safeCompare(expected, input.signature);
    return { valid, payloadHash, canonicalPayload };
  }

  isFresh(timestamp: string, maxAgeMs = 5 * 60 * 1000): boolean {
    const parsed = Number(timestamp);
    const time = Number.isFinite(parsed) ? parsed : Date.parse(timestamp);
    if (!Number.isFinite(time)) {
      return false;
    }
    return Math.abs(Date.now() - time) <= maxAgeMs;
  }

  parseTimestamp(timestamp: string): Date {
    const parsed = Number(timestamp);
    const time = Number.isFinite(parsed) ? parsed : Date.parse(timestamp);
    return Number.isFinite(time) ? new Date(time) : new Date();
  }

  private secretFor(channel: string): string {
    const secrets = Object.fromEntries(this.requiredSecretEntries()) as Record<string, string | undefined>;

    if (channel === PaymentChannel.PREPAID_BALANCE) {
      return this.requiredSecret("CHANNEL_SECRET_PREPAID_BALANCE", secrets.CHANNEL_SECRET_PREPAID_BALANCE);
    }
    if (channel === PaymentChannel.INVOICE_CREDIT) {
      return this.requiredSecret("CHANNEL_SECRET_INVOICE_CREDIT", secrets.CHANNEL_SECRET_INVOICE_CREDIT);
    }
    if (channel === PaymentChannel.PURCHASE_ORDER_SETTLEMENT) {
      return this.requiredSecret(
        "CHANNEL_SECRET_PURCHASE_ORDER_SETTLEMENT",
        secrets.CHANNEL_SECRET_PURCHASE_ORDER_SETTLEMENT
      );
    }

    throw new BadRequestException(`Unknown payment channel: ${String(channel)}`);
  }

  private requiredSecretEntries(): Array<[string, string | undefined]> {
    return [
      ["CHANNEL_SECRET_PREPAID_BALANCE", process.env.CHANNEL_SECRET_PREPAID_BALANCE],
      ["CHANNEL_SECRET_INVOICE_CREDIT", process.env.CHANNEL_SECRET_INVOICE_CREDIT],
      ["CHANNEL_SECRET_PURCHASE_ORDER_SETTLEMENT", process.env.CHANNEL_SECRET_PURCHASE_ORDER_SETTLEMENT]
    ];
  }

  private requiredSecret(key: string, value: string | undefined): string {
    if (!value) {
      throw new Error(`Missing required secret: ${key}`);
    }
    return value;
  }

  private safeCompare(left: string, right: string): boolean {
    const leftBuf = Buffer.from(left);
    const rightBuf = Buffer.from(right);
    if (leftBuf.length !== rightBuf.length) {
      return false;
    }
    return timingSafeEqual(leftBuf, rightBuf);
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(",")}]`;
    }

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`).join(",")}}`;
  }
}
