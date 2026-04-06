import { ForbiddenException } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { AuthService } from "../src/security/auth/auth.service";

describe("AuthService seeded credential hardening", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("blocks login with deterministic seeded password in non-dev by default", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_DEFAULT_SEED_PASSWORD_LOGIN;

    const passwordHash = await bcrypt.hash("ChangeMeNow123", 4);
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "u-admin",
          username: "admin",
          passwordHash,
          mfaEnabled: false,
          failedAttempts: 0,
          lockedUntil: null
        }),
        update: jest.fn()
      },
      $transaction: jest.fn()
    } as any;

    const sessions = { create: jest.fn() } as any;
    const mfa = { verifyCode: jest.fn(), generateOpaqueToken: jest.fn() } as any;
    const encryption = { decrypt: jest.fn() } as any;
    const service = new AuthService(prisma, sessions, mfa, encryption);

    await expect(service.login({ username: "admin", password: "ChangeMeNow123" })).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it("allows seeded-password login in non-dev only with explicit override flag", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_DEFAULT_SEED_PASSWORD_LOGIN = "true";

    const passwordHash = await bcrypt.hash("ChangeMeNow123", 4);
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "u-admin",
          username: "admin",
          passwordHash,
          mfaEnabled: false,
          failedAttempts: 0,
          lockedUntil: null
        }),
        update: jest.fn().mockResolvedValue(undefined)
      },
      $transaction: jest.fn()
    } as any;

    const sessions = { create: jest.fn().mockResolvedValue({ id: "s1" }) } as any;
    const mfa = {
      verifyCode: jest.fn(),
      generateOpaqueToken: jest.fn().mockReturnValue("csrf-token")
    } as any;
    const encryption = { decrypt: jest.fn() } as any;
    const service = new AuthService(prisma, sessions, mfa, encryption);

    const result = await service.login({ username: "admin", password: "ChangeMeNow123" });
    expect(result.status).toBe("ok");
    expect(sessions.create).toHaveBeenCalled();
  });

  it("skips deterministic seeded user creation in non-dev unless explicitly allowed", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_DETERMINISTIC_SEED_CREDENTIALS;

    const tx = {
      permission: {
        upsert: jest.fn().mockImplementation(async ({ where }: { where: { key: string } }) => ({ id: `perm-${where.key}` }))
      },
      role: {
        upsert: jest.fn().mockImplementation(async ({ where }: { where: { name: string } }) => ({ id: `role-${where.name}` }))
      },
      rolePermission: {
        upsert: jest.fn().mockResolvedValue(undefined)
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn()
      },
      userRole: {
        upsert: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    const prisma = {
      $transaction: jest.fn().mockImplementation(async (callback: (input: any) => Promise<void>) => callback(tx))
    } as any;

    const service = new AuthService(prisma, {} as any, {} as any, {} as any);
    await service.registerSeedUser();

    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it("allows deterministic seeded user creation in non-dev when ENABLE_SEEDING=true", async () => {
    process.env.NODE_ENV = "production";
    process.env.ENABLE_SEEDING = "true";
    delete process.env.ALLOW_DETERMINISTIC_SEED_CREDENTIALS;

    const tx = {
      permission: {
        upsert: jest.fn().mockImplementation(async ({ where }: { where: { key: string } }) => ({ id: `perm-${where.key}` }))
      },
      role: {
        upsert: jest.fn().mockImplementation(async ({ where }: { where: { name: string } }) => ({ id: `role-${where.name}` }))
      },
      rolePermission: {
        upsert: jest.fn().mockResolvedValue(undefined)
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "seed-admin" })
      },
      userRole: {
        upsert: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    const prisma = {
      $transaction: jest.fn().mockImplementation(async (callback: (input: any) => Promise<void>) => callback(tx))
    } as any;

    const service = new AuthService(prisma, {} as any, {} as any, {} as any);
    await service.registerSeedUser();

    expect(tx.user.create).toHaveBeenCalled();
  });
});
