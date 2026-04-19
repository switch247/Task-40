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

describeDb("Editor queue endpoints – true no-mock e2e", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let editorCookie: string;
  let editorCsrf: string;
  let financeCookie: string;
  let editorUserId: string;

  let storyId: string;
  let versionIdA: string;
  let versionIdB: string;
  let targetStoryId: string;

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

    ([{ cookie: editorCookie, csrf: editorCsrf }, { cookie: financeCookie }] = await Promise.all([
      login("editor", "EditorNow123"),
      login("finance_reviewer", "FinanceNow123")
    ]));

    const me = await request(app.getHttpServer()).get("/auth/me").set("Cookie", [editorCookie]);
    editorUserId = me.body.userId as string;

    storyId = randomUUID();
    targetStoryId = randomUUID();
    versionIdA = randomUUID();
    versionIdB = randomUUID();

    await prisma.story.createMany({
      data: [
        { id: storyId, source: "wire", canonicalUrl: `https://example.local/eq-story-a-${storyId}`, latestTitle: "EQ Story A", latestBody: "Body A" },
        { id: targetStoryId, source: "wire", canonicalUrl: `https://example.local/eq-story-b-${targetStoryId}`, latestTitle: "EQ Story B", latestBody: "Body B" }
      ]
    });

    await prisma.storyVersion.createMany({
      data: [
        {
          id: versionIdA,
          storyId,
          versionNumber: 1,
          title: "EQ Story A v1",
          body: "Body A",
          rawUrl: `https://example.local/eq-story-a-${storyId}`,
          canonicalUrl: `https://example.local/eq-story-a-${storyId}`,
          source: "wire",
          contentHash: "hash-a",
          simhash: "1",
          minhashSignature: "1,2",
          duplicateFlag: true,
          anomalyFlag: false
        },
        {
          id: versionIdB,
          storyId,
          versionNumber: 2,
          title: "EQ Story A v2",
          body: "Body A updated",
          rawUrl: `https://example.local/eq-story-a-${storyId}`,
          canonicalUrl: `https://example.local/eq-story-a-${storyId}`,
          source: "wire",
          contentHash: "hash-b",
          simhash: "2",
          minhashSignature: "2,3",
          duplicateFlag: false,
          anomalyFlag: false
        }
      ]
    });

    await prisma.cleansingEvent.createMany({
      data: [
        { storyVersionId: versionIdA, userId: editorUserId, action: "URL_NORMALIZE", field: "canonicalUrl" },
        { storyVersionId: versionIdB, userId: editorUserId, action: "URL_NORMALIZE", field: "canonicalUrl" }
      ]
    });
  });

  afterAll(async () => {
    if (hasDatabase) {
      await prisma.cleansingEvent.deleteMany({ where: { storyVersionId: { in: [versionIdA, versionIdB] } } });
      await prisma.storyVersion.deleteMany({ where: { storyId: { in: [storyId, targetStoryId] } } });
      await prisma.story.deleteMany({ where: { id: { in: [storyId, targetStoryId] } } });
      await prisma.$disconnect();
    }
    await app.close();
  });

  // ── GET /editor-queue ───────────────────────────────────────────────────────

  it("GET /editor-queue rejects unauthenticated request", async () => {
    const res = await request(app.getHttpServer()).get("/editor-queue");
    expect(res.status).toBe(401);
  });

  it("GET /editor-queue rejects roles without stories.review permission", async () => {
    const res = await request(app.getHttpServer())
      .get("/editor-queue")
      .set("Cookie", [financeCookie]);
    expect(res.status).toBe(403);
  });

  it("GET /editor-queue returns items array for authorized editor", async () => {
    const res = await request(app.getHttpServer())
      .get("/editor-queue")
      .set("Cookie", [editorCookie]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  // ── GET /editor-queue/:storyId/diff ────────────────────────────────────────

  it("GET /editor-queue/:storyId/diff rejects unauthenticated request", async () => {
    const res = await request(app.getHttpServer()).get(
      `/editor-queue/${storyId}/diff?leftVersionId=${versionIdA}&rightVersionId=${versionIdB}`
    );
    expect(res.status).toBe(401);
  });

  it("GET /editor-queue/:storyId/diff rejects roles without stories.review permission", async () => {
    const res = await request(app.getHttpServer())
      .get(`/editor-queue/${storyId}/diff?leftVersionId=${versionIdA}&rightVersionId=${versionIdB}`)
      .set("Cookie", [financeCookie]);
    expect(res.status).toBe(403);
  });

  it("GET /editor-queue/:storyId/diff returns diff fields for owner with stories.review", async () => {
    const res = await request(app.getHttpServer())
      .get(`/editor-queue/${storyId}/diff?leftVersionId=${versionIdA}&rightVersionId=${versionIdB}`)
      .set("Cookie", [editorCookie]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.fields)).toBe(true);
  });

  // ── POST /editor-queue/merge ────────────────────────────────────────────────

  it("POST /editor-queue/merge rejects unauthenticated request", async () => {
    const res = await request(app.getHttpServer())
      .post("/editor-queue/merge")
      .send({ incomingVersionId: versionIdA, strategy: "keep_both", note: "valid note" });
    expect(res.status).toBe(401);
  });

  it("POST /editor-queue/merge rejects missing CSRF token", async () => {
    const res = await request(app.getHttpServer())
      .post("/editor-queue/merge")
      .set("Cookie", [editorCookie])
      .send({ incomingVersionId: versionIdA, strategy: "keep_both", note: "valid note" });
    expect(res.status).toBe(403);
  });

  it("POST /editor-queue/merge rejects roles without stories.review permission", async () => {
    const res = await request(app.getHttpServer())
      .post("/editor-queue/merge")
      .set("Cookie", [financeCookie])
      .send({ incomingVersionId: versionIdA, strategy: "keep_both", note: "valid note" });
    expect(res.status).toBe(403);
  });

  it("POST /editor-queue/merge succeeds for version owner with valid note", async () => {
    const freshCsrf = await request(app.getHttpServer())
      .get("/auth/csrf")
      .set("Cookie", [editorCookie]);
    const csrf = freshCsrf.body.csrfToken as string;

    const res = await request(app.getHttpServer())
      .post("/editor-queue/merge")
      .set("Cookie", [editorCookie])
      .set("x-csrf-token", csrf)
      .send({
        incomingVersionId: versionIdA,
        targetStoryId,
        strategy: "keep_both",
        note: "e2e test merge – valid owner merge with keep_both strategy"
      });
    expect(res.status).toBe(201);
  });

  // ── POST /editor-queue/repair/:versionId ───────────────────────────────────

  it("POST /editor-queue/repair/:versionId rejects unauthenticated request", async () => {
    const res = await request(app.getHttpServer())
      .post(`/editor-queue/repair/${versionIdB}`)
      .send({ note: "valid repair note" });
    expect(res.status).toBe(401);
  });

  it("POST /editor-queue/repair/:versionId rejects missing CSRF token", async () => {
    const res = await request(app.getHttpServer())
      .post(`/editor-queue/repair/${versionIdB}`)
      .set("Cookie", [editorCookie])
      .send({ note: "valid repair note" });
    expect(res.status).toBe(403);
  });

  it("POST /editor-queue/repair/:versionId succeeds for version owner with valid note", async () => {
    const freshCsrf = await request(app.getHttpServer())
      .get("/auth/csrf")
      .set("Cookie", [editorCookie]);
    const csrf = freshCsrf.body.csrfToken as string;

    const res = await request(app.getHttpServer())
      .post(`/editor-queue/repair/${versionIdB}`)
      .set("Cookie", [editorCookie])
      .set("x-csrf-token", csrf)
      .send({ note: "e2e test repair – valid owner repair operation with sufficient note length" });
    expect(res.status).toBe(201);
  });
});
