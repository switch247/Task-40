# SentinelDesk Fullstack Monorepo

SentinelDesk is an on-prem, offline-capable newsroom platform with local auth, versioned APIs, ingestion/dedup workflows, finance controls, immutable auditing, and local operations tooling.

## Architecture

```
┌─────────────────────┐     HTTP/API      ┌──────────────────────┐
│  React + TypeScript │ ──────────────▶  │  NestJS + TypeScript  │
│  frontend/          │   (port 5173)     │  backend/  (port 3000)│
└─────────────────────┘                   └──────────┬───────────┘
                                                      │
                                          ┌───────────┴───────────┐
                                          │                       │
                                   ┌──────▼──────┐    ┌──────────▼───┐
                                   │ PostgreSQL  │    │    Redis     │
                                   │ (port 5432) │    │ (port 6379)  │
                                   └─────────────┘    └──────────────┘
```

- `frontend/` - React + TypeScript web console (Vite, React Router, Vitest + Playwright)
- `backend/` - NestJS + TypeScript API (Prisma ORM, JWT-free session cookies, CSRF protection)
- `docker-compose.yml` - PostgreSQL + Redis + backend + frontend in a single compose file

## One-Command Startup

Run the full stack with one command from the project root (`repo/`):

```bash
docker compose up --build
```

> **Legacy Docker standalone binary alias:** `docker-compose up --build` (hyphenated) is equivalent if you are using the older standalone `docker-compose` binary instead of the Docker CLI plugin.

No manual migration step is required. The backend container applies Prisma migrations during startup.

Payment channel signature verification requires all channel secrets to be configured at startup:

- `CHANNEL_SECRET_PREPAID_BALANCE`
- `CHANNEL_SECRET_INVOICE_CREDIT`
- `CHANNEL_SECRET_PURCHASE_ORDER_SETTLEMENT`

`docker-compose.yml` provides local development values for these secrets.

## Services and Ports

- Frontend: `http://localhost:5173`
- Backend API base: `http://localhost:3000/api`
- OpenAPI v1: `http://localhost:3000/openapi/v1`
- OpenAPI v2: `http://localhost:3000/openapi/v2`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

## Seeded Accounts and Credential Safety

- In `development` and `test`, deterministic seed credentials are enabled for local usability.
- In non-development environments, deterministic seeded passwords are disabled by default.
- Optional override flags (use only when explicitly needed):
  - `ENABLE_SEEDING=true` (allow deterministic user creation outside development/test)
  - `ALLOW_DETERMINISTIC_SEED_CREDENTIALS=true` (legacy alias for deterministic user creation)
  - `ALLOW_DEFAULT_SEED_PASSWORD_LOGIN=true` (temporarily allow login with known default seeded passwords)
- Default seeded username/password pairs (development/test only unless overrides are enabled):
  - `admin` / `ChangeMeNow123`
  - `editor` / `EditorNow123`
  - `finance_reviewer` / `FinanceNow123`
  - `auditor` / `AuditorNow123`

Seeded user quick reference:

| Username | Role | Password |
| --- | --- | --- |
| `admin` | `admin` | `ChangeMeNow123` |
| `editor` | `editor` | `EditorNow123` |
| `finance_reviewer` | `finance_reviewer` | `FinanceNow123` |
| `auditor` | `auditor` | `AuditorNow123` |

- Password minimum length: 12
- Lockout: 5 failed attempts for 15 minutes
- Session idle timeout: 30 minutes
- Session absolute timeout: 12 hours
- Optional TOTP MFA supported

## Mandatory Test Layout

- Core business logic tests: `backend/unit_tests/`
- Endpoint behavior tests (true no-mock, real DB): `backend/API_tests/`
- Frontend unit/integration tests: `frontend/tests/`
- Frontend browser E2E tests (Playwright): `frontend/e2e/`

Covered major paths include:

- auth/lockout/session/MFA
- ingestion parsing, URL batch, file upload
- dedup/fingerprint behavior
- merge mandatory note + strategies
- transaction/refund constraints
- freeze/release constraints
- signed channel verification/replay/idempotency
- role masking/redaction
- per-user rate limiting
- audit report search and CSV export
- admin overview, roles, rate-limit, and threshold management
- alerts dashboard and alert resolution
- sensitive profile encryption/decryption
- frontend route permission enforcement (all roles)
- frontend editor, audit, admin, alerts, security, and transactions workflows

## One-Click Test Runner

Run all tests with a single command from the project root (`repo/`):

```bash
sh ./run_tests.sh
```

or:

```bash
npm run test:all
```

This prints a clear pass/fail summary for:

- backend unit tests
- backend API tests
- frontend tests

`run_tests.sh` is acceptance-focused and executes root-level `unit_tests/` and `API_tests/` wrappers.
It is safe to rerun repeatedly without manual cleanup.
In clean CI environments, it auto-installs workspace dependencies when `jest`/`vitest` binaries are missing.

Sample output interpretation:

- `[unit_tests] PASS ...` / `[API_tests] PASS ...` indicate suite-level success.
- Jest output under each suite provides per-test pass/fail and failure reasons.
- Final line `total=<n> pass=<n> fail=<n>` is the final acceptance summary.

## Verification Procedure

1. Start stack: `docker compose up --build`

2. Verify backend health — both should return `{"status":"ok"}`:
   ```bash
   curl http://localhost:3000/api/v1/health
   curl http://localhost:3000/api/v1/health/summary
   ```

3. Verify OpenAPI docs load (open in browser or curl for 200):
   - `http://localhost:3000/openapi/v1`
   - `http://localhost:3000/openapi/v2`

4. Verify frontend loads at `http://localhost:5173` — you should see the SentinelDesk Login page.

5. Verify role-based workspace visibility by logging in with each seeded user at `http://localhost:5173`:
   - `admin` → sees Admin Workspace, Editor Queue, Transactions, Audit Reports, Alerts Dashboard, and Security
   - `editor` → sees Ingestion Workspace, Editor Queue, and Security
   - `finance_reviewer` → sees Transactions Workspace and Security
   - `auditor` → sees Transactions Workspace, Audit Reports, and Security

6. Run the full test suite and confirm all suites pass:
   ```bash
   npm run test:all
   ```
   Expected output ends with `total=<n> pass=<n> fail=0`.

## Operations: Jobs, Backup, Retention

Queue-driven on-host jobs run locally for:

- reconciliation
- notification banners
- nightly backups (2:00 AM local time)

Backup retention is 30 days.
Local metrics/logs/traces retention is 14 days.

Restore verification script (2-hour target check):

```bash
sh backend/scripts/restore_verify.sh <backup-file.sql>
```

On Windows, run the command from Git Bash or WSL.

Expected success output includes `PASS (<=2h)`.

## Troubleshooting

- Docker engine unavailable:
  - Start Docker Desktop, then rerun `docker compose up --build`.
- Backend container exits during boot:
  - Check logs: `docker compose logs backend`.
- Port conflicts (3000/5173/5432/6379):
  - Stop conflicting process or adjust host mapping in `docker-compose.yml`.
- Tests fail after schema changes:
  - Rerun `docker compose up --build` so the backend container reapplies Prisma migrations on startup.
- Backup script failures:
  - Ensure `DATABASE_URL` is valid in backend runtime and `pg_dump/psql` are available in container/host context.
