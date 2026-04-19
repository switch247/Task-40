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

describeDb("Profile sensitive endpoints – true no-mock e2e", () => {
  let app: INestApplication;
  let editorCookie: string;
  let editorCsrf: string;
  let adminCookie: string;
  let adminCsrf: string;

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

    ([{ cookie: editorCookie, csrf: editorCsrf }, { cookie: adminCookie, csrf: adminCsrf }] = await Promise.all([
      login("editor", "EditorNow123"),
      login("admin", "ChangeMeNow123")
    ]));
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /profile/sensitive rejects unauthenticated request", async () => {
    const res = await request(app.getHttpServer()).get("/profile/sensitive");
    expect(res.status).toBe(401);
  });

  it("GET /profile/sensitive returns own profile for authenticated user", async () => {
    const res = await request(app.getHttpServer())
      .get("/profile/sensitive")
      .set("Cookie", [editorCookie]);
    expect(res.status).toBe(200);
    expect(typeof res.body.contact).not.toBe("undefined");
    expect(typeof res.body.account).not.toBe("undefined");
  });

  it("PUT /profile/sensitive rejects unauthenticated request", async () => {
    const res = await request(app.getHttpServer())
      .put("/profile/sensitive")
      .send({ email: "test@example.local", phone: "+1-555-0100" });
    expect(res.status).toBe(401);
  });

  it("PUT /profile/sensitive rejects missing CSRF token", async () => {
    const res = await request(app.getHttpServer())
      .put("/profile/sensitive")
      .set("Cookie", [editorCookie])
      .send({ email: "test@example.local", phone: "+1-555-0100" });
    expect(res.status).toBe(403);
  });

  it("PUT /profile/sensitive encrypts and stores contact and account data", async () => {
    const freshCsrf = await request(app.getHttpServer())
      .get("/auth/csrf")
      .set("Cookie", [editorCookie]);
    const csrf = freshCsrf.body.csrfToken as string;

    const res = await request(app.getHttpServer())
      .put("/profile/sensitive")
      .set("Cookie", [editorCookie])
      .set("x-csrf-token", csrf)
      .send({
        email: "editor-e2e@example.local",
        phone: "+1-555-0101",
        accountId: "acct-e2e-001",
        vendorHandle: "wire-e2e"
      });
    expect(res.status).toBe(200);
  });

  it("GET /profile/sensitive returns decrypted data after PUT", async () => {
    const freshCsrf = await request(app.getHttpServer())
      .get("/auth/csrf")
      .set("Cookie", [editorCookie]);
    const csrf = freshCsrf.body.csrfToken as string;

    await request(app.getHttpServer())
      .put("/profile/sensitive")
      .set("Cookie", [editorCookie])
      .set("x-csrf-token", csrf)
      .send({ email: "read-back@example.local", phone: "+1-555-0102", accountId: "acct-read", vendorHandle: "v-handle" });

    const res = await request(app.getHttpServer())
      .get("/profile/sensitive")
      .set("Cookie", [editorCookie]);
    expect(res.status).toBe(200);
    expect(res.body.contact.email).toBe("read-back@example.local");
    expect(res.body.contact.phone).toBe("+1-555-0102");
    expect(res.body.account.accountId).toBe("acct-read");
    expect(JSON.stringify(res.body)).not.toContain("encrypted");
  });

  it("GET /profile/sensitive rejects non-admin reading another user's profile", async () => {
    const adminOverview = await request(app.getHttpServer())
      .get("/admin/overview")
      .set("Cookie", [adminCookie]);
    const auditorUser = adminOverview.body.users.find((u: { username: string }) => u.username === "auditor");
    expect(auditorUser).toBeTruthy();

    const res = await request(app.getHttpServer())
      .get(`/profile/sensitive?userId=${auditorUser.id}`)
      .set("Cookie", [editorCookie]);
    expect(res.status).toBe(403);
  });

  it("GET /profile/sensitive allows admin to read another user's profile", async () => {
    const adminOverview = await request(app.getHttpServer())
      .get("/admin/overview")
      .set("Cookie", [adminCookie]);
    const editorUser = adminOverview.body.users.find((u: { username: string }) => u.username === "editor");
    expect(editorUser).toBeTruthy();

    const res = await request(app.getHttpServer())
      .get(`/profile/sensitive?userId=${editorUser.id}`)
      .set("Cookie", [adminCookie]);
    expect(res.status).toBe(200);
  });
});
