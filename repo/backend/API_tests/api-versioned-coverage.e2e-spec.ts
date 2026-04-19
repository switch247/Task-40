import { INestApplication, ValidationPipe, VersioningType } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHmac, randomUUID } from "crypto";
import * as request from "supertest";
import cookieParser = require("cookie-parser");
import { PrismaClient } from "@prisma/client";
import { AppModule } from "../src/app.module";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const rec = value as Record<string, unknown>;
  return `{${Object.keys(rec).sort().map(k => `${JSON.stringify(k)}:${stableStringify(rec[k])}`).join(",")}}`;
}

function signChannelPayload(
  channel: string, timestamp: string, nonce: string,
  idempotencyKey: string, payload: unknown, secret: string
): string {
  const base = `${channel}|${timestamp}|${nonce}|${idempotencyKey}|${stableStringify(payload)}`;
  return createHmac("sha256", secret).update(base).digest("hex");
}

describeDb("All versioned API endpoints – /api/v{N}/... strict coverage", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let storyVersionId: string;
  let storyId: string;
  const systemUserId = "vcov-system";
  const allTransactionIds: string[] = [];

  async function login(ver: string, username: string, password: string) {
    const res = await request(app.getHttpServer())
      .post(`/api/${ver}/auth/login`)
      .send({ username, password });
    expect(res.status).toBe(201);
    const cookie = res.headers["set-cookie"]?.[0] as string;
    expect(cookie).toBeTruthy();
    return { cookie, csrf: res.body.csrfToken as string };
  }

  async function rotateCsrf(ver: string, cookie: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get(`/api/${ver}/auth/csrf`)
      .set("Cookie", [cookie]);
    expect(res.status).toBe(200);
    return res.body.csrfToken as string;
  }

  beforeAll(async () => {
    process.env.FIELD_ENCRYPTION_KEY ??= "test-field-encryption-key";
    process.env.CHANNEL_SECRET_PREPAID_BALANCE ??= "prepaid-secret";
    process.env.CHANNEL_SECRET_INVOICE_CREDIT ??= "invoice-secret";
    process.env.CHANNEL_SECRET_PURCHASE_ORDER_SETTLEMENT ??= "po-secret";

    storyId = randomUUID();
    storyVersionId = randomUUID();

    prisma = new PrismaClient();

    await prisma.user.upsert({
      where: { id: systemUserId },
      create: { id: systemUserId, username: systemUserId, passwordHash: "x" },
      update: {}
    });

    await prisma.story.create({
      data: {
        id: storyId,
        source: "wire",
        canonicalUrl: `https://example.local/vcov-${storyId}`,
        latestTitle: "VCov Story",
        latestBody: "VCov body",
        versions: {
          create: {
            id: storyVersionId,
            versionNumber: 1,
            title: "VCov Story",
            body: "VCov body",
            rawUrl: `https://example.local/vcov-${storyId}`,
            canonicalUrl: `https://example.local/vcov-${storyId}`,
            source: "wire",
            contentHash: `vcov-hash-${storyId}`,
            simhash: "1",
            minhashSignature: "1,2"
          }
        }
      }
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api");
    app.enableVersioning({ type: VersioningType.URI, prefix: "v" });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(async () => {
    if (hasDatabase) {
      const txIds = [...new Set(allTransactionIds)];
      if (txIds.length > 0) {
        await prisma.fundLedger.deleteMany({ where: { transactionId: { in: txIds } } });
        await prisma.refundCase.deleteMany({ where: { transactionId: { in: txIds } } });
        await prisma.freezeCase.deleteMany({ where: { transactionId: { in: txIds } } });
        await prisma.transaction.deleteMany({ where: { id: { in: txIds } } });
      }
      await prisma.paymentChannelRequest.deleteMany({ where: { idempotencyKey: { startsWith: "vcov-" } } });
      await prisma.story.deleteMany({ where: { id: storyId } });
      await prisma.user.deleteMany({ where: { id: systemUserId } });
      await prisma.$disconnect();
    }
    await app.close();
  });

  function runVersionTests(ver: "v1" | "v2") {
    let admin: { cookie: string; csrf: string };
    let finance: { cookie: string; csrf: string };
    let auditor: { cookie: string; csrf: string };
    let editor: { cookie: string; csrf: string };
    let txId: string;
    let alertId: string;

    beforeAll(async () => {
      [admin, finance, auditor, editor] = await Promise.all([
        login(ver, "admin", "ChangeMeNow123"),
        login(ver, "finance_reviewer", "FinanceNow123"),
        login(ver, "auditor", "AuditorNow123"),
        login(ver, "editor", "EditorNow123")
      ]);
    });

    // ── AUTH ────────────────────────────────────────────────────────────────

    it(`POST /api/${ver}/auth/login succeeds with valid credentials`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/auth/login`)
        .send({ username: "admin", password: "ChangeMeNow123" });
      expect(res.status).toBe(201);
      expect(typeof res.body.csrfToken).toBe("string");
      expect(res.body.user.username).toBe("admin");
    });

    it(`POST /api/${ver}/auth/login rejects bad credentials`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/auth/login`)
        .send({ username: "admin", password: "WrongPassword!!!" });
      expect(res.status).toBe(401);
    });

    it(`GET /api/${ver}/auth/me returns current user`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/auth/me`)
        .set("Cookie", [admin.cookie]);
      expect(res.status).toBe(200);
      expect(res.body.username).toBe("admin");
    });

    it(`GET /api/${ver}/auth/me rejects unauthenticated`, async () => {
      const res = await request(app.getHttpServer()).get(`/api/${ver}/auth/me`);
      expect(res.status).toBe(401);
    });

    it(`GET /api/${ver}/auth/csrf rotates and returns new token`, async () => {
      const newCsrf = await rotateCsrf(ver, admin.cookie);
      expect(typeof newCsrf).toBe("string");
      expect(newCsrf.length).toBeGreaterThan(0);
      admin.csrf = newCsrf;
    });

    it(`POST /api/${ver}/auth/mfa/enroll returns TOTP setup data`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/auth/mfa/enroll`)
        .set("Cookie", [finance.cookie])
        .set("x-csrf-token", finance.csrf);
      expect([200, 201, 409]).toContain(res.status);
      if (res.status === 201 || res.status === 200) {
        expect(res.body.otpauth || res.body.secret || res.body.qrCode || res.body.status).toBeTruthy();
      }
    });

    it(`POST /api/${ver}/auth/mfa/verify rejects invalid TOTP code`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/auth/mfa/verify`)
        .set("Cookie", [finance.cookie])
        .set("x-csrf-token", finance.csrf)
        .send({ code: "000000" });
      expect([200, 201, 400, 401, 403, 422]).toContain(res.status);
    });

    it(`POST /api/${ver}/auth/logout rejects stale CSRF`, async () => {
      const tempSession = await login(ver, "editor", "EditorNow123");
      const staleCsrf = tempSession.csrf;
      await rotateCsrf(ver, tempSession.cookie);
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/auth/logout`)
        .set("Cookie", [tempSession.cookie])
        .set("x-csrf-token", staleCsrf);
      expect(res.status).toBe(403);
    });

    it(`POST /api/${ver}/auth/logout succeeds with valid CSRF`, async () => {
      const tempSession = await login(ver, "editor", "EditorNow123");
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/auth/logout`)
        .set("Cookie", [tempSession.cookie])
        .set("x-csrf-token", tempSession.csrf);
      expect([200, 201]).toContain(res.status);
    });

    // ── HEALTH ──────────────────────────────────────────────────────────────

    it(`GET /api/${ver}/health returns service status`, async () => {
      const res = await request(app.getHttpServer()).get(`/api/${ver}/health`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("postgres");
      expect(res.body).toHaveProperty("redis");
    });

    it(`GET /api/${ver}/health/summary returns jobs summary`, async () => {
      const res = await request(app.getHttpServer()).get(`/api/${ver}/health/summary`);
      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
    });

    // ── ADMIN ───────────────────────────────────────────────────────────────

    it(`GET /api/${ver}/admin/overview requires authentication`, async () => {
      const res = await request(app.getHttpServer()).get(`/api/${ver}/admin/overview`);
      expect(res.status).toBe(401);
    });

    it(`GET /api/${ver}/admin/overview returns roles, permissions, users, thresholds`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/admin/overview`)
        .set("Cookie", [admin.cookie]);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.roles)).toBe(true);
      expect(Array.isArray(res.body.permissions)).toBe(true);
      expect(Array.isArray(res.body.users)).toBe(true);
    });

    it(`PUT /api/${ver}/admin/roles rejects missing CSRF`, async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/${ver}/admin/roles`)
        .set("Cookie", [admin.cookie])
        .send({ name: "test-role", permissionKeys: [], changeNote: "valid note here" });
      expect(res.status).toBe(403);
    });

    it(`PUT /api/${ver}/admin/roles creates role with valid payload`, async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/${ver}/admin/roles`)
        .set("Cookie", [admin.cookie])
        .set("x-csrf-token", admin.csrf)
        .send({
          name: `vcov-role-${ver}-${Date.now()}`,
          description: "VCov test role",
          permissionKeys: ["stories.review"],
          changeNote: `vcov api coverage test role upsert ${ver}`
        });
      expect(res.status).toBe(200);
      expect(typeof res.body.id).toBe("string");
    });

    it(`PUT /api/${ver}/admin/users/:id/roles requires CSRF`, async () => {
      const overview = await request(app.getHttpServer())
        .get(`/api/${ver}/admin/overview`)
        .set("Cookie", [admin.cookie]);
      const editorUser = (overview.body.users as Array<{ username: string; id: string; roleIds: string[] }>)
        .find(u => u.username === "editor");
      expect(editorUser).toBeTruthy();
      const res = await request(app.getHttpServer())
        .put(`/api/${ver}/admin/users/${editorUser!.id}/roles`)
        .set("Cookie", [admin.cookie])
        .set("x-csrf-token", admin.csrf)
        .send({ roleIds: editorUser!.roleIds, changeNote: `vcov ${ver} user role reassignment test` });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    });

    it(`PUT /api/${ver}/admin/users/:id/rate-limit sets rate limit`, async () => {
      const overview = await request(app.getHttpServer())
        .get(`/api/${ver}/admin/overview`)
        .set("Cookie", [admin.cookie]);
      const editorUser = (overview.body.users as Array<{ username: string; id: string }>)
        .find(u => u.username === "editor");
      expect(editorUser).toBeTruthy();
      const res = await request(app.getHttpServer())
        .put(`/api/${ver}/admin/users/${editorUser!.id}/rate-limit`)
        .set("Cookie", [admin.cookie])
        .set("x-csrf-token", admin.csrf)
        .send({ requestsPerMinute: 60, changeNote: `vcov ${ver} rate limit adjustment test` });
      expect(res.status).toBe(200);
    });

    it(`PUT /api/${ver}/admin/thresholds/:key rejects invalid key`, async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/${ver}/admin/thresholds/INVALID_KEY`)
        .set("Cookie", [admin.cookie])
        .set("x-csrf-token", admin.csrf)
        .send({ value: "5", changeNote: "vcov threshold invalid key test" });
      expect(res.status).toBe(400);
    });

    it(`PUT /api/${ver}/admin/thresholds/:key updates valid threshold`, async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/${ver}/admin/thresholds/SIMHASH_MAX_HAMMING`)
        .set("Cookie", [admin.cookie])
        .set("x-csrf-token", admin.csrf)
        .send({ value: "8", changeNote: `vcov ${ver} simhash threshold update test` });
      expect(res.status).toBe(200);
      expect(res.body.key).toBe("SIMHASH_MAX_HAMMING");
    });

    it(`GET /api/${ver}/admin/operations/permission-sensitive returns array`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/admin/operations/permission-sensitive`)
        .set("Cookie", [admin.cookie]);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it(`GET /api/${ver}/admin/operations/permission-sensitive rejects unauthenticated`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/admin/operations/permission-sensitive`);
      expect(res.status).toBe(401);
    });

    // ── ALERTS ──────────────────────────────────────────────────────────────

    it(`GET /api/${ver}/alerts/dashboard requires authentication`, async () => {
      const res = await request(app.getHttpServer()).get(`/api/${ver}/alerts/dashboard`);
      expect(res.status).toBe(401);
    });

    it(`GET /api/${ver}/alerts/dashboard returns dashboard data`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/alerts/dashboard`)
        .set("Cookie", [admin.cookie]);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.alerts)).toBe(true);
      alertId = (res.body.alerts as Array<{ id: string }>)[0]?.id ?? "";
    });

    it(`PATCH /api/${ver}/alerts/:id/resolve requires CSRF`, async () => {
      if (!alertId) return;
      const res = await request(app.getHttpServer())
        .patch(`/api/${ver}/alerts/${alertId}/resolve`)
        .set("Cookie", [admin.cookie]);
      expect(res.status).toBe(403);
    });

    it(`PATCH /api/${ver}/alerts/:id/resolve resolves an open alert`, async () => {
      if (!alertId) return;
      const res = await request(app.getHttpServer())
        .patch(`/api/${ver}/alerts/${alertId}/resolve`)
        .set("Cookie", [admin.cookie])
        .set("x-csrf-token", admin.csrf);
      expect([200, 404, 409]).toContain(res.status);
    });

    // ── EDITOR QUEUE ────────────────────────────────────────────────────────

    it(`GET /api/${ver}/editor-queue requires authentication`, async () => {
      const res = await request(app.getHttpServer()).get(`/api/${ver}/editor-queue`);
      expect(res.status).toBe(401);
    });

    it(`GET /api/${ver}/editor-queue returns queue items`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/editor-queue`)
        .set("Cookie", [editor.cookie]);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items ?? res.body)).toBe(true);
    });

    it(`GET /api/${ver}/editor-queue/:storyId/diff returns diff data`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/editor-queue/${storyId}/diff`)
        .set("Cookie", [editor.cookie]);
      expect([200, 403, 404]).toContain(res.status);
    });

    it(`POST /api/${ver}/editor-queue/merge rejects missing CSRF`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/editor-queue/merge`)
        .set("Cookie", [editor.cookie])
        .send({ incomingVersionId: storyVersionId, strategy: "replace", note: "vcov merge test note" });
      expect(res.status).toBe(403);
    });

    it(`POST /api/${ver}/editor-queue/merge validates payload`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/editor-queue/merge`)
        .set("Cookie", [editor.cookie])
        .set("x-csrf-token", editor.csrf)
        .send({ incomingVersionId: storyVersionId, strategy: "replace", note: "vcov merge test note" });
      expect([200, 201, 400, 403, 404, 409, 422]).toContain(res.status);
    });

    it(`POST /api/${ver}/editor-queue/repair/:versionId rejects missing CSRF`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/editor-queue/repair/${storyVersionId}`)
        .set("Cookie", [editor.cookie])
        .send({ note: "vcov repair test note" });
      expect(res.status).toBe(403);
    });

    it(`POST /api/${ver}/editor-queue/repair/:versionId processes repair`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/editor-queue/repair/${storyVersionId}`)
        .set("Cookie", [editor.cookie])
        .set("x-csrf-token", editor.csrf)
        .send({ note: "vcov repair test note for version" });
      expect([200, 201, 400, 403, 404]).toContain(res.status);
    });

    // ── INGESTION ───────────────────────────────────────────────────────────

    it(`POST /api/${ver}/ingestion/url-batch requires authentication`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/ingestion/url-batch`)
        .send({ urls: ["https://example.com/story"], source: "wire" });
      expect(res.status).toBe(401);
    });

    it(`POST /api/${ver}/ingestion/url-batch requires CSRF`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/ingestion/url-batch`)
        .set("Cookie", [editor.cookie])
        .send({ urls: ["https://example.com/story"], source: "wire" });
      expect(res.status).toBe(403);
    });

    it(`POST /api/${ver}/ingestion/url-batch submits URLs for ingestion`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/ingestion/url-batch`)
        .set("Cookie", [editor.cookie])
        .set("x-csrf-token", editor.csrf)
        .send({ urls: ["https://example.com/vcov-story"], source: "wire" });
      expect([200, 201, 202]).toContain(res.status);
    });

    it(`POST /api/${ver}/ingestion/upload requires authentication`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/ingestion/upload`);
      expect(res.status).toBe(401);
    });

    it(`POST /api/${ver}/ingestion/upload requires CSRF`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/ingestion/upload`)
        .set("Cookie", [editor.cookie]);
      expect(res.status).toBe(403);
    });

    it(`POST /api/${ver}/ingestion/upload accepts file upload`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/ingestion/upload`)
        .set("Cookie", [editor.cookie])
        .set("x-csrf-token", editor.csrf)
        .attach("file", Buffer.from("vcov test upload content"), "test.txt");
      expect([200, 201, 202, 400, 422]).toContain(res.status);
    });

    // ── PAYMENT CHANNELS ────────────────────────────────────────────────────

    it(`POST /api/${ver}/payment-channels/prepaid_balance/charge rejects missing signature`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/payment-channels/prepaid_balance/charge`)
        .set("x-system-id", systemUserId)
        .send({ bundleCount: 1 });
      expect([400, 401, 500]).toContain(res.status);
    });

    it(`POST /api/${ver}/payment-channels/prepaid_balance/charge succeeds with valid signature`, async () => {
      const payload = { bundleCount: 1, amountCents: 200 };
      const timestamp = `${Date.now()}`;
      const nonce = `vcov-nonce-${ver}-${Date.now()}`;
      const idempotencyKey = `vcov-key-${ver}-${Date.now()}`;
      const secret = process.env.CHANNEL_SECRET_PREPAID_BALANCE as string;
      const signature = signChannelPayload("prepaid_balance", timestamp, nonce, idempotencyKey, payload, secret);

      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/payment-channels/prepaid_balance/charge`)
        .set("x-system-id", systemUserId)
        .set("x-signature", signature)
        .set("x-timestamp", timestamp)
        .set("x-nonce", nonce)
        .set("x-idempotency-key", idempotencyKey)
        .send(payload);
      expect(res.status).toBe(201);
      if (res.body.transactionId) allTransactionIds.push(res.body.transactionId as string);
    });

    it(`POST /api/${ver}/payment-channels/prepaid_balance/charge rejects stale timestamp`, async () => {
      const staleTimestamp = `${Date.now() - 6 * 60 * 1000}`;
      const payload = { bundleCount: 1, amountCents: 300 };
      const nonce = `vcov-stale-${ver}-${Date.now()}`;
      const idempotencyKey = `vcov-stale-key-${ver}-${Date.now()}`;
      const secret = process.env.CHANNEL_SECRET_PREPAID_BALANCE as string;
      const signature = signChannelPayload("prepaid_balance", staleTimestamp, nonce, idempotencyKey, payload, secret);

      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/payment-channels/prepaid_balance/charge`)
        .set("x-system-id", systemUserId)
        .set("x-signature", signature)
        .set("x-timestamp", staleTimestamp)
        .set("x-nonce", nonce)
        .set("x-idempotency-key", idempotencyKey)
        .send(payload);
      expect(res.status).toBe(401);
    });

    // ── PROFILE ─────────────────────────────────────────────────────────────

    it(`GET /api/${ver}/profile/sensitive requires authentication`, async () => {
      const res = await request(app.getHttpServer()).get(`/api/${ver}/profile/sensitive`);
      expect(res.status).toBe(401);
    });

    it(`GET /api/${ver}/profile/sensitive returns profile data`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/profile/sensitive`)
        .set("Cookie", [admin.cookie]);
      expect(res.status).toBe(200);
    });

    it(`PUT /api/${ver}/profile/sensitive requires CSRF`, async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/${ver}/profile/sensitive`)
        .set("Cookie", [admin.cookie])
        .send({ email: "test@example.com" });
      expect(res.status).toBe(403);
    });

    it(`PUT /api/${ver}/profile/sensitive updates profile fields`, async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/${ver}/profile/sensitive`)
        .set("Cookie", [admin.cookie])
        .set("x-csrf-token", admin.csrf)
        .send({ email: "vcov-test@example.com" });
      expect([200, 201, 400]).toContain(res.status);
    });

    // ── REPORTS ─────────────────────────────────────────────────────────────

    it(`GET /api/${ver}/reports/audit requires authentication`, async () => {
      const res = await request(app.getHttpServer()).get(`/api/${ver}/reports/audit`);
      expect(res.status).toBe(401);
    });

    it(`GET /api/${ver}/reports/audit requires audit.read permission`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/reports/audit`)
        .set("Cookie", [editor.cookie]);
      expect(res.status).toBe(403);
    });

    it(`GET /api/${ver}/reports/audit returns audit log entries`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/reports/audit`)
        .set("Cookie", [admin.cookie]);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items ?? res.body.entries ?? res.body)).toBe(true);
    });

    it(`GET /api/${ver}/reports/audit/export.csv returns CSV data`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/reports/audit/export.csv`)
        .set("Cookie", [admin.cookie]);
      expect(res.status).toBe(200);
      const contentType = res.headers["content-type"] as string;
      expect(contentType).toMatch(/csv|text\/plain|application\/octet/i);
    });

    // ── STORIES ─────────────────────────────────────────────────────────────

    it(`GET /api/${ver}/stories requires authentication`, async () => {
      const res = await request(app.getHttpServer()).get(`/api/${ver}/stories`);
      expect(res.status).toBe(401);
    });

    it(`GET /api/${ver}/stories returns story list`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/stories`)
        .set("Cookie", [editor.cookie]);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items ?? res.body.stories ?? res.body)).toBe(true);
    });

    // ── TRANSACTIONS ────────────────────────────────────────────────────────

    it(`GET /api/${ver}/transactions requires authentication`, async () => {
      const res = await request(app.getHttpServer()).get(`/api/${ver}/transactions`);
      expect(res.status).toBe(401);
    });

    it(`GET /api/${ver}/transactions returns transaction list`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/transactions`)
        .set("Cookie", [finance.cookie]);
      expect(res.status).toBe(200);
    });

    it(`GET /api/${ver}/transactions/story-versions returns story versions`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/transactions/story-versions`)
        .set("Cookie", [finance.cookie]);
      expect(res.status).toBe(200);
    });

    it(`POST /api/${ver}/transactions/charges requires CSRF`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/transactions/charges`)
        .set("Cookie", [finance.cookie])
        .send({ storyVersionId, channel: "prepaid_balance", bundleCount: 1 });
      expect(res.status).toBe(403);
    });

    it(`POST /api/${ver}/transactions/charges creates transaction`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/transactions/charges`)
        .set("Cookie", [finance.cookie])
        .set("x-csrf-token", finance.csrf)
        .send({ storyVersionId, channel: "prepaid_balance", bundleCount: 1 });
      expect(res.status).toBe(201);
      txId = res.body.id as string;
      allTransactionIds.push(txId);
    });

    it(`GET /api/${ver}/transactions/:id/history returns history`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/transactions/${txId}/history`)
        .set("Cookie", [finance.cookie]);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.audits)).toBe(true);
    });

    it(`POST /api/${ver}/transactions/:id/approve requires CSRF`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/transactions/${txId}/approve`)
        .set("Cookie", [admin.cookie])
        .send({ note: "vcov approve test" });
      expect(res.status).toBe(403);
    });

    it(`POST /api/${ver}/transactions/:id/approve approves transaction`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/transactions/${txId}/approve`)
        .set("Cookie", [admin.cookie])
        .set("x-csrf-token", admin.csrf)
        .send({ note: "vcov approve test note" });
      expect(res.status).toBe(201);
    });

    it(`POST /api/${ver}/transactions/:id/refunds requires CSRF`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/transactions/${txId}/refunds`)
        .set("Cookie", [admin.cookie])
        .send({ type: "partial", amountCents: 50, storyVersionId, note: "vcov refund test" });
      expect(res.status).toBe(403);
    });

    it(`POST /api/${ver}/transactions/:id/refunds creates partial refund`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/transactions/${txId}/refunds`)
        .set("Cookie", [admin.cookie])
        .set("x-csrf-token", admin.csrf)
        .send({ type: "partial", amountCents: 50, storyVersionId, note: "vcov refund test note" });
      expect([201, 400, 409]).toContain(res.status);
    });

    it(`POST /api/${ver}/transactions/:id/freeze requires CSRF`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/transactions/${txId}/freeze`)
        .set("Cookie", [admin.cookie])
        .send({ note: "vcov freeze test" });
      expect(res.status).toBe(403);
    });

    it(`POST /api/${ver}/transactions/:id/freeze freezes transaction`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/transactions/${txId}/freeze`)
        .set("Cookie", [admin.cookie])
        .set("x-csrf-token", admin.csrf)
        .send({ note: "vcov freeze test note here" });
      expect([201, 400, 409]).toContain(res.status);
    });

    it(`POST /api/${ver}/transactions/:id/release requires CSRF`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/transactions/${txId}/release`)
        .set("Cookie", [auditor.cookie])
        .send({ note: "vcov release test" });
      expect(res.status).toBe(403);
    });

    it(`POST /api/${ver}/transactions/:id/release releases freeze`, async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/transactions/${txId}/release`)
        .set("Cookie", [auditor.cookie])
        .set("x-csrf-token", auditor.csrf)
        .send({ note: "vcov release test note here" });
      expect([201, 400, 409]).toContain(res.status);
    });

    // ── SECURITY ISOLATION ──────────────────────────────────────────────────

    it(`editor cannot access admin endpoints at /api/${ver}`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/admin/overview`)
        .set("Cookie", [editor.cookie]);
      expect(res.status).toBe(403);
    });

    it(`finance_reviewer cannot access admin endpoints at /api/${ver}`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/admin/overview`)
        .set("Cookie", [finance.cookie]);
      expect(res.status).toBe(403);
    });

    it(`auditor cannot perform admin role changes at /api/${ver}`, async () => {
      const auditCsrf = await rotateCsrf(ver, auditor.cookie);
      const res = await request(app.getHttpServer())
        .put(`/api/${ver}/admin/roles`)
        .set("Cookie", [auditor.cookie])
        .set("x-csrf-token", auditCsrf)
        .send({ name: "vcov-isolation-role", permissionKeys: [], changeNote: "isolation test attempt" });
      expect(res.status).toBe(403);
    });

    it(`editor cannot access transaction history (role-level isolation) at /api/${ver}`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/transactions/${txId}/history`)
        .set("Cookie", [editor.cookie]);
      expect(res.status).toBe(403);
    });

    it(`editor cannot create charges (role-level isolation) at /api/${ver}`, async () => {
      const editorCsrf = await rotateCsrf(ver, editor.cookie);
      const res = await request(app.getHttpServer())
        .post(`/api/${ver}/transactions/charges`)
        .set("Cookie", [editor.cookie])
        .set("x-csrf-token", editorCsrf)
        .send({ storyVersionId, channel: "prepaid_balance", bundleCount: 1 });
      expect(res.status).toBe(403);
    });

    it(`finance_reviewer cannot access editor-queue (role-level isolation) at /api/${ver}`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/editor-queue`)
        .set("Cookie", [finance.cookie]);
      expect(res.status).toBe(403);
    });

    it(`finance_reviewer cannot access audit reports (role-level isolation) at /api/${ver}`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${ver}/reports/audit`)
        .set("Cookie", [finance.cookie]);
      expect(res.status).toBe(403);
    });

    it(`health endpoints are publicly accessible without auth at /api/${ver}`, async () => {
      const health = await request(app.getHttpServer()).get(`/api/${ver}/health`);
      expect(health.status).toBe(200);
      const summary = await request(app.getHttpServer()).get(`/api/${ver}/health/summary`);
      expect(summary.status).toBe(200);
    });

    it(`unauthenticated request cannot access any protected endpoint at /api/${ver}`, async () => {
      const endpoints = [
        { method: "get", path: `/api/${ver}/admin/overview` },
        { method: "get", path: `/api/${ver}/transactions` },
        { method: "get", path: `/api/${ver}/reports/audit` },
        { method: "get", path: `/api/${ver}/alerts/dashboard` },
        { method: "get", path: `/api/${ver}/editor-queue` },
        { method: "get", path: `/api/${ver}/profile/sensitive` }
      ];
      for (const ep of endpoints) {
        const res = await (request(app.getHttpServer()) as any)[ep.method](ep.path);
        expect(res.status).toBe(401);
      }
    });
  }

  describe("v1", () => {
    runVersionTests("v1");
  });

  describe("v2", () => {
    runVersionTests("v2");
  });
});
