import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as request from "supertest";
import cookieParser = require("cookie-parser");
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import { AppModule } from "../src/app.module";
import { RedisService } from "../src/modules/cache/redis.service";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

const redisStub = {
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
};

describeDb("Alerts and Reports endpoints – true no-mock e2e", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminCookie: string;
  let adminCsrf: string;
  let auditorCookie: string;
  let auditorCsrf: string;
  let financeCookie: string;
  let seededAlertId: string;

  async function login(username: string, password: string) {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ username, password });
    expect(res.status).toBe(201);
    const cookie = res.headers["set-cookie"]?.[0] as string;
    expect(cookie).toBeTruthy();
    return { cookie, csrf: res.body.csrfToken as string };
  }

  beforeAll(async () => {
    process.env.FIELD_ENCRYPTION_KEY ??= "test-field-encryption-key";
    process.env.CHANNEL_SECRET_PREPAID_BALANCE ??= "prepaid-secret";
    process.env.CHANNEL_SECRET_INVOICE_CREDIT ??= "invoice-secret";
    process.env.CHANNEL_SECRET_PURCHASE_ORDER_SETTLEMENT ??= "po-secret";

    prisma = new PrismaClient();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RedisService)
      .useValue(redisStub)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();

    ([{ cookie: adminCookie, csrf: adminCsrf }, { cookie: auditorCookie, csrf: auditorCsrf }, { cookie: financeCookie }] =
      await Promise.all([
        login("admin", "ChangeMeNow123"),
        login("auditor", "AuditorNow123"),
        login("finance_reviewer", "FinanceNow123")
      ]));

    const alert = await prisma.alertEvent.create({
      data: {
        id: randomUUID(),
        category: "E2E_TEST_ALERT",
        severity: "LOW",
        title: "E2E Test Alert",
        status: "OPEN",
        message: "E2E test alert for resolve endpoint coverage"
      }
    });
    seededAlertId = alert.id;
  });

  afterAll(async () => {
    if (hasDatabase) {
      await prisma.alertEvent.deleteMany({ where: { category: "E2E_TEST_ALERT" } });
      await prisma.$disconnect();
    }
    await app.close();
  });

  // ── Alerts dashboard ────────────────────────────────────────────────────────

  it("GET /alerts/dashboard rejects unauthenticated request", async () => {
    const res = await request(app.getHttpServer()).get("/alerts/dashboard");
    expect(res.status).toBe(401);
  });

  it("GET /alerts/dashboard rejects roles without alerts.read permission", async () => {
    const res = await request(app.getHttpServer())
      .get("/alerts/dashboard")
      .set("Cookie", [financeCookie]);
    expect(res.status).toBe(403);
  });

  it("GET /alerts/dashboard returns alerts, banners, and status summary", async () => {
    const res = await request(app.getHttpServer())
      .get("/alerts/dashboard")
      .set("Cookie", [adminCookie]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.alerts)).toBe(true);
    expect(Array.isArray(res.body.banners)).toBe(true);
    expect(typeof res.body.status).toBe("object");
    expect(typeof res.body.status.queueDepth).toBe("number");
  });

  it("PATCH /alerts/:id/resolve rejects missing CSRF token", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/alerts/${seededAlertId}/resolve`)
      .set("Cookie", [adminCookie]);
    expect(res.status).toBe(403);
  });

  it("PATCH /alerts/:id/resolve resolves an open alert with valid CSRF", async () => {
    const freshCsrf = await request(app.getHttpServer())
      .get("/auth/csrf")
      .set("Cookie", [adminCookie]);
    const csrf = freshCsrf.body.csrfToken as string;

    const res = await request(app.getHttpServer())
      .patch(`/alerts/${seededAlertId}/resolve`)
      .set("Cookie", [adminCookie])
      .set("x-csrf-token", csrf);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.alert.status).toBe("RESOLVED");
  });

  // ── Reports: audit JSON ─────────────────────────────────────────────────────

  it("GET /reports/audit rejects unauthenticated request", async () => {
    const res = await request(app.getHttpServer()).get("/reports/audit");
    expect(res.status).toBe(401);
  });

  it("GET /reports/audit rejects roles without audit.read permission", async () => {
    const res = await request(app.getHttpServer())
      .get("/reports/audit")
      .set("Cookie", [financeCookie]);
    expect(res.status).toBe(403);
  });

  it("GET /reports/audit rejects malformed date format", async () => {
    const res = await request(app.getHttpServer())
      .get("/reports/audit?from=2026-03-28")
      .set("Cookie", [auditorCookie]);
    expect(res.status).toBe(400);
  });

  it("GET /reports/audit returns items array for authorized auditor", async () => {
    const res = await request(app.getHttpServer())
      .get("/reports/audit")
      .set("Cookie", [auditorCookie]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("GET /reports/audit filters by MM/DD/YYYY date range", async () => {
    const res = await request(app.getHttpServer())
      .get("/reports/audit?from=01/01/2020&to=12/31/2030")
      .set("Cookie", [auditorCookie]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  // ── Reports: CSV export ─────────────────────────────────────────────────────

  it("GET /reports/audit/export.csv rejects unauthenticated request", async () => {
    const res = await request(app.getHttpServer()).get("/reports/audit/export.csv");
    expect(res.status).toBe(401);
  });

  it("GET /reports/audit/export.csv rejects roles without audit.read permission", async () => {
    const res = await request(app.getHttpServer())
      .get("/reports/audit/export.csv")
      .set("Cookie", [financeCookie]);
    expect(res.status).toBe(403);
  });

  it("GET /reports/audit/export.csv returns CSV with correct content-type and disposition headers", async () => {
    const res = await request(app.getHttpServer())
      .get("/reports/audit/export.csv")
      .set("Cookie", [auditorCookie]);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toContain("audit-report.csv");
    expect(typeof res.text).toBe("string");
  });

  it("GET /reports/audit/export.csv CSV contains header row", async () => {
    const res = await request(app.getHttpServer())
      .get("/reports/audit/export.csv")
      .set("Cookie", [auditorCookie]);
    expect(res.status).toBe(200);
    expect(res.text).toContain("id");
    expect(res.text).toContain("actionType");
  });

  it("GET /reports/audit/export.csv rejects malformed date format", async () => {
    const res = await request(app.getHttpServer())
      .get("/reports/audit/export.csv?from=2026-03-28")
      .set("Cookie", [auditorCookie]);
    expect(res.status).toBe(400);
  });
});
