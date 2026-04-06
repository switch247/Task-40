# SentinelDesk Backend

NestJS service with versioned APIs under `/api/v1` and `/api/v2`, local OpenAPI docs, PostgreSQL persistence, Redis-backed rate limiting/cache helpers, and local-auth security controls.

## Run with Docker (recommended)

From the project root (`repo/`):

```bash
docker compose up --build
```

The backend container applies Prisma migrations automatically on startup, then starts the API.

## Run locally (without Docker)

```bash
npm install
npx prisma generate
npm run dev
```

## OpenAPI

- `http://localhost:3000/openapi/v1`
- `http://localhost:3000/openapi/v2`

## Security behavior

- Local username/password auth only
- Min password length: 12
- Lockout: 5 failed attempts for 15 minutes
- Idle timeout: 30 minutes
- Absolute timeout: 12 hours
- Optional TOTP MFA enrollment/verification
- CSRF token required on POST/PUT/PATCH/DELETE for authenticated routes

## Seeded local users and hardening

On startup, the backend always seeds roles/permissions. Deterministic seeded users are environment-gated:

- `NODE_ENV=development|test`: deterministic seeded users are enabled for local onboarding.
- Non-development: deterministic seeded users are disabled unless explicitly allowed.

Environment flags:

- `ENABLE_SEEDING=true`  
  Allows deterministic seeded user creation in non-development environments.
- `ALLOW_DETERMINISTIC_SEED_CREDENTIALS=true`  
  Legacy alias that also allows deterministic seeded user creation in non-development environments.
- `ALLOW_DEFAULT_SEED_PASSWORD_LOGIN=true`  
  Allows login with known default seeded passwords in non-development environments.

Default deterministic credentials (development/test unless overridden):

- `admin` / `ChangeMeNow123`
- `editor` / `EditorNow123`
- `finance_reviewer` / `FinanceNow123`
- `auditor` / `AuditorNow123`
