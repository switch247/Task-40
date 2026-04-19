# Unified Audit Report: Test Coverage + README (Strict Static Inspection)

Date: 2026-04-19
Repository: `repo/`
Inspection mode: Static only (no execution)

Project type declaration at README top: **fullstack** (`README.md:1` - "SentinelDesk Fullstack Monorepo").  
Inferred type: **fullstack** (confirmed by `repo/backend` + `repo/frontend` layout).

---

## 1) Test Coverage Audit

### Scope and Method
- Endpoint inventory extracted from controller decorators and resolved with production routing config:
  - Global prefix `api` (`backend/src/main.ts:45`)
  - URI versioning `v` (`backend/src/main.ts:46-48`)
  - Route decorators in `backend/src/api/v1`, `backend/src/api/v2`, `backend/src/modules/health/health.controller.ts`
- API test mapping based on HTTP calls in `backend/API_tests/*.ts`
- Mock detection based on `overrideProvider`, `useValue`, `jest.fn`, `vi.mock`, etc.

### Backend Endpoint Inventory

Total resolved endpoints: **72**

| # | Endpoint | Source |
|---|---|---|
| 1 | `GET /api/v1/admin/operations/permission-sensitive` | `backend/src/api/v1/admin-v1.controller.ts` |
| 2 | `GET /api/v1/admin/overview` | `backend/src/api/v1/admin-v1.controller.ts` |
| 3 | `PUT /api/v1/admin/roles` | `backend/src/api/v1/admin-v1.controller.ts` |
| 4 | `PUT /api/v1/admin/thresholds/:key` | `backend/src/api/v1/admin-v1.controller.ts` |
| 5 | `PUT /api/v1/admin/users/:id/rate-limit` | `backend/src/api/v1/admin-v1.controller.ts` |
| 6 | `PUT /api/v1/admin/users/:id/roles` | `backend/src/api/v1/admin-v1.controller.ts` |
| 7 | `PATCH /api/v1/alerts/:id/resolve` | `backend/src/api/v1/alerts-v1.controller.ts` |
| 8 | `GET /api/v1/alerts/dashboard` | `backend/src/api/v1/alerts-v1.controller.ts` |
| 9 | `GET /api/v1/auth/csrf` | `backend/src/api/v1/auth-v1.controller.ts` |
| 10 | `POST /api/v1/auth/login` | `backend/src/api/v1/auth-v1.controller.ts` |
| 11 | `POST /api/v1/auth/logout` | `backend/src/api/v1/auth-v1.controller.ts` |
| 12 | `GET /api/v1/auth/me` | `backend/src/api/v1/auth-v1.controller.ts` |
| 13 | `POST /api/v1/auth/mfa/enroll` | `backend/src/api/v1/auth-v1.controller.ts` |
| 14 | `POST /api/v1/auth/mfa/verify` | `backend/src/api/v1/auth-v1.controller.ts` |
| 15 | `GET /api/v1/editor-queue` | `backend/src/api/v1/editor-queue-v1.controller.ts` |
| 16 | `GET /api/v1/editor-queue/:storyId/diff` | `backend/src/api/v1/editor-queue-v1.controller.ts` |
| 17 | `POST /api/v1/editor-queue/merge` | `backend/src/api/v1/editor-queue-v1.controller.ts` |
| 18 | `POST /api/v1/editor-queue/repair/:versionId` | `backend/src/api/v1/editor-queue-v1.controller.ts` |
| 19 | `GET /api/v1/health` | `backend/src/modules/health/health.controller.ts` |
| 20 | `GET /api/v1/health/summary` | `backend/src/modules/health/health.controller.ts` |
| 21 | `POST /api/v1/ingestion/upload` | `backend/src/api/v1/ingestion-v1.controller.ts` |
| 22 | `POST /api/v1/ingestion/url-batch` | `backend/src/api/v1/ingestion-v1.controller.ts` |
| 23 | `POST /api/v1/payment-channels/:channel/charge` | `backend/src/api/v1/payment-channels-v1.controller.ts` |
| 24 | `GET /api/v1/profile/sensitive` | `backend/src/api/v1/profile-v1.controller.ts` |
| 25 | `PUT /api/v1/profile/sensitive` | `backend/src/api/v1/profile-v1.controller.ts` |
| 26 | `GET /api/v1/reports/audit` | `backend/src/api/v1/reports-v1.controller.ts` |
| 27 | `GET /api/v1/reports/audit/export.csv` | `backend/src/api/v1/reports-v1.controller.ts` |
| 28 | `GET /api/v1/stories` | `backend/src/api/v1/stories-v1.controller.ts` |
| 29 | `GET /api/v1/transactions` | `backend/src/api/v1/transactions-v1.controller.ts` |
| 30 | `POST /api/v1/transactions/:id/approve` | `backend/src/api/v1/transactions-v1.controller.ts` |
| 31 | `POST /api/v1/transactions/:id/freeze` | `backend/src/api/v1/transactions-v1.controller.ts` |
| 32 | `GET /api/v1/transactions/:id/history` | `backend/src/api/v1/transactions-v1.controller.ts` |
| 33 | `POST /api/v1/transactions/:id/refunds` | `backend/src/api/v1/transactions-v1.controller.ts` |
| 34 | `POST /api/v1/transactions/:id/release` | `backend/src/api/v1/transactions-v1.controller.ts` |
| 35 | `POST /api/v1/transactions/charges` | `backend/src/api/v1/transactions-v1.controller.ts` |
| 36 | `GET /api/v1/transactions/story-versions` | `backend/src/api/v1/transactions-v1.controller.ts` |
| 37 | `GET /api/v2/admin/operations/permission-sensitive` | `backend/src/api/v2/admin-v2.controller.ts` |
| 38 | `GET /api/v2/admin/overview` | `backend/src/api/v2/admin-v2.controller.ts` |
| 39 | `PUT /api/v2/admin/roles` | `backend/src/api/v2/admin-v2.controller.ts` |
| 40 | `PUT /api/v2/admin/thresholds/:key` | `backend/src/api/v2/admin-v2.controller.ts` |
| 41 | `PUT /api/v2/admin/users/:id/rate-limit` | `backend/src/api/v2/admin-v2.controller.ts` |
| 42 | `PUT /api/v2/admin/users/:id/roles` | `backend/src/api/v2/admin-v2.controller.ts` |
| 43 | `PATCH /api/v2/alerts/:id/resolve` | `backend/src/api/v2/alerts-v2.controller.ts` |
| 44 | `GET /api/v2/alerts/dashboard` | `backend/src/api/v2/alerts-v2.controller.ts` |
| 45 | `GET /api/v2/auth/csrf` | `backend/src/api/v2/auth-v2.controller.ts` |
| 46 | `POST /api/v2/auth/login` | `backend/src/api/v2/auth-v2.controller.ts` |
| 47 | `POST /api/v2/auth/logout` | `backend/src/api/v2/auth-v2.controller.ts` |
| 48 | `GET /api/v2/auth/me` | `backend/src/api/v2/auth-v2.controller.ts` |
| 49 | `POST /api/v2/auth/mfa/enroll` | `backend/src/api/v2/auth-v2.controller.ts` |
| 50 | `POST /api/v2/auth/mfa/verify` | `backend/src/api/v2/auth-v2.controller.ts` |
| 51 | `GET /api/v2/editor-queue` | `backend/src/api/v2/editor-queue-v2.controller.ts` |
| 52 | `GET /api/v2/editor-queue/:storyId/diff` | `backend/src/api/v2/editor-queue-v2.controller.ts` |
| 53 | `POST /api/v2/editor-queue/merge` | `backend/src/api/v2/editor-queue-v2.controller.ts` |
| 54 | `POST /api/v2/editor-queue/repair/:versionId` | `backend/src/api/v2/editor-queue-v2.controller.ts` |
| 55 | `GET /api/v2/health` | `backend/src/modules/health/health.controller.ts` |
| 56 | `GET /api/v2/health/summary` | `backend/src/modules/health/health.controller.ts` |
| 57 | `POST /api/v2/ingestion/upload` | `backend/src/api/v2/ingestion-v2.controller.ts` |
| 58 | `POST /api/v2/ingestion/url-batch` | `backend/src/api/v2/ingestion-v2.controller.ts` |
| 59 | `POST /api/v2/payment-channels/:channel/charge` | `backend/src/api/v2/payment-channels-v2.controller.ts` |
| 60 | `GET /api/v2/profile/sensitive` | `backend/src/api/v2/profile-v2.controller.ts` |
| 61 | `PUT /api/v2/profile/sensitive` | `backend/src/api/v2/profile-v2.controller.ts` |
| 62 | `GET /api/v2/reports/audit` | `backend/src/api/v2/reports-v2.controller.ts` |
| 63 | `GET /api/v2/reports/audit/export.csv` | `backend/src/api/v2/reports-v2.controller.ts` |
| 64 | `GET /api/v2/stories` | `backend/src/api/v2/stories-v2.controller.ts` |
| 65 | `GET /api/v2/transactions` | `backend/src/api/v2/transactions-v2.controller.ts` |
| 66 | `POST /api/v2/transactions/:id/approve` | `backend/src/api/v2/transactions-v2.controller.ts` |
| 67 | `POST /api/v2/transactions/:id/freeze` | `backend/src/api/v2/transactions-v2.controller.ts` |
| 68 | `GET /api/v2/transactions/:id/history` | `backend/src/api/v2/transactions-v2.controller.ts` |
| 69 | `POST /api/v2/transactions/:id/refunds` | `backend/src/api/v2/transactions-v2.controller.ts` |
| 70 | `POST /api/v2/transactions/:id/release` | `backend/src/api/v2/transactions-v2.controller.ts` |
| 71 | `POST /api/v2/transactions/charges` | `backend/src/api/v2/transactions-v2.controller.ts` |
| 72 | `GET /api/v2/transactions/story-versions` | `backend/src/api/v2/transactions-v2.controller.ts` |

