# Stress Test

Automated stress test and validation suite for the Ultra API Challenge, built with [k6](https://k6.io/) and Docker.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (with Docker Compose)
- Your API running on **port 9999** (via its own `docker-compose.yml`)

## Quick Start

```bash
# 1. Start your API stack first
docker compose up -d

# 2. Run the stress test
cd stress-test
bash run.sh
```

That's it. The script will wait for your API to be ready, run the load test, run the validation, and print PASS or FAIL.

## What It Does

The test runs in 4 phases (~2 minutes total):

| Phase | Duration | What happens |
|-------|----------|--------------|
| 1. Warm-up | 10s | Polls `GET /products/{id}` for all 5 products every 2s to confirm the API is alive. |
| 2. Flash Sale Burst | 60s | 50 concurrent VUs place orders via `POST /orders`. Low-stock products (4 & 5) receive 70% of traffic to maximize race-condition pressure. Idempotency retries run in parallel (10 VUs replaying the same keys). |
| 3. Cancellation Wave | 30s | 30 VUs discover and cancel orders via `GET /orders?product_id=` then `POST /orders/{id}/cancel`. 10 VUs place new orders simultaneously to test stock restoration. |
| 4. Validation | ~10s | Verifies all 5 consistency rules (see below). |

## Pass Criteria

### Stress test thresholds (phases 1-3)

| Metric | Threshold |
|--------|-----------|
| HTTP 5xx errors (flash sale) | < 1% |
| HTTP 5xx errors (cancel wave) | < 1% |
| Response time p99 (flash sale) | < 500ms |
| Response time p99 (cancel wave) | < 500ms |
| Check pass rate | > 95% |

### Validation rules (phase 4)

All checks must pass (100%):

1. **Stock integrity** — `current_stock = initial_stock - SUM(confirmed.qty) + SUM(cancelled.qty)` and stock >= 0.
2. **No duplicate order IDs** — Unique `order_id` values within each product.
3. **No cross-product duplicates** — No `order_id` appears across multiple products.
4. **Order consistency** — Stock delta matches net order impact.
5. **Cancel safety** — Re-cancelling a cancelled order returns `409` and does not change stock.

## Running Individual Steps

You can run each phase independently:

```bash
# Stress test only (phases 1-3)
docker compose run --rm k6-stress

# Validation only (phase 4)
docker compose run --rm k6-validation
```

## Custom API URL

By default the test targets `http://host.docker.internal:9999` (your API on the Docker host). To override:

```bash
BASE_URL=http://host.docker.internal:3000 bash run.sh
```

Or for running k6 services individually:

```bash
docker compose run --rm -e BASE_URL=http://host.docker.internal:3000 k6-stress
```

## Project Structure

```
stress-test/
├── README.md               # This file
├── docker-compose.yml      # k6 Docker services
├── run.sh                  # Orchestrator script
└── scripts/
    ├── stress-test.js      # Phases 1-3: warm-up, flash sale, cancellations
    └── validation.js       # Phase 4: post-test consistency checks
```

## Troubleshooting

**API not reachable**
The pre-flight check retries 15 times (30s). If your API takes longer to start, increase the retry count in `run.sh` or start it manually before running the test.

**`host.docker.internal` not resolving (Linux)**
The `docker-compose.yml` includes `extra_hosts: ["host.docker.internal:host-gateway"]` which handles this on modern Docker. If you're on an older version, set `BASE_URL` explicitly:
```bash
BASE_URL=http://172.17.0.1:9999 bash run.sh
```

**All orders getting 409 (insufficient stock)**
This is expected for low-stock products (product 4 has only 10 units). The test intentionally oversells to verify your API rejects excess orders correctly.
