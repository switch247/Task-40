#!/usr/bin/env bash
set -euo pipefail

# This script seeds the database with required thresholds and a test alert for E2E tests.
# It should be run inside the backend container after migrations and before tests.

psql_exec() {
  PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"
}

# Default values for local dev
POSTGRES_HOST="postgres"
POSTGRES_USER="postgres"
POSTGRES_PASSWORD="postgres"
POSTGRES_DB="sentineldesk"

# Allow override from env
: "${POSTGRES_HOST:=${POSTGRES_HOST}}"
: "${POSTGRES_USER:=${POSTGRES_USER}}"
: "${POSTGRES_PASSWORD:=${POSTGRES_PASSWORD}}"
: "${POSTGRES_DB:=${POSTGRES_DB}}"

# Insert required thresholds if not present
psql_exec "INSERT INTO \"SystemThresholdConfig\" (key, value, description, \"createdAt\", \"updatedAt\") VALUES
  ('SIMHASH_MAX_HAMMING', '8', 'Simhash deduplication threshold', now(), now()),
  ('MINHASH_MIN_SIMILARITY', '0.82', 'Minhash similarity threshold', now(), now()),
  ('LICENSED_STORY_BUNDLE_CENTS', '1000', 'Licensed story bundle price', now(), now()),
  ('DEFAULT_RATE_LIMIT_RPM', '60', 'Default rate limit', now(), now())
ON CONFLICT (key) DO NOTHING;"

# Insert a test alert for E2E
psql_exec "INSERT INTO \"AlertEvent\" (id, category, severity, title, message, status, \"createdAt\") VALUES
  ('00000000-0000-0000-0000-000000000001', 'test', 'HIGH', 'Test Alert: Test alert for resolve', 'Test alert for resolve', 'OPEN', now())
ON CONFLICT (id) DO NOTHING;"

echo "[seed] Database seeded for E2E tests."
