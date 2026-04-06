import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { createHash } from "crypto";
import * as request from "supertest";
import cookieParser = require("cookie-parser");
import { TransactionsV1Controller } from "../src/api/v1/transactions-v1.controller";
import { PermissionGuard } from "../src/common/guards/permission.guard";
import { SessionGuard } from "../src/common/guards/session.guard";
import { HotReadCacheService } from "../src/modules/cache/hot-read-cache.service";
import { LedgerService } from "../src/modules/ledger/ledger.service";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { CreateRefundDto } from "../src/modules/refunds/dto/create-refund.dto";
import { RefundsService } from "../src/modules/refunds/refunds.service";
import { AuditLogsService } from "../src/modules/audit-logs/audit-logs.service";
import { FreezesService } from "../src/modules/freezes/freezes.service";
import { TransactionsService } from "../src/modules/transactions/transactions.service";
import { SessionService } from "../src/security/auth/session.service";
import { CsrfGuard } from "../src/security/csrf/csrf.guard";

describe("Transactions object authorization (e2e)", () => {
  let app: INestApplication;

  const sessions = {
    "sid-owner": {
      id: "sid-owner",
      userId: "owner-user",
      roles: ["finance"],
      permissions: ["transactions.read", "finance.refund", "finance.freeze"]
    },
    "sid-other": {
      id: "sid-other",
      userId: "other-user",
      roles: ["finance"],
      permissions: ["transactions.read", "finance.refund", "finance.freeze"]
    },
    "sid-no-read": {
      id: "sid-no-read",
      userId: "reader-no-access",
      roles: ["finance"],
      permissions: ["finance.refund"]
    },
    "sid-read-only": {
      id: "sid-read-only",
      userId: "reader-only",
      roles: ["finance"],
      permissions: ["transactions.read"]
    },
    "sid-auditor": {
      id: "sid-auditor",
      userId: "auditor-user",
      roles: ["auditor"],
      permissions: ["transactions.read", "audit.read", "auditor.release_freeze"]
    }
  } as const;

  const csrfBySid: Record<string, string> = {
    "sid-owner": "csrf-owner",
    "sid-other": "csrf-other",
    "sid-no-read": "csrf-no-read",
    "sid-read-only": "csrf-read-only",
    "sid-auditor": "csrf-auditor"
  };

  const prisma = {
    transaction: {
      findUnique: jest.fn().mockResolvedValue({
        id: "tx-1",
        status: "APPROVED",
        totalAmountCents: 5000,
        reference: "TX-1",
        createdByUserId: "owner-user",
        approvedByUserId: null,
        storyVersionId: null,
        statusExplanation: "approved"
      })
    },
    fundLedger: {
      findMany: jest.fn().mockResolvedValue([])
    },
    refundCase: {
      findMany: jest.fn().mockResolvedValue([])
    },
    freezeCase: {
      findMany: jest.fn().mockResolvedValue([])
    },
    immutableAuditLog: {
      findMany: jest.fn().mockResolvedValue([])
    },
    storyVersion: {
      findMany: jest.fn().mockResolvedValue([])
    },
    session: {
      findUnique: jest.fn().mockImplementation(({ where: { id } }: { where: { id: string } }) => {
        const token = csrfBySid[id];
        if (!token) {
          return null;
        }
        return {
          id,
          csrfTokenHash: createHash("sha256").update(token).digest("hex")
        };
      })
    }
  } as unknown as PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TransactionsV1Controller],
      providers: [
        TransactionsService,
        RefundsService,
        FreezesService,
        {
          provide: SessionService,
          useValue: {
            validateAndRefresh: jest
              .fn()
              .mockImplementation((sid: string) => sessions[sid as keyof typeof sessions] ?? null)
          }
        },
        { provide: PrismaService, useValue: prisma },
        { provide: HotReadCacheService, useValue: { getOrLoad: jest.fn((_key, loader) => loader()), invalidatePatterns: jest.fn() } },
        { provide: LedgerService, useValue: { appendEntry: jest.fn(), getRefundedCents: jest.fn().mockResolvedValue(0) } },
        { provide: AuditLogsService, useValue: { write: jest.fn() } },
        Reflector,
        SessionGuard,
        PermissionGuard,
        CsrfGuard
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /transactions/:id/history returns 401 when unauthenticated", async () => {
    const response = await request(app.getHttpServer()).get("/transactions/tx-1/history");
    expect(response.status).toBe(401);
  });

  it("GET /transactions/:id/history returns 403 when route permission is missing", async () => {
    const response = await request(app.getHttpServer())
      .get("/transactions/tx-1/history")
      .set("Cookie", ["sid=sid-no-read"]);
    expect(response.status).toBe(403);
  });

  it("GET /transactions/:id/history returns 403 for non-owner actor even with transactions.read", async () => {
    const response = await request(app.getHttpServer())
      .get("/transactions/tx-1/history")
      .set("Cookie", ["sid=sid-other"]);
    expect(response.status).toBe(403);
  });

  it("GET /transactions/:id/history returns 200 for auditor access", async () => {
    const response = await request(app.getHttpServer())
      .get("/transactions/tx-1/history")
      .set("Cookie", ["sid=sid-auditor"]);
    expect(response.status).toBe(200);
    expect(response.body.transaction?.id).toBe("tx-1");
  });

  it("POST /transactions/:id/refunds returns 403 when finance.refund permission is missing", async () => {
    const payload: CreateRefundDto = {
      type: "partial",
      amountCents: 100,
      storyVersionId: "3f6b1bf8-f5c8-48eb-b015-97fd3516b726",
      note: "valid note"
    };

    const response = await request(app.getHttpServer())
      .post("/transactions/tx-1/refunds")
      .set("Cookie", ["sid=sid-read-only"])
      .set("x-csrf-token", "csrf-read-only")
      .send(payload);
    expect(response.status).toBe(403);
  });

  it("POST /transactions/:id/approve returns 403 when finance.review permission is missing", async () => {
    const response = await request(app.getHttpServer())
      .post("/transactions/tx-1/approve")
      .set("Cookie", ["sid=sid-read-only"])
      .set("x-csrf-token", "csrf-read-only")
      .send({ note: "valid note" });
    expect(response.status).toBe(403);
  });

  it("POST /transactions/:id/refunds returns 403 when finance.refund permission is missing", async () => {
    const payload: CreateRefundDto = {
      type: "full",
      storyVersionId: "3f6b1bf8-f5c8-48eb-b015-97fd3516b726",
      note: "valid note"
    };

    const response = await request(app.getHttpServer())
      .post("/transactions/tx-1/refunds")
      .set("Cookie", ["sid=sid-read-only"])
      .set("x-csrf-token", "csrf-read-only")
      .send(payload);
    expect(response.status).toBe(403);
  });

  it("POST /transactions/:id/freeze returns 403 when finance.freeze permission is missing", async () => {
    const response = await request(app.getHttpServer())
      .post("/transactions/tx-1/freeze")
      .set("Cookie", ["sid=sid-read-only"])
      .set("x-csrf-token", "csrf-read-only")
      .send({ note: "valid note" });
    expect(response.status).toBe(403);
  });

  it("POST /transactions/:id/release returns 403 for object-level unauthorized actor", async () => {
    const response = await request(app.getHttpServer())
      .post("/transactions/tx-1/release")
      .set("Cookie", ["sid=sid-other"])
      .set("x-csrf-token", "csrf-other")
      .send({ note: "valid note" });
    expect(response.status).toBe(403);
  });
});
