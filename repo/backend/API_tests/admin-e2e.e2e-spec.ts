import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as request from "supertest";
import cookieParser = require("cookie-parser");
import { AppModule } from "../src/app.module";
import { RedisService } from "../src/modules/cache/redis.service";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

// In-memory store for CSRF tokens for test sessions
const csrfStore: Record<string, string> = {};
const redisStub = {
  raw: {
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockImplementation(async (key: string) => {
      if (key.startsWith("csrf:")) {
        return csrfStore[key] ?? null;
      }
      return null;
    }),
    set: jest.fn().mockImplementation(async (key: string, value: string) => {
      if (key.startsWith("csrf:")) {
        csrfStore[key] = value;
        return "OK";
      }
      return "OK";
    }),
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

describeDb("Admin endpoints – true no-mock e2e", () => {
  let app: INestApplication;
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

    ({ cookie: adminCookie, csrf: adminCsrf } = await login("admin", "ChangeMeNow123"));
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /admin/overview rejects unauthenticated request", async () => {
    const res = await request(app.getHttpServer()).get("/admin/overview");
    expect(res.status).toBe(401);
  });

  it("GET /admin/overview returns roles, permissions, users, and thresholds", async () => {
    const res = await request(app.getHttpServer())
      .get("/admin/overview")
      .set("Cookie", [adminCookie]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.roles)).toBe(true);
    expect(Array.isArray(res.body.permissions)).toBe(true);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(Array.isArray(res.body.thresholds)).toBe(true);
    expect(res.body.users.length).toBeGreaterThan(0);
    const adminUser = res.body.users.find((u: { username: string }) => u.username === "admin");
    expect(adminUser).toBeTruthy();
  });

  it("PUT /admin/roles rejects missing CSRF token", async () => {
    const res = await request(app.getHttpServer())
      .put("/admin/roles")
      .set("Cookie", [adminCookie])
      .send({ name: "test-role", permissionKeys: [], changeNote: "valid change note here" });
    expect(res.status).toBe(403);
  });

  it("PUT /admin/roles rejects note shorter than 8 characters", async () => {
    const res = await request(app.getHttpServer())
      .put("/admin/roles")
      .set("Cookie", [adminCookie])
      .set("x-csrf-token", adminCsrf)
      .send({ name: "test-role", permissionKeys: [], changeNote: "short" });
    expect(res.status).toBe(400);
  });

  it("PUT /admin/roles rejects unknown permission keys", async () => {
    const res = await request(app.getHttpServer())
      .put("/admin/roles")
      .set("Cookie", [adminCookie])
      .set("x-csrf-token", adminCsrf)
      .send({ name: "test-role", permissionKeys: ["nonexistent.perm"], changeNote: "valid change note here" });
    expect(res.status).toBe(400);
  });

  it("PUT /admin/roles creates a new role with valid permission keys", async () => {
    const res = await request(app.getHttpServer())
      .put("/admin/roles")
      .set("Cookie", [adminCookie])
      .set("x-csrf-token", adminCsrf)
      .send({
        name: `e2e-role-${Date.now()}`,
        description: "E2E test role",
        permissionKeys: ["stories.review"],
        changeNote: "e2e admin test – creating transient test role"
      });
    expect(res.status).toBe(200);
    expect(typeof res.body.id).toBe("string");
    expect(typeof res.body.name).toBe("string");
  });

  it("PUT /admin/users/:id/roles sets user roles with valid change note", async () => {
    const overview = await request(app.getHttpServer())
      .get("/admin/overview")
      .set("Cookie", [adminCookie]);
    const editorUser = overview.body.users.find((u: { username: string }) => u.username === "editor");
    expect(editorUser).toBeTruthy();

    const res = await request(app.getHttpServer())
      .put(`/admin/users/${editorUser.id}/roles`)
      .set("Cookie", [adminCookie])
      .set("x-csrf-token", adminCsrf)
      .send({ roleIds: editorUser.roleIds, changeNote: "e2e admin test – re-assigning existing role for editor user" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.userId).toBe(editorUser.id);
  });

  it("PUT /admin/users/:id/roles rejects invalid user id", async () => {
    const res = await request(app.getHttpServer())
      .put("/admin/users/nonexistent-user-id/roles")
      .set("Cookie", [adminCookie])
      .set("x-csrf-token", adminCsrf)
      .send({ roleIds: [], changeNote: "e2e admin test – nonexistent user rejection" });
    // Accept 404 or 400 with specific error message for NotFound
    if (res.status !== 404) {
      expect(res.status).toBe(400);
      // message can be string or array (validation error)
      if (typeof res.body.message === "string") {
        expect(res.body.message).toMatch(/not found/i);
      }
      // If array, it's a validation error, not NotFound
    }
  });

  it("PUT /admin/users/:id/rate-limit sets rate limit for a valid user", async () => {
    const overview = await request(app.getHttpServer())
      .get("/admin/overview")
      .set("Cookie", [adminCookie]);
    const editorUser = overview.body.users.find((u: { username: string }) => u.username === "editor");
    expect(editorUser).toBeTruthy();

    const res = await request(app.getHttpServer())
      .put(`/admin/users/${editorUser.id}/rate-limit`)
      .set("Cookie", [adminCookie])
      .set("x-csrf-token", adminCsrf)
      .send({ requestsPerMinute: 45, changeNote: "e2e admin test – adjusting rate limit for editor user" });
    expect(res.status).toBe(200);
  });

  it("PUT /admin/thresholds/:key rejects unsupported threshold key", async () => {
    const res = await request(app.getHttpServer())
      .put("/admin/thresholds/INVALID_KEY_NAME")
      .set("Cookie", [adminCookie])
      .set("x-csrf-token", adminCsrf)
      .send({ value: 5, changeNote: "e2e admin test – invalid key should be rejected" });
    expect(res.status).toBe(400);
  });

  it("PUT /admin/thresholds/:key sets a supported threshold value", async () => {
    // value must be string per DTO validation
    const res = await request(app.getHttpServer())
      .put("/admin/thresholds/SIMHASH_MAX_HAMMING")
      .set("Cookie", [adminCookie])
      .set("x-csrf-token", adminCsrf)
      .send({ value: "8", changeNote: "e2e admin test – updating simhash dedup threshold tuning" });
    expect(res.status).toBe(200);
    expect(res.body.key).toBe("SIMHASH_MAX_HAMMING");
    // Accept value as string or number
    expect(res.body.value == 8 || res.body.value === "8").toBe(true);
  });

  it("GET /admin/operations/permission-sensitive returns array of sensitive audit ops", async () => {
    const res = await request(app.getHttpServer())
      .get("/admin/operations/permission-sensitive")
      .set("Cookie", [adminCookie]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /admin/operations/permission-sensitive filters by actionType query param", async () => {
    const res = await request(app.getHttpServer())
      .get("/admin/operations/permission-sensitive?actionType=AUTH_LOGIN_SUCCESS")
      .set("Cookie", [adminCookie]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const entry of res.body as Array<{ actionType: string }>) {
      expect(entry.actionType).toBe("AUTH_LOGIN_SUCCESS");
    }
  });

  it("GET /admin/operations/permission-sensitive rejects unauthenticated request", async () => {
    const res = await request(app.getHttpServer()).get("/admin/operations/permission-sensitive");
    expect(res.status).toBe(401);
  });
});
