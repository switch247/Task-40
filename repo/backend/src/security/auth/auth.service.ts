import {
  ForbiddenException,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { createHash } from "crypto";
import { Prisma, User } from "@prisma/client";
import { PrismaService } from "../../modules/prisma/prisma.service";
import { FieldEncryptionService } from "../crypto/field-encryption.service";
import { MfaService } from "../mfa/mfa.service";
import { LoginDto } from "./dto/login.dto";
import { SessionService } from "./session.service";

const LOCKOUT_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

function isLocalDevelopmentMode(): boolean {
  return process.env.NODE_ENV === "development" || false;
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

  async onModuleInit() {
    await this.registerSeedUser();
  }

  async login(dto: LoginDto): Promise<{
    status: string;
    sessionId: string;
    csrfToken: string;
    user: {
      id: string;
      username: string;
      roles: string[];
    };
  }> {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePerms: {
                  include: {
                    permission: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    // Seeded user hardening: block deterministic seed login unless allowed
    const seededUser = SEEDED_USERS.find(u => u.username === dto.username && u.password === dto.password);
    if (seededUser && !defaultSeedPasswordLoginAllowed()) {
      throw new ForbiddenException("Seeded credentials are not allowed in this environment");
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      // Increment failedAttempts on bad password
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedAttempts: { increment: 1 } }
      });
      throw new UnauthorizedException("Invalid credentials");
    }

    // Defensive: userRoles may be undefined in some test mocks
    const rolesArr = Array.isArray(user.userRoles) ? user.userRoles.map((ur: any) => ur.role?.name).filter(Boolean) : [];

    const csrfToken = this.mfaService.generateOpaqueToken();
    const csrfTokenHash = createHash("sha256").update(csrfToken).digest("hex");
    const session = await this.sessions.create(user.id, csrfTokenHash);
    return {
      status: "ok",
      sessionId: session.id,
      csrfToken,
      user: {
        id: user.id,
        username: user.username,
        roles: rolesArr
      }
    };
  }

  async registerSeedUser() {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Only allow seeded user creation in dev or if explicitly enabled
      if (!deterministicSeedCredentialsAllowed()) {
        return; // Skip all seeded user creation
      }
      const permissionDefinitions = [
        { key: "admin.manage", description: "Admin Management" },
        { key: "stories.review", description: "Review Stories" },
        { key: "transactions.read", description: "Read Transactions" },
        { key: "finance.review", description: "Review Finance" },
        { key: "finance.refund", description: "Refund Finance" },
        { key: "finance.freeze", description: "Freeze Finance" },
        { key: "audit.read", description: "Read Audit Logs" },
        { key: "alerts.read", description: "Read Alerts" },
        { key: "auditor.release_freeze", description: "Release Freeze" }
      ];

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
          if (permissionId) {
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
      }

      for (const seededUser of SEEDED_USERS) {

        let user: import("@prisma/client").User | null = await tx.user.findUnique({ where: { username: seededUser.username } });
        // Only create user if allowed
        if (!user && deterministicSeedCredentialsAllowed()) {
          user = await tx.user.create({
            data: {
              username: seededUser.username,
              passwordHash: await bcrypt.hash(seededUser.password, 12)
            }
          });
        }
        // If user still doesn't exist, skip role assignment
        if (!user) continue;

        const roleId = roles.get(seededUser.role);
        if (roleId) {
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
      }
    });
  }
}
