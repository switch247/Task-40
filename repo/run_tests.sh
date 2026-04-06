#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

COMPOSE="docker compose"

cleanup() {
  echo ""
  echo "[cleanup] docker compose down -v"
  $COMPOSE down -v >/dev/null 2>&1 || true
}

trap cleanup EXIT

wait_for_backend() {
  echo "[infra] Waiting for backend health..."
  for i in $(seq 1 60); do
    if $COMPOSE exec -T backend node -e "fetch('http://localhost:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      echo "[infra] Backend is healthy"
      return 0
    fi
    sleep 2
  done

  echo "[infra] ERROR: backend did not become healthy in time"
  $COMPOSE logs backend || true
  return 1
}

echo "=== SentinelDesk Docker Test Runner ==="

echo "[cleanup] Clearing previous compose state"
$COMPOSE down -v >/dev/null 2>&1 || true

echo "[build] docker compose up --build -d"
$COMPOSE up --build -d postgres redis backend frontend

wait_for_backend

echo "[backend] npm test (unit) via docker exec"
$COMPOSE exec -T backend sh -lc 'unset ENABLE_SEEDING ALLOW_DETERMINISTIC_SEED_CREDENTIALS; npm run test'

echo "[backend] npm test:e2e (api) via docker exec"
$COMPOSE exec -T backend npm run test:e2e

echo "[frontend] Install Playwright Chromium via docker exec"
# Playwright browsers are preinstalled in the frontend image

echo "[frontend] npm test:e2e via docker exec"
$COMPOSE exec -T frontend sh -lc 'export VITE_API_BASE_URL=http://backend:3000/api; CHROMIUM_BIN=$(command -v chromium-browser || command -v chromium); export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$CHROMIUM_BIN"; export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1; npm run test:e2e'

echo "=== Final Summary ==="
echo "PASS backend unit, backend api/e2e, frontend e2e"
