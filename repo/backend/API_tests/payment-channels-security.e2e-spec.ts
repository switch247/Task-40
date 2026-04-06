import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHmac, randomUUID } from "crypto";
import * as request from "supertest";
import cookieParser = require("cookie-parser");
import { PrismaClient } from "@prisma/client";
import { PaymentChannelsV2Controller } from "../src/api/v2/payment-channels-v2.controller";
import { AppModule } from "../src/app.module";
import { AuditLogsService } from "../src/modules/audit-logs/audit-logs.service";
import { RedisService } from "../src/modules/cache/redis.service";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { TransactionsService } from "../src/modules/transactions/transactions.service";
import { PaymentChannelsService } from "../src/modules/payment-channels/payment-channels.service";
import { SignatureVerifierService } from "../src/security/signatures/signature-verifier.service";

type StoredRequest = {
  id: string;
  channel: string;
  idempotencyKey: string;
  nonce: string;
  payloadHash: string;
  verificationStatus: string;
  transactionId?: string | null;
  rejectionReason?: string;
  createdAt: Date;
};

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

function sign(channel: string, timestamp: string, nonce: string, idempotencyKey: string, payload: unknown, secret: string): string {
  const canonicalPayload = stableStringify(payload);
  const base = `${channel}|${timestamp}|${nonce}|${idempotencyKey}|${canonicalPayload}`;
  return createHmac("sha256", secret).update(base).digest("hex");
}

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

