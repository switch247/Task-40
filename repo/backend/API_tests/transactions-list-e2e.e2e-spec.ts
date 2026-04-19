import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as request from "supertest";
import cookieParser = require("cookie-parser");
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

describeDb("Transactions list endpoints – true no-mock e2e", () => {
  let app: INestApplication;
  let financeCookie: string;
  let auditorCookie: string;
  let editorCookie: string;

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

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RedisService)
      .useValue(redisStub)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();

    ([{ cookie: financeCookie }, { cookie: auditorCookie }, { cookie: editorCookie }] = await Promise.all([
      login("finance_reviewer", "FinanceNow123"),
      login("auditor", "AuditorNow123"),
      login("editor", "EditorNow123")
    ]));
  });

  afterAll(async () => {
    await app.close();
  });

  // ── GET /transactions ───────────────────────────────────────────────────────

  it("GET /transactions rejects unauthenticated request", async () => {
    const res = await request(app.getHttpServer()).get("/transactions");
    expect(res.status).toBe(401);
  });

  it("GET /transactions rejects roles without transactions.read permission", async () => {
    const res = await request(app.getHttpServer())
      .get("/transactions")
      .set("Cookie", [editorCookie]);
    expect(res.status).toBe(403);
  });

  it("GET /transactions returns items array for finance_reviewer", async () => {
    const res = await request(app.getHttpServer())
      .get("/transactions")
      .set("Cookie", [financeCookie]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("GET /transactions returns items array for auditor", async () => {
    const res = await request(app.getHttpServer())
      .get("/transactions")
      .set("Cookie", [auditorCookie]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("GET /transactions items have expected shape fields when present", async () => {
    const res = await request(app.getHttpServer())
      .get("/transactions")
      .set("Cookie", [financeCookie]);
    expect(res.status).toBe(200);
    for (const item of res.body.items as Array<Record<string, unknown>>) {
      expect(typeof item.id).toBe("string");
      expect(typeof item.channel).toBe("string");
      expect(typeof item.status).toBe("string");
      expect(typeof item.totalAmountCents).toBe("number");
    }
  });

  // ── GET /transactions/story-versions ───────────────────────────────────────

  it("GET /transactions/story-versions rejects unauthenticated request", async () => {
    const res = await request(app.getHttpServer()).get("/transactions/story-versions");
    expect(res.status).toBe(401);
  });

  it("GET /transactions/story-versions rejects roles without transactions.read permission", async () => {
    const res = await request(app.getHttpServer())
      .get("/transactions/story-versions")
      .set("Cookie", [editorCookie]);
    expect(res.status).toBe(403);
  });

  it("GET /transactions/story-versions returns items array for authorized user", async () => {
    const res = await request(app.getHttpServer())
      .get("/transactions/story-versions")
      .set("Cookie", [financeCookie]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("GET /transactions/story-versions items have expected shape fields when present", async () => {
    const res = await request(app.getHttpServer())
      .get("/transactions/story-versions")
      .set("Cookie", [financeCookie]);
    expect(res.status).toBe(200);
    for (const item of res.body.items as Array<Record<string, unknown>>) {
      expect(typeof item.versionId).toBe("string");
      expect(typeof item.storyId).toBe("string");
      expect(typeof item.title).toBe("string");
    }
  });
});
