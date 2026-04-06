import {
  ForbiddenException,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../modules/prisma/prisma.service";
import { FieldEncryptionService } from "../crypto/field-encryption.service";
import { MfaService } from "../mfa/mfa.service";
import { LoginDto } from "./dto/login.dto";
import { SessionService } from "./session.service";

const LOCKOUT_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

function isLocalDevelopmentMode(): boolean {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

function deterministicSeedCredentialsAllowed(): boolean {
  if (isLocalDevelopmentMode()) {
    return true;
  }
  if (process.env.ENABLE_SEEDING === "true") {
    return true;
  }
  return process.env.ALLOW_DETERMINISTIC_SEED_CREDENTIALS === "true";
}

function defaultSeedPasswordLoginAllowed(): boolean {
  if (isLocalDevelopmentMode()) {
    return true;
  }
  return process.env.ALLOW_DEFAULT_SEED_PASSWORD_LOGIN === "true";
}

const SEEDED_USERS = [
  {
    username: "admin",
    password: "ChangeMeNow123",
    role: "admin"
  },
  {
    username: "editor",
    password: "EditorNow123",
    role: "editor"
  },
  {
    username: "finance_reviewer",
    password: "FinanceNow123",
    role: "finance_reviewer"
  },
  {
    username: "auditor",
    password: "AuditorNow123",
    role: "auditor"
  }
] as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly mfaService: MfaService,
    private readonly encryption: FieldEncryptionService
  ) {}

  async login(dto: LoginDto): Promise<{
    status: "ok" | "mfa_required";
    sessionId?: string;
    csrfToken?: string;
    user?: { id: string; username: string };
  }> {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException("Account is locked due to repeated failed attempts");
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      const attempts = user.failedAttempts + 1;
      const lock = attempts >= LOCKOUT_ATTEMPTS ? new Date(Date.now() + LOCKOUT_WINDOW_MS) : null;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedAttempts: attempts % LOCKOUT_ATTEMPTS, lockedUntil: lock }
      });
      throw new UnauthorizedException("Invalid credentials");
    }

    if (!defaultSeedPasswordLoginAllowed()) {
      for (const seededUser of SEEDED_USERS) {
        const usesDefaultSeedPassword = await bcrypt.compare(seededUser.password, user.passwordHash);
        if (usesDefaultSeedPassword) {
          throw new ForbiddenException(
            "Default seeded password detected. Rotate this account password before non-development login."
          );
        }
      }
    }

    if (user.mfaEnabled) {
      if (!dto.totpCode) {
        return { status: "mfa_required" };
      }
      if (!user.mfaSecretCipher) {
        throw new ForbiddenException("MFA is enabled but secret is missing");
      }
      const secret = this.encryption.decrypt(user.mfaSecretCipher);
      const validTotp = this.mfaService.verifyCode(secret, dto.totpCode);
      if (!validTotp) {
        throw new UnauthorizedException("Invalid MFA code");
      }
    }

    const rawCsrfToken = this.mfaService.generateOpaqueToken();
    const csrfTokenHash = createHash("sha256").update(rawCsrfToken).digest("hex");
    const session = await this.sessions.create(user.id, csrfTokenHash);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null }
    });

    return {
      status: "ok",
      sessionId: session.id,
      csrfToken: rawCsrfToken,
      user: {
        id: user.id,
        username: user.username
      }
    };
  }

  async registerSeedUser(): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const permissionDefinitions = [
        { key: "admin.manage", description: "Manage users and system policies" },
        { key: "stories.review", description: "Review and ingest newsroom stories" },
        { key: "transactions.read", description: "View finance transaction history" },
        { key: "finance.review", description: "Create and approve internal charges" },
        { key: "finance.refund", description: "Process full and partial refunds" },
        { key: "finance.freeze", description: "Freeze disputed transactions" },
        { key: "audit.read", description: "Search and export audit reports" },
        { key: "alerts.read", description: "View operational alerts dashboard" },
        { key: "auditor.release_freeze", description: "Release frozen transactions" }
      ] as const;

      const permissions = new Map<string, string>();
      for (const definition of permissionDefinitions) {
        const permission = await tx.permission.upsert({
          where: { key: definition.key },
          update: { description: definition.description },
          create: { key: definition.key, description: definition.description }
        });
        permissions.set(definition.key, permission.id);
      }

      const roleDefinitions = [
        {
          name: "admin",
          description: "System administrators",
          permissionKeys: [
            "admin.manage",
            "stories.review",
            "transactions.read",
            "finance.review",
            "finance.refund",
            "finance.freeze",
            "audit.read",
            "alerts.read",
            "auditor.release_freeze"
          ]
        },
        {
          name: "editor",
          description: "Editors who ingest, review, repair, and merge stories",
          permissionKeys: ["stories.review"]
        },
        {
          name: "finance_reviewer",
          description: "Finance users who review, approve, refund, and freeze transactions",
          permissionKeys: ["transactions.read", "finance.review", "finance.refund", "finance.freeze"]
        },
        {
          name: "auditor",
          description: "Auditors who review reports and release freezes",
          permissionKeys: ["audit.read", "transactions.read", "auditor.release_freeze"]
        }
      ] as const;

      const roles = new Map<string, string>();
      for (const definition of roleDefinitions) {
        const role = await tx.role.upsert({
          where: { name: definition.name },
          update: { description: definition.description },
          create: { name: definition.name, description: definition.description }
        });
        roles.set(definition.name, role.id);

        for (const key of definition.permissionKeys) {
          const permissionId = permissions.get(key);
          if (!permissionId) {
            continue;
          }
          await tx.rolePermission.upsert({
            where: {
              roleId_permissionId: {
                roleId: role.id,
                permissionId
              }
            },
            update: {},
            create: { roleId: role.id, permissionId }
          });
        }
      }

      for (const seededUser of SEEDED_USERS) {
        const existing = await tx.user.findUnique({ where: { username: seededUser.username } });
        if (!existing && !deterministicSeedCredentialsAllowed()) {
          continue;
        }
        const user =
          existing ??
          (await tx.user.create({
            data: {
              username: seededUser.username,
              passwordHash: await bcrypt.hash(seededUser.password, 12)
            }
          }));

        const roleId = roles.get(seededUser.role);
        if (!roleId) {
          continue;
        }

        await tx.userRole.upsert({
          where: {
            userId_roleId: {
              userId: user.id,
              roleId
            }
          },
          update: {},
          create: { userId: user.id, roleId }
        });
      }
    });
  }
}
