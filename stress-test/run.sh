#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${BASE_URL:-http://host.docker.internal:9999}"

# URL for pre-flight checks (runs on host, not inside Docker)
HOST_URL="${BASE_URL//host.docker.internal/localhost}"

echo "============================================"
echo "  Ultra API — Stress Test"
echo "============================================"
echo "Target (inside Docker): ${BASE_URL}"
echo "Target (host):          ${HOST_URL}"
echo ""

# -------------------------------------------------------------------
# Pre-flight: wait for the API to become reachable
# -------------------------------------------------------------------
echo "[pre-flight] Waiting for API at ${HOST_URL}/products/1 ..."

for i in $(seq 1 15); do
  if curl -sf "${HOST_URL}/products/1" > /dev/null 2>&1; then
    echo "[pre-flight] API is up!"
    break
  fi
  if [ "$i" -eq 15 ]; then
    echo "[pre-flight] ERROR: API not reachable after 15 attempts (30s). Aborting."
    exit 1
  fi
  echo "[pre-flight] Attempt ${i}/15 — retrying in 2s..."
  sleep 2
done

echo ""

# -------------------------------------------------------------------
# Phase 1-3: Stress test
# -------------------------------------------------------------------
echo "[phase 1-3] Running stress test (warmup → flash sale → cancellations)..."
echo "--------------------------------------------"

STRESS_EXIT=0
docker compose -f "${SCRIPT_DIR}/docker-compose.yml" run --rm \
  -e BASE_URL="${BASE_URL}" \
  k6-stress || STRESS_EXIT=$?

echo "--------------------------------------------"
echo "[phase 1-3] Exit code: ${STRESS_EXIT}"
echo ""

# -------------------------------------------------------------------
# Phase 4: Validation
# -------------------------------------------------------------------
echo "[phase 4] Running post-test validation..."
echo "--------------------------------------------"

VALIDATION_EXIT=0
docker compose -f "${SCRIPT_DIR}/docker-compose.yml" run --rm \
  -e BASE_URL="${BASE_URL}" \
  k6-validation || VALIDATION_EXIT=$?

echo "--------------------------------------------"
echo "[phase 4] Exit code: ${VALIDATION_EXIT}"
echo ""

# -------------------------------------------------------------------
# Final report
# -------------------------------------------------------------------
echo "============================================"
echo "  Results"
echo "============================================"

if [ "${STRESS_EXIT}" -eq 0 ] && [ "${VALIDATION_EXIT}" -eq 0 ]; then
  echo ""
  echo "  PASS — All tests passed!"
  echo ""
  exit 0
else
  echo ""
  [ "${STRESS_EXIT}" -ne 0 ] && echo "  FAIL — Stress test thresholds not met (exit ${STRESS_EXIT})"
  [ "${VALIDATION_EXIT}" -ne 0 ] && echo "  FAIL — Validation checks failed (exit ${VALIDATION_EXIT})"
  echo ""
  exit 1
fi
