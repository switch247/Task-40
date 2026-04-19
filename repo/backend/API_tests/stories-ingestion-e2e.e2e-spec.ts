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

describeDb("Stories and Ingestion endpoints – true no-mock e2e", () => {
  let app: INestApplication;
  let editorCookie: string;
  let editorCsrf: string;
  let financeCookie: string;

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

    ({ cookie: editorCookie, csrf: editorCsrf } = await login("editor", "EditorNow123"));
    ({ cookie: financeCookie } = await login("finance_reviewer", "FinanceNow123"));
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Stories ────────────────────────────────────────────────────────────────

  it("GET /stories rejects unauthenticated request", async () => {
    const res = await request(app.getHttpServer()).get("/stories");
    expect(res.status).toBe(401);
  });

  it("GET /stories returns 403 for roles without stories.review permission", async () => {
    const res = await request(app.getHttpServer())
      .get("/stories")
      .set("Cookie", [financeCookie]);
    expect(res.status).toBe(403);
  });

  it("GET /stories returns items array for authorized editor", async () => {
    const res = await request(app.getHttpServer())
      .get("/stories")
      .set("Cookie", [editorCookie]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("GET /stories accepts optional query filter and returns matching items", async () => {
    const res = await request(app.getHttpServer())
      .get("/stories?q=example")
      .set("Cookie", [editorCookie]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  // ── Ingestion: url-batch ────────────────────────────────────────────────────

  it("POST /ingestion/url-batch rejects unauthenticated request", async () => {
    const res = await request(app.getHttpServer())
      .post("/ingestion/url-batch")
      .send({ urls: ["https://example.local/story-1"], source: "wire" });
    expect(res.status).toBe(401);
  });

  it("POST /ingestion/url-batch rejects missing urls field", async () => {
    const res = await request(app.getHttpServer())
      .post("/ingestion/url-batch")
      .set("Cookie", [editorCookie])
      .set("x-csrf-token", editorCsrf)
      .send({ source: "wire" });
    expect(res.status).toBe(400);
  });

  it("POST /ingestion/url-batch rejects empty urls array", async () => {
    const res = await request(app.getHttpServer())
      .post("/ingestion/url-batch")
      .set("Cookie", [editorCookie])
      .set("x-csrf-token", editorCsrf)
      .send({ urls: [], source: "wire" });
    expect(res.status).toBe(400);
  });

  it("POST /ingestion/url-batch ingests valid URLs and returns processing counts", async () => {
    const res = await request(app.getHttpServer())
      .post("/ingestion/url-batch")
      .set("Cookie", [editorCookie])
      .set("x-csrf-token", editorCsrf)
      .send({ urls: [`https://example.local/e2e-story-${Date.now()}`], source: "wire" });
    expect(res.status).toBe(201);
    expect(typeof res.body.accepted).toBe("number");
    expect(typeof res.body.rejected).toBe("number");
  });

  it("POST /ingestion/url-batch rejects roles without stories.review permission", async () => {
    const res = await request(app.getHttpServer())
      .post("/ingestion/url-batch")
      .set("Cookie", [financeCookie])
      .send({ urls: ["https://example.local/story-fin"], source: "wire" });
    expect(res.status).toBe(403);
  });

  // ── Ingestion: upload ───────────────────────────────────────────────────────

  it("POST /ingestion/upload rejects unauthenticated request", async () => {
    const res = await request(app.getHttpServer())
      .post("/ingestion/upload")
      .field("source", "wire");
    expect(res.status).toBe(401);
  });

  it("POST /ingestion/upload rejects request without file", async () => {
    const res = await request(app.getHttpServer())
      .post("/ingestion/upload")
      .set("Cookie", [editorCookie])
      .set("x-csrf-token", editorCsrf)
      .field("source", "wire");
    expect(res.status).toBe(400);
  });

  it("POST /ingestion/upload accepts a valid CSV file and returns processing counts", async () => {
    const uniqueUrl = `https://example.local/e2e-csv-upload-${Date.now()}`;
    const csvContent = `url,source\n${uniqueUrl},wire`;
    const res = await request(app.getHttpServer())
      .post("/ingestion/upload")
      .set("Cookie", [editorCookie])
      .set("x-csrf-token", editorCsrf)
      .field("source", "wire")
      .attach("file", Buffer.from(csvContent), { filename: "test.csv", contentType: "text/csv" });
    expect(res.status).toBe(201);
    expect(typeof res.body.accepted).toBe("number");
    expect(typeof res.body.rejected).toBe("number");
  });

  it("POST /ingestion/upload accepts a valid JSON file and returns processing counts", async () => {
    const uniqueUrl = `https://example.local/e2e-json-upload-${Date.now()}`;
    const jsonContent = JSON.stringify([{ url: uniqueUrl, source: "wire" }]);
    const res = await request(app.getHttpServer())
      .post("/ingestion/upload")
      .set("Cookie", [editorCookie])
      .set("x-csrf-token", editorCsrf)
      .field("source", "wire")
      .attach("file", Buffer.from(jsonContent), { filename: "test.json", contentType: "application/json" });
    expect(res.status).toBe(201);
    expect(typeof res.body.accepted).toBe("number");
  });
});