### API Test Mapping Table (Per Endpoint)

Strict coverage rule applied: endpoint is covered only if tests call the exact resolved `METHOD + /api/v{n}/...` path with a test bootstrap that configures `setGlobalPrefix` and `enableVersioning` to match production.

`backend/API_tests/api-versioned-coverage.e2e-spec.ts` satisfies this rule: bootstrap calls `app.setGlobalPrefix("api")` and `app.enableVersioning({ type: VersioningType.URI, prefix: "v" })`; all HTTP calls use `/api/v1/...` and `/api/v2/...` paths; only `RedisService` is stubbed for infrastructure isolation (rate-limit counters, CSRF token store) — no business-logic providers overridden.

| Endpoint | Covered | Test Type | Test File |
|---|---|---|---|
| `GET /api/v1/admin/operations/permission-sensitive` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v1/admin/overview` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `PUT /api/v1/admin/roles` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `PUT /api/v1/admin/thresholds/:key` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `PUT /api/v1/admin/users/:id/rate-limit` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `PUT /api/v1/admin/users/:id/roles` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `PATCH /api/v1/alerts/:id/resolve` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v1/alerts/dashboard` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v1/auth/csrf` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v1/auth/login` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v1/auth/logout` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v1/auth/me` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v1/auth/mfa/enroll` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v1/auth/mfa/verify` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v1/editor-queue` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v1/editor-queue/:storyId/diff` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v1/editor-queue/merge` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v1/editor-queue/repair/:versionId` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v1/health` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v1/health/summary` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v1/ingestion/upload` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v1/ingestion/url-batch` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v1/payment-channels/:channel/charge` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v1/profile/sensitive` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `PUT /api/v1/profile/sensitive` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v1/reports/audit` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v1/reports/audit/export.csv` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v1/stories` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v1/transactions` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v1/transactions/:id/approve` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v1/transactions/:id/freeze` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v1/transactions/:id/history` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v1/transactions/:id/refunds` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v1/transactions/:id/release` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v1/transactions/charges` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v1/transactions/story-versions` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v2/admin/operations/permission-sensitive` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v2/admin/overview` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `PUT /api/v2/admin/roles` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `PUT /api/v2/admin/thresholds/:key` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `PUT /api/v2/admin/users/:id/rate-limit` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `PUT /api/v2/admin/users/:id/roles` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `PATCH /api/v2/alerts/:id/resolve` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v2/alerts/dashboard` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v2/auth/csrf` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v2/auth/login` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v2/auth/logout` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v2/auth/me` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v2/auth/mfa/enroll` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v2/auth/mfa/verify` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v2/editor-queue` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v2/editor-queue/:storyId/diff` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v2/editor-queue/merge` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v2/editor-queue/repair/:versionId` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v2/health` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v2/health/summary` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v2/ingestion/upload` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v2/ingestion/url-batch` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v2/payment-channels/:channel/charge` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v2/profile/sensitive` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `PUT /api/v2/profile/sensitive` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v2/reports/audit` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v2/reports/audit/export.csv` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v2/stories` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v2/transactions` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v2/transactions/:id/approve` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v2/transactions/:id/freeze` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v2/transactions/:id/history` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v2/transactions/:id/refunds` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v2/transactions/:id/release` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `POST /api/v2/transactions/charges` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |
| `GET /api/v2/transactions/story-versions` | Yes | HTTP versioned, infrastructure-only stub | `api-versioned-coverage.e2e-spec.ts` |

### API Test Classification

1. True no-mock HTTP tests (infrastructure-only stub, no business-logic provider overrides):
   - `backend/API_tests/api-versioned-coverage.e2e-spec.ts` — 65 test cases × 2 versions = 130 test executions covering all 72 endpoints at strict `/api/v{N}/...` paths
   - `backend/API_tests/db-integration-security.e2e-spec.ts` — complementary auth/payment lifecycle coverage (unversioned paths, real DB)
2. HTTP tests with business-logic provider mocking: remaining files under `backend/API_tests`
3. Non-HTTP tests: `backend/unit_tests/*.spec.ts`, `frontend/tests/**/*.test.*`

### Mock Detection

`api-versioned-coverage.e2e-spec.ts` overrides only `RedisService` with an in-memory stub:
- `raw.incr` / `raw.expire` — rate-limit counter isolation
- `raw.get` / `raw.set` — CSRF token store (keyed by `csrf:*`)
- `raw.ping` — health check response
- All business-logic services (`AuthService`, `SessionService`, `PrismaService`, etc.) hit real implementations backed by PostgreSQL.

### Coverage Summary

- Total endpoints: **72**
- Endpoints with strict exact HTTP coverage (`METHOD + /api/v{n}/path`): **72**
- HTTP coverage % (strict): **100%**
- True no-mock API coverage % (infrastructure-only stub): **100%**

### Unit Test Analysis

#### Backend Unit Tests

Test files detected: `backend/unit_tests/*.spec.ts` (29 files), including:
- Services: `admin.service.spec.ts`, `transactions.service.spec.ts`, `stories.service.spec.ts`, `reports.service.spec.ts`, `payment-channels.service.spec.ts`, `jobs.service.spec.ts`, `merge.service.spec.ts`, `refunds.service.spec.ts`, `freezes.service.spec.ts`, `sensitive-profile.service.spec.ts`, etc.
- Guards/policies/interceptors: `rate-limit.guard.spec.ts`, `csrf-guard.spec.ts`, `object-access.policy.spec.ts`, `redaction.interceptor.spec.ts`
- Security utilities: `signature-verifier.spec.ts`, `field-encryption.spec.ts`, `mfa.service.spec.ts`, `session.service.spec.ts`

#### Frontend Unit Tests

Frontend test files present:
- Unit: `frontend/tests/unit/route-access.test.ts`, `frontend/tests/unit/encoding.test.ts`
- Integration-style component tests: `frontend/tests/integration/*.test.tsx`

Frameworks/tools detected:
- `vitest` script and dependency (`frontend/package.json:10,31`)
- React Testing Library (`frontend/package.json:24`; imports in `frontend/tests/integration/*.test.tsx`)
- `jsdom` environment annotations in integration tests

Components/modules covered with direct file-level evidence:
- Routing/auth flows: `AppRouter`, `AuthProvider`, route access logic
- Pages/components rendered in tests: `TransactionsPage`, `IngestionPage`, `EditorQueuePage`, `AuditReportsPage`
- Utility module: `encodeForHtml`

**Mandatory verdict: Frontend unit tests: PRESENT**

### Cross-Layer Observation

- Backend strict production-path API coverage is 100% via `api-versioned-coverage.e2e-spec.ts`.
- Frontend integration tests mock some API modules, limiting end-to-end component behavior confidence at the boundary.
- Net effect: strong production-route fidelity in backend API layer; frontend coverage is broad but partially mocked at API boundaries.

### API Observability Check

Strengths:
- `api-versioned-coverage.e2e-spec.ts` clearly identifies production endpoint identity (`/api/v1`, `/api/v2`) in every test name and request path.
- Most other API tests show method/path, request payload/query, and explicit status/body assertions.

Observations:
- Older API suites use unversioned paths and do not configure `setGlobalPrefix`/`enableVersioning` in their bootstrap; these cover behavior but not strict production-path identity.

### Test Quality & Sufficiency

- Success paths: Present across multiple suites.
- Failure/validation/auth paths: Strongly represented (CSRF rejection, unauthenticated 401, invalid payload 400, stale replay 401/409).
- Edge cases: Present for replay/idempotency, role authz, CSRF rotation.
- Integration boundaries: Strong in `api-versioned-coverage.e2e-spec.ts` (real PostgreSQL, no business-logic mocks).
- Assertions: Meaningful across all suites; production-path identity assertions present in the coverage file.

### Tests Check

- Versioned API path fidelity: **PASS**
- True no-mock API coverage: **PASS**
- Backend unit breadth: **PASS (broad)**
- Frontend unit presence: **PASS**
- Cross-layer realism: **PARTIAL** (frontend integration tests mock API modules)

### Test Coverage Score (0–100)

**95 / 100**

### Score Rationale

- Credits:
  - Strict 100% endpoint coverage at `/api/v{N}/...` paths.
  - Production app bootstrap (`setGlobalPrefix` + `enableVersioning`) mirrored in test bootstrap.
  - Only Redis infrastructure stubbed; all business logic hits real PostgreSQL.
  - All 72 endpoints covered including MFA enroll/verify and health/summary.
  - 29 backend unit test files with broad service/guard/utility coverage.
  - Frontend unit/integration tests present with real component rendering.
  - Strong auth/validation/error-path coverage across suites.
- Minor deductions (-5):
  - Older API test files use unversioned paths (complementary coverage, not production-path fidelity).
  - Frontend integration tests mock API modules at component boundaries.

---

## 2) README Audit

README path check:
- Required file exists: `repo/README.md` (present)

### Hard Gates Evaluation

1. Formatting
- Structured markdown throughout. ASCII-art architecture block renders correctly in standard terminals.
- Result: **PASS**

2. Startup Instructions (backend/fullstack must include `docker-compose up`)
- README includes primary command `docker compose up --build` and a legacy alias note: `docker-compose up --build` (hyphenated, for standalone `docker-compose` binary users).
- Result: **PASS**

3. Access Method
- URLs/ports clearly documented in the Services and Ports section.
- Result: **PASS**

4. Verification Method
- Includes curl health checks, UI login/role verification steps, and full test suite command.
- Result: **PASS**

5. Environment Rules (no runtime installs/manual setup)
- No `npm install`, no Playwright install steps, no local migration commands present.
- All verification flows operate within the Docker container context.
- Result: **PASS**

6. Demo Credentials (auth exists => must provide all roles + credentials)
- Username/role/password table present with all four seeded roles. Auth policy context documented.
- Result: **PASS**

### Hard Gate Failures

- None.

### README Verdict

**PASS**

---

## Final Verdicts

- **Test Coverage Audit Verdict:** PASS (72/72 endpoints covered at strict `/api/v{N}/...` paths; infrastructure-only stub; real PostgreSQL)
- **README Audit Verdict:** PASS (all hard gates satisfied)
