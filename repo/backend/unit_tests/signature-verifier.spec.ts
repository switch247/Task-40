import { createHmac } from "crypto";
import { SignatureVerifierService } from "../src/security/signatures/signature-verifier.service";

function sign(
  secret: string,
  channel: string,
  timestamp: string,
  nonce: string,
  idempotencyKey: string,
  payload: unknown
) {
  const stable = stableStringify(payload);
  const base = `${channel}|${timestamp}|${nonce}|${idempotencyKey}|${stable}`;
  return createHmac("sha256", secret).update(base).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

describe("SignatureVerifierService", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("detects stale timestamps", () => {
    const service = new SignatureVerifierService();
    const old = `${Date.now() - 10 * 60 * 1000}`;
    expect(service.isFresh(old)).toBe(false);
  });

  it("accepts timestamps within 299 seconds", () => {
    const service = new SignatureVerifierService();
    const withinWindow = `${Date.now() - 299 * 1000}`;
    expect(service.isFresh(withinWindow)).toBe(true);
  });

  it("rejects timestamps older than 301 seconds", () => {
    const service = new SignatureVerifierService();
    const outsideWindow = `${Date.now() - 301 * 1000}`;
    expect(service.isFresh(outsideWindow)).toBe(false);
  });

  it("rejects future timestamps beyond 300 seconds", () => {
    const service = new SignatureVerifierService();
    const futureOutsideWindow = `${Date.now() + 301 * 1000}`;
    expect(service.isFresh(futureOutsideWindow)).toBe(false);
  });

  it("fails config validation when channel secrets are missing", () => {
    delete process.env.CHANNEL_SECRET_PREPAID_BALANCE;
    delete process.env.CHANNEL_SECRET_INVOICE_CREDIT;
    delete process.env.CHANNEL_SECRET_PURCHASE_ORDER_SETTLEMENT;
    process.env.NODE_ENV = "development";

    const service = new SignatureVerifierService();
    expect(() => service.assertConfigured()).toThrow(/Missing required payment channel secrets/);
  });

  it("verifies valid signatures and rejects tampered payload", () => {
    process.env.CHANNEL_SECRET_PREPAID_BALANCE = "prepaid-local-secret";
    process.env.CHANNEL_SECRET_INVOICE_CREDIT = "invoice-local-secret";
    process.env.CHANNEL_SECRET_PURCHASE_ORDER_SETTLEMENT = "po-local-secret";
    const service = new SignatureVerifierService();
    const payload = { bundleCount: 2, amountCents: 5000 };
    const timestamp = `${Date.now()}`;
    const nonce = "n-1";
    const key = "idem-1";
    const signature = sign("prepaid-local-secret", "prepaid_balance", timestamp, nonce, key, payload);

    const ok = service.verify({
      channel: "prepaid_balance",
      timestamp,
      nonce,
      idempotencyKey: key,
      signature,
      payload
    });
    expect(ok.valid).toBe(true);

    const bad = service.verify({
      channel: "prepaid_balance",
      timestamp,
      nonce,
      idempotencyKey: key,
      signature,
      payload: { bundleCount: 3, amountCents: 5000 }
    });
    expect(bad.valid).toBe(false);
  });

  it("throws bad request for unknown channel values", () => {
    process.env.CHANNEL_SECRET_PREPAID_BALANCE = "prepaid-local-secret";
    process.env.CHANNEL_SECRET_INVOICE_CREDIT = "invoice-local-secret";
    process.env.CHANNEL_SECRET_PURCHASE_ORDER_SETTLEMENT = "po-local-secret";
    const service = new SignatureVerifierService();

    expect(() =>
      service.verify({
        channel: "invalid_channel" as any,
        timestamp: `${Date.now()}`,
        nonce: "n-unknown",
        idempotencyKey: "idem-unknown",
        signature: "x",
        payload: {}
      })
    ).toThrow(/Unknown payment channel/);
  });
});