describe("Payment channel replay/idempotency protections (e2e)", () => {
  let app: INestApplication;
  const requests: StoredRequest[] = [];
  let txCounter = 1;
  let createSpy: jest.Mock;

  beforeAll(async () => {
    process.env.CHANNEL_SECRET_PREPAID_BALANCE = "prepaid-secret";
    process.env.CHANNEL_SECRET_INVOICE_CREDIT = "invoice-secret";
    process.env.CHANNEL_SECRET_PURCHASE_ORDER_SETTLEMENT = "po-secret";

    createSpy = jest.fn().mockImplementation(({ data }: any) => {
      const duplicate = requests.find(
        (item) => item.channel === data.channel && item.idempotencyKey === data.idempotencyKey
      );
      if (duplicate) {
        throw { code: "P2002" };
      }
      const created: StoredRequest = {
        id: `req-${requests.length + 1}`,
        channel: data.channel,
        idempotencyKey: data.idempotencyKey,
        nonce: data.nonce,
        payloadHash: data.payloadHash,
        verificationStatus: data.verificationStatus,
        transactionId: data.transactionId ?? null,
        rejectionReason: data.rejectionReason,
        createdAt: new Date()
      };
      requests.push(created);
      return created;
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentChannelsV2Controller],
      providers: [
        PaymentChannelsService,
        SignatureVerifierService,
        {
          provide: TransactionsService,
          useValue: {
            postApprovedChargeFromChannel: jest.fn().mockImplementation(() => {
              const id = `tx-${txCounter++}`;
              return { id };
            })
          }
        },
        {
          provide: PrismaService,
          useValue: {
            paymentChannelRequest: {
              findUnique: jest.fn().mockImplementation(({ where: { channel_idempotencyKey } }: any) => {
                return (
                  requests.find(
                    (item) =>
                      item.channel === channel_idempotencyKey.channel &&
                      item.idempotencyKey === channel_idempotencyKey.idempotencyKey
                  ) ?? null
                );
              }),
              findFirst: jest.fn().mockImplementation(({ where: { channel, nonce } }: any) => {
                return requests.find((item) => item.channel === channel && item.nonce === nonce) ?? null;
              }),
              create: createSpy
            }
          }
        },
        { provide: AuditLogsService, useValue: { write: jest.fn().mockResolvedValue(undefined) } }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("accepts first signed callback and returns idempotent response for exact duplicate", async () => {
    const payload = { bundleCount: 2, amountCents: 500, storyVersionId: "sv-1" };
    const timestamp = `${Date.now()}`;
    const nonce = "nonce-1";
    const idempotencyKey = "key-1";
    const signature = sign("prepaid_balance", timestamp, nonce, idempotencyKey, payload, "prepaid-secret");

    const first = await request(app.getHttpServer())
      .post("/payment-channels/prepaid_balance/charge")
      .set("x-system-id", "system-a")
      .set("x-signature", signature)
      .set("x-timestamp", timestamp)
      .set("x-nonce", nonce)
      .set("x-idempotency-key", idempotencyKey)
      .send(payload);

    expect(first.status).toBe(201);
    expect(first.body.status).toBe("ok");
    expect(first.body.idempotent).toBe(false);

    const second = await request(app.getHttpServer())
      .post("/payment-channels/prepaid_balance/charge")
      .set("x-system-id", "system-a")
      .set("x-signature", signature)
      .set("x-timestamp", timestamp)
      .set("x-nonce", nonce)
      .set("x-idempotency-key", idempotencyKey)
      .send(payload);

    expect(second.status).toBe(201);
    expect(second.body.idempotent).toBe(true);
    expect(second.body.transactionId).toBe(first.body.transactionId);
  });

  it("rejects idempotency-key reuse with mutated payload", async () => {
    const originalPayload = { bundleCount: 1, amountCents: 300, storyVersionId: "sv-2" };
    const timestamp = `${Date.now()}`;
    const nonce = "nonce-2";
    const idempotencyKey = "key-preexisting";
    const canonicalOriginal = stableStringify(originalPayload);
    requests.push({
      id: "req-preexisting",
      channel: "prepaid_balance",
      idempotencyKey,
      nonce: "nonce-preexisting",
      payloadHash: createHmac("sha256", "payload-hash").update(canonicalOriginal).digest("hex"),
      verificationStatus: "VERIFIED",
      transactionId: "tx-preexisting",
      createdAt: new Date()
    });

    const mutatedPayload = { ...originalPayload, amountCents: 999 };
    const mutatedSig = sign("prepaid_balance", timestamp, nonce, idempotencyKey, mutatedPayload, "prepaid-secret");

    const response = await request(app.getHttpServer())
      .post("/payment-channels/prepaid_balance/charge")
      .set("x-system-id", "system-a")
      .set("x-signature", mutatedSig)
      .set("x-timestamp", timestamp)
      .set("x-nonce", nonce)
      .set("x-idempotency-key", idempotencyKey)
      .send(mutatedPayload);

    expect(response.status).toBe(409);
    expect(response.body.reason).toBe("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD");
    expect(createSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: "prepaid_balance",
          idempotencyKey
        })
      })
    );
  });

  it("rejects replayed nonce and stale timestamp", async () => {
    const freshPayload = { bundleCount: 1, amountCents: 400, storyVersionId: "sv-3" };
    const freshTimestamp = `${Date.now()}`;
    const sharedNonce = "nonce-3";
    const freshSig = sign("prepaid_balance", freshTimestamp, sharedNonce, "key-3", freshPayload, "prepaid-secret");

    const accepted = await request(app.getHttpServer())
      .post("/payment-channels/prepaid_balance/charge")
      .set("x-system-id", "system-a")
      .set("x-signature", freshSig)
      .set("x-timestamp", freshTimestamp)
      .set("x-nonce", sharedNonce)
      .set("x-idempotency-key", "key-3")
      .send(freshPayload);
    expect(accepted.status).toBe(201);

    const replayPayload = { bundleCount: 1, amountCents: 410, storyVersionId: "sv-4" };
    const replayTimestamp = `${Date.now()}`;
    const replaySig = sign("prepaid_balance", replayTimestamp, sharedNonce, "key-4", replayPayload, "prepaid-secret");
    const replayResponse = await request(app.getHttpServer())
      .post("/payment-channels/prepaid_balance/charge")
      .set("x-system-id", "system-a")
      .set("x-signature", replaySig)
      .set("x-timestamp", replayTimestamp)
      .set("x-nonce", sharedNonce)
      .set("x-idempotency-key", "key-4")
      .send(replayPayload);

    expect(replayResponse.status).toBe(409);
    expect(replayResponse.body.reason).toBe("NONCE_ALREADY_USED");

    const staleTimestamp = `${Date.now() - 6 * 60 * 1000}`;
    const stalePayload = { bundleCount: 1, amountCents: 200, storyVersionId: "sv-5" };
    const staleSig = sign("prepaid_balance", staleTimestamp, "nonce-5", "key-5", stalePayload, "prepaid-secret");

    const staleResponse = await request(app.getHttpServer())
      .post("/payment-channels/prepaid_balance/charge")
      .set("x-system-id", "system-a")
      .set("x-signature", staleSig)
      .set("x-timestamp", staleTimestamp)
      .set("x-nonce", "nonce-5")
      .set("x-idempotency-key", "key-5")
      .send(stalePayload);

    expect(staleResponse.status).toBe(401);
    expect(staleResponse.body.reason).toBe("REPLAY_WINDOW_EXCEEDED_5_MINUTES");
  });

  it("rejects invalid channel path parameter with 400", async () => {
    const response = await request(app.getHttpServer())
      .post("/payment-channels/invalid_channel/charge")
      .set("x-system-id", "system-a")
      .set("x-signature", "sig")
      .set("x-timestamp", `${Date.now()}`)
      .set("x-nonce", "nonce-invalid")
      .set("x-idempotency-key", "key-invalid")
      .send({ bundleCount: 1, amountCents: 100, storyVersionId: "sv-invalid" });

    expect(response.status).toBe(400);
  });
});

