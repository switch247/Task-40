import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHash } from "crypto";
import * as request from "supertest";
import cookieParser = require("cookie-parser");
import { AlertsV1Controller } from "../src/api/v1/alerts-v1.controller";
import { AlertsV2Controller } from "../src/api/v2/alerts-v2.controller";
import { PermissionGuard } from "../src/common/guards/permission.guard";
import { SessionGuard } from "../src/common/guards/session.guard";
import { JobsService } from "../src/modules/jobs/jobs.service";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { CsrfGuard } from "../src/security/csrf/csrf.guard";

type AlertsController = typeof AlertsV1Controller | typeof AlertsV2Controller;

async function buildApp(controller: AlertsController): Promise<INestApplication> {
  const csrfToken = "csrf-good";
  const csrfTokenHash = createHash("sha256").update(csrfToken).digest("hex");

  const moduleRef = await Test.createTestingModule({
    controllers: [controller],
    providers: [
      CsrfGuard,
      {
        provide: PrismaService,
        useValue: {
          session: {
            findUnique: jest.fn().mockImplementation(({ where: { id } }: any) => {
              if (id === "sid-good") {
                return { id, csrfTokenHash };
              }
              return null;
            })
          },
          alertEvent: {
            update: jest.fn().mockResolvedValue({ id: "alert-1", status: "RESOLVED" })
          }
        }
      },
      {
        provide: JobsService,
        useValue: { getStatusSummary: jest.fn().mockResolvedValue({ queueDepth: 0 }) }
      }
    ]
  })
    .overrideGuard(SessionGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(PermissionGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();
  return app;
}

describe("Alerts resolve CSRF enforcement (e2e)", () => {
  async function runCsrfSuite(controller: AlertsController): Promise<void> {
    const app = await buildApp(controller);
    const server = app.getHttpServer();

    const missing = await request(server)
      .patch("/alerts/alert-1/resolve")
      .set("Cookie", ["sid=sid-good"]);
    expect(missing.status).toBe(403);

    const invalid = await request(server)
      .patch("/alerts/alert-1/resolve")
      .set("Cookie", ["sid=sid-good"])
      .set("x-csrf-token", "csrf-invalid");
    expect(invalid.status).toBe(403);

    const valid = await request(server)
      .patch("/alerts/alert-1/resolve")
      .set("Cookie", ["sid=sid-good"])
      .set("x-csrf-token", "csrf-good");
    expect(valid.status).toBe(200);
    expect(valid.body.status).toBe("ok");

    await app.close();
  }

  it("rejects missing/invalid csrf token for v1 resolve endpoint", async () => {
    await runCsrfSuite(AlertsV1Controller);
  });

  it("rejects missing/invalid csrf token for v2 resolve endpoint", async () => {
    await runCsrfSuite(AlertsV2Controller);
  });
});
