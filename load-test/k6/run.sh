#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${BASE_URL:-http://nginx:9999}"

# URL for pre-flight checks (runs on host, not inside Docker)
HOST_URL="http://localhost:9999"

echo "============================================"
echo "  Flash Sale API — Load Test (k6)"
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
# Run k6 load test (all phases in one script)
# -------------------------------------------------------------------
echo "[phases 1-4] Running k6 simulation (warmup → flash sale → cancellations → validation)..."
echo "--------------------------------------------"

K6_EXIT=0
docker compose -f "${SCRIPT_DIR}/docker-compose.yml" run --rm \
  -e BASE_URL="${BASE_URL}" \
  k6-stress || K6_EXIT=$?

echo "--------------------------------------------"
echo "[phases 1-4] Exit code: ${K6_EXIT}"
echo ""

# -------------------------------------------------------------------
# Final report
# -------------------------------------------------------------------
echo "============================================"
echo "  Results"
echo "============================================"

if [ "${K6_EXIT}" -eq 0 ]; then
  echo "  PASS — All tests and thresholds passed!"
  echo ""
  exit 0
else
  echo "  FAIL — Load test or validation failed (exit ${K6_EXIT})"
  echo ""
  exit 1
fi