describeDb("Payment channel idempotency race condition (db integration e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let storyId: string;
  let storyVersionId: string;
  const systemUserId = "race-system";
  const transactionIds: string[] = [];

  beforeAll(async () => {
    process.env.FIELD_ENCRYPTION_KEY = process.env.FIELD_ENCRYPTION_KEY ?? "test-field-encryption-key";
    process.env.CHANNEL_SECRET_PREPAID_BALANCE = process.env.CHANNEL_SECRET_PREPAID_BALANCE ?? "prepaid-secret";
    process.env.CHANNEL_SECRET_INVOICE_CREDIT = process.env.CHANNEL_SECRET_INVOICE_CREDIT ?? "invoice-secret";
    process.env.CHANNEL_SECRET_PURCHASE_ORDER_SETTLEMENT = process.env.CHANNEL_SECRET_PURCHASE_ORDER_SETTLEMENT ?? "po-secret";

    prisma = new PrismaClient();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(RedisService)
      .useValue({
        raw: {
          incr: jest.fn().mockResolvedValue(1),
          expire: jest.fn().mockResolvedValue(1),
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue("OK"),
          rpush: jest.fn().mockResolvedValue(1),
          lpop: jest.fn().mockResolvedValue(null),
          llen: jest.fn().mockResolvedValue(0)
        },
        getHotRead: jest.fn().mockResolvedValue(null),
        setHotRead: jest.fn().mockResolvedValue(undefined),
        del: jest.fn().mockResolvedValue(undefined),
        delMany: jest.fn().mockResolvedValue(undefined),
        scanKeys: jest.fn().mockResolvedValue([])
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true
      })
    );
    await app.init();

    const uid = `${Date.now()}`;
    storyId = randomUUID();
    storyVersionId = randomUUID();

    await prisma.user.upsert({
      where: { id: systemUserId },
      update: {},
      create: {
        id: systemUserId,
        username: "race-system",
        passwordHash: "seeded-system-user-hash"
      }
    });

    await prisma.story.create({
      data: {
        id: storyId,
        source: "wire",
        canonicalUrl: `https://example.local/race-${uid}`,
        latestTitle: "Race Story",
        latestBody: "Race body",
        versions: {
          create: {
            id: storyVersionId,
            versionNumber: 1,
            title: "Race Story",
            body: "Race body",
            rawUrl: `https://example.local/race-${uid}`,
            canonicalUrl: `https://example.local/race-${uid}`,
            source: "wire",
            contentHash: `race-hash-${uid}`,
            simhash: "1",
            minhashSignature: "1,2"
          }
        }
      }
    });
  });

  afterAll(async () => {
    if (hasDatabase) {
      const txIds = [...new Set(transactionIds)];
      if (txIds.length > 0) {
        await prisma.fundLedger.deleteMany({ where: { transactionId: { in: txIds } } });
        await prisma.refundCase.deleteMany({ where: { transactionId: { in: txIds } } });
        await prisma.freezeCase.deleteMany({ where: { transactionId: { in: txIds } } });
        await prisma.paymentChannelRequest.deleteMany({ where: { transactionId: { in: txIds } } });
        await prisma.transaction.deleteMany({ where: { id: { in: txIds } } });
      }
      await prisma.paymentChannelRequest.deleteMany({ where: { idempotencyKey: { startsWith: "race-key-" } } });
      await prisma.story.deleteMany({ where: { id: storyId } });
      await prisma.user.deleteMany({ where: { id: systemUserId } });
      await prisma.$disconnect();
    }
    await app.close();
  });

  it("returns 1 success and 4 conflicts for concurrent requests sharing one idempotency key with payload drift", async () => {
    const idem = `race-key-${Date.now()}`;
    const timestamp = `${Date.now()}`;
    const channel = "prepaid_balance";
    const nonceBase = `race-nonce-${Date.now()}`;

    const payloads = [
      { bundleCount: 1, amountCents: 300, storyVersionId },
      { bundleCount: 1, amountCents: 301, storyVersionId },
      { bundleCount: 1, amountCents: 302, storyVersionId },
      { bundleCount: 1, amountCents: 303, storyVersionId },
      { bundleCount: 1, amountCents: 304, storyVersionId }
    ];

    const requestsRun = payloads.map((payload, index) => {
      const nonce = `${nonceBase}-${index}`;
      const signature = sign(channel, timestamp, nonce, idem, payload, process.env.CHANNEL_SECRET_PREPAID_BALANCE as string);

      return request(app.getHttpServer())
        .post(`/payment-channels/${channel}/charge`)
        .set("x-system-id", systemUserId)
        .set("x-signature", signature)
        .set("x-timestamp", timestamp)
        .set("x-nonce", nonce)
        .set("x-idempotency-key", idem)
        .send(payload);
    });

    const results = await Promise.all(requestsRun);
    const successes = results.filter((response) => response.status === 201);
    const conflicts = results.filter((response) => response.status === 409);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(4);

    const persisted = await prisma.paymentChannelRequest.findUnique({
      where: { channel_idempotencyKey: { channel, idempotencyKey: idem } }
    });
    expect(persisted).toBeTruthy();
    expect(persisted?.responseCode).toBe(200);

    if (successes[0]?.body?.transactionId) {
      transactionIds.push(successes[0].body.transactionId as string);
    }
  });
});
