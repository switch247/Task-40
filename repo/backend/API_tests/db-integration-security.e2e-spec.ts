import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHmac, randomUUID } from "crypto";
import * as request from "supertest";
import cookieParser = require("cookie-parser");
import { PrismaClient } from "@prisma/client";
import { AppModule } from "../src/app.module";
import { RedisService } from "../src/modules/cache/redis.service";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

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

function signChannelPayload(channel: string, timestamp: string, nonce: string, idempotencyKey: string, payload: unknown, secret: string): string {
  const canonicalPayload = stableStringify(payload);
  const base = `${channel}|${timestamp}|${nonce}|${idempotencyKey}|${canonicalPayload}`;
  return createHmac("sha256", secret).update(base).digest("hex");
}

describeDb("DB integration security flows (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let storyVersionId: string;
  let storyId: string;
  const systemUserId = "itest-system";
  const createdTransactionIds: string[] = [];

  async function login(username: string, password: string): Promise<{ cookie: string; csrf: string }> {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username, password });
    expect(response.status).toBe(201);
    const cookie = response.headers["set-cookie"]?.[0];
    expect(cookie).toBeTruthy();
    return { cookie, csrf: response.body.csrfToken as string };
  }

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

    storyId = randomUUID();
    storyVersionId = randomUUID();

    await prisma.user.upsert({
      where: { id: systemUserId },
      update: {},
      create: {
        id: systemUserId,
        username: "itest-system",
        passwordHash: "seeded-system-user-hash"
      }
    });

    await prisma.story.create({
      data: {
        id: storyId,
        source: "wire",
        canonicalUrl: `https://example.local/story-${storyId}`,
        latestTitle: "Integration Story",
        latestBody: "Integration body",
        versions: {
          create: {
            id: storyVersionId,
            versionNumber: 1,
            title: "Integration Story",
            body: "Integration body",
            rawUrl: `https://example.local/story-${storyId}`,
            canonicalUrl: `https://example.local/story-${storyId}`,
            source: "wire",
            contentHash: "hash-int",
            simhash: "1",
            minhashSignature: "1,2"
          }
        }
      }
    });
  });

  afterAll(async () => {
    if (hasDatabase) {
      const txIds = [...new Set(createdTransactionIds)];
      if (txIds.length > 0) {
        await prisma.fundLedger.deleteMany({ where: { transactionId: { in: txIds } } });
        await prisma.refundCase.deleteMany({ where: { transactionId: { in: txIds } } });
        await prisma.freezeCase.deleteMany({ where: { transactionId: { in: txIds } } });
      }
      await prisma.paymentChannelRequest.deleteMany({ where: { idempotencyKey: { startsWith: "itest-" } } });
      await prisma.transaction.deleteMany({ where: { id: { in: txIds } } });
      await prisma.story.deleteMany({ where: { id: storyId } });
      await prisma.user.deleteMany({ where: { id: systemUserId } });
      await prisma.$disconnect();
    }
    await app.close();
  });

  it("auth/session + csrf lifecycle works with persisted sessions", async () => {
    const { cookie, csrf } = await login("admin", "ChangeMeNow123");

    const me = await request(app.getHttpServer()).get("/auth/me").set("Cookie", [cookie]);
    expect(me.status).toBe(200);
    expect(me.body.username).toBe("admin");

    const rotate = await request(app.getHttpServer()).get("/auth/csrf").set("Cookie", [cookie]);
    expect(rotate.status).toBe(200);
    const rotatedCsrf = rotate.body.csrfToken as string;
    expect(rotatedCsrf).toBeTruthy();
    expect(rotatedCsrf).not.toBe(csrf);

    const oldLogout = await request(app.getHttpServer())
      .post("/auth/logout")
      .set("Cookie", [cookie])
      .set("x-csrf-token", csrf);
    expect(oldLogout.status).toBe(403);

    const logout = await request(app.getHttpServer())
      .post("/auth/logout")
      .set("Cookie", [cookie])
      .set("x-csrf-token", rotatedCsrf);
    expect(logout.status).toBe(200);
  });

  it("supports finance workflow across users/roles without owner-only blocking", async () => {
    const finance = await login("finance_reviewer", "FinanceNow123");
    const admin = await login("admin", "ChangeMeNow123");
    const auditor = await login("auditor", "AuditorNow123");

    const create = await request(app.getHttpServer())
      .post("/transactions/charges")
      .set("Cookie", [finance.cookie])
      .set("x-csrf-token", finance.csrf)
      .send({
        storyVersionId,
        channel: "prepaid_balance",
        bundleCount: 1
      });
    expect(create.status).toBe(201);
    const transactionId = create.body.id as string;
    createdTransactionIds.push(transactionId);

    const approve = await request(app.getHttpServer())
      .post(`/transactions/${transactionId}/approve`)
      .set("Cookie", [admin.cookie])
      .set("x-csrf-token", admin.csrf)
      .send({ note: "approve as non-owner" });
    expect(approve.status).toBe(201);

    const refund = await request(app.getHttpServer())
      .post(`/transactions/${transactionId}/refunds`)
      .set("Cookie", [admin.cookie])
      .set("x-csrf-token", admin.csrf)
      .send({ type: "partial", amountCents: 100, storyVersionId, note: "partial refund note" });
    expect(refund.status).toBe(201);

    const freeze = await request(app.getHttpServer())
      .post(`/transactions/${transactionId}/freeze`)
      .set("Cookie", [admin.cookie])
      .set("x-csrf-token", admin.csrf)
      .send({ note: "freeze for investigation" });
    expect(freeze.status).toBe(201);

    const release = await request(app.getHttpServer())
      .post(`/transactions/${transactionId}/release`)
      .set("Cookie", [auditor.cookie])
      .set("x-csrf-token", auditor.csrf)
      .send({ note: "auditor release note" });
    expect(release.status).toBe(201);

    const history = await request(app.getHttpServer())
      .get(`/transactions/${transactionId}/history`)
      .set("Cookie", [finance.cookie]);
    expect(history.status).toBe(200);
    expect(Array.isArray(history.body.audits)).toBe(true);
    expect(history.body.audits.length).toBeGreaterThan(0);
  });

  it("enforces payment callback idempotency and replay protections with persisted requests", async () => {
    const payload = { bundleCount: 1, amountCents: 300 };
    const timestamp = `${Date.now()}`;
    const nonce = "itest-nonce-1";
    const idempotencyKey = "itest-key-1";
    const signature = signChannelPayload(
      "prepaid_balance",
      timestamp,
      nonce,
      idempotencyKey,
      payload,
      process.env.CHANNEL_SECRET_PREPAID_BALANCE as string
    );

    const first = await request(app.getHttpServer())
      .post("/payment-channels/prepaid_balance/charge")
      .set("x-system-id", systemUserId)
      .set("x-signature", signature)
      .set("x-timestamp", timestamp)
      .set("x-nonce", nonce)
      .set("x-idempotency-key", idempotencyKey)
      .send(payload);
    expect(first.status).toBe(201);
    createdTransactionIds.push(first.body.transactionId as string);

    const second = await request(app.getHttpServer())
      .post("/payment-channels/prepaid_balance/charge")
      .set("x-system-id", systemUserId)
      .set("x-signature", signature)
      .set("x-timestamp", timestamp)
      .set("x-nonce", nonce)
      .set("x-idempotency-key", idempotencyKey)
      .send(payload);
    expect(second.status).toBe(201);
    expect(second.body.idempotent).toBe(true);

    const mutatedPayload = { bundleCount: 1, amountCents: 999 };
    const mutatedSignature = signChannelPayload(
      "prepaid_balance",
      timestamp,
      nonce,
      idempotencyKey,
      mutatedPayload,
      process.env.CHANNEL_SECRET_PREPAID_BALANCE as string
    );
    const mutated = await request(app.getHttpServer())
      .post("/payment-channels/prepaid_balance/charge")
      .set("x-system-id", systemUserId)
      .set("x-signature", mutatedSignature)
      .set("x-timestamp", timestamp)
      .set("x-nonce", nonce)
      .set("x-idempotency-key", idempotencyKey)
      .send(mutatedPayload);
    expect(mutated.status).toBe(409);

    const replayPayload = { bundleCount: 1, amountCents: 400 };
    const replayTimestamp = `${Date.now()}`;
    const replaySignature = signChannelPayload(
      "prepaid_balance",
      replayTimestamp,
      nonce,
      "itest-key-2",
      replayPayload,
      process.env.CHANNEL_SECRET_PREPAID_BALANCE as string
    );
    const replay = await request(app.getHttpServer())
      .post("/payment-channels/prepaid_balance/charge")
      .set("x-system-id", systemUserId)
      .set("x-signature", replaySignature)
      .set("x-timestamp", replayTimestamp)
      .set("x-nonce", nonce)
      .set("x-idempotency-key", "itest-key-2")
      .send(replayPayload);
    expect(replay.status).toBe(409);

    const staleTimestamp = `${Date.now() - 6 * 60 * 1000}`;
    const stalePayload = { bundleCount: 1, amountCents: 500 };
    const staleSignature = signChannelPayload(
      "prepaid_balance",
      staleTimestamp,
      "itest-nonce-stale",
      "itest-key-stale",
      stalePayload,
      process.env.CHANNEL_SECRET_PREPAID_BALANCE as string
    );
    const stale = await request(app.getHttpServer())
      .post("/payment-channels/prepaid_balance/charge")
      .set("x-system-id", systemUserId)
      .set("x-signature", staleSignature)
      .set("x-timestamp", staleTimestamp)
      .set("x-nonce", "itest-nonce-stale")
      .set("x-idempotency-key", "itest-key-stale")
      .send(stalePayload);
    expect(stale.status).toBe(401);
  });
});
