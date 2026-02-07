#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${BASE_URL:-http://nginx:9999}"

# URL for pre-flight checks (runs on host, not inside Docker)
HOST_URL="http://localhost:9999"

echo "============================================"
echo "  Ultra API — Stress Test (Gatling)"
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
# Clean previous results
# -------------------------------------------------------------------
rm -rf "${SCRIPT_DIR}/results"
mkdir -p "${SCRIPT_DIR}/results"

# -------------------------------------------------------------------
# Run Gatling stress test + validation (all phases in one simulation)
# -------------------------------------------------------------------
echo "[phases 1-4] Running Gatling simulation (warmup → flash sale → cancellations → validation)..."
echo "--------------------------------------------"

GATLING_EXIT=0
docker compose -f "${SCRIPT_DIR}/docker-compose.yml" run --rm \
  -e BASE_URL="${BASE_URL}" \
  gatling-stress || GATLING_EXIT=$?

echo "--------------------------------------------"
echo "[phases 1-4] Exit code: ${GATLING_EXIT}"
echo ""

# -------------------------------------------------------------------
# Final report
# -------------------------------------------------------------------
echo "============================================"
echo "  Results"
echo "============================================"

# Find the HTML report
REPORT_DIR=$(find "${SCRIPT_DIR}/results" -name "index.html" -type f 2>/dev/null | head -1 | xargs dirname 2>/dev/null || true)

if [ -n "${REPORT_DIR}" ]; then
  echo ""
  echo "  HTML Report: ${REPORT_DIR}/index.html"
  echo ""
fi

if [ "${GATLING_EXIT}" -eq 0 ]; then
  echo "  PASS — All tests passed!"
  echo ""
  exit 0
else
  echo "  FAIL — Stress test or validation failed (exit ${GATLING_EXIT})"
  echo ""
  exit 1
fi
