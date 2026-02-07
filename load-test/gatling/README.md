# Load Test — Gatling

Automated load test and validation suite for the Ultra API Challenge, built with [Gatling](https://gatling.io/) (Scala DSL) and Docker. Generates rich HTML reports with latency percentiles, RPS, throughput, error rates, and concurrent user charts.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (with Docker Compose)
- Your API running on **port 9999** (via its own `docker-compose.yml`)

## Quick Start

```bash
# 1. Start your API stack first
docker compose up -d

# 2. Run the load test
cd load-test/gatling
bash run.sh
```

That's it. The script will wait for your API to be ready, run the load test and validation, print PASS or FAIL, and generate an HTML report.

## HTML Report

After the test completes, open the report at:

```
load-test/gatling/results/<simulation-name>/index.html
```

The report includes:

| Metric | Report Section |
|--------|---------------|
| Latency percentiles (p50, p75, p90, p95, p99) | Response Time Percentiles (global + per-request) |
| Requests per second (RPS) | "Number of Requests per Second" time-series chart |
| Throughput | Statistics table: total requests, mean req/sec |
| Error rates | Statistics table: KO % per request; Errors section |
| Max / avg / min response times | Statistics table per request name |
| Concurrent users (VUs) | "Active Users along the Simulation" chart per scenario |

## What It Does

The test runs in 4 phases (~2.5 minutes total):

| Phase | Duration | What happens |
|-------|----------|--------------|
| 1. Warm-up | 10s | Polls `GET /products/{id}` for all 5 products every 2s to confirm the API is alive. |
| 2. Flash Sale Burst | 60s | 50 concurrent VUs place orders via `POST /orders`. Low-stock products (4 & 5) receive 70% of traffic to maximize race-condition pressure. Idempotency retries run in parallel (10 VUs replaying the same keys). |
| 3. Cancellation Wave | 30s | 30 VUs discover and cancel orders via `GET /orders?product_id=` then `POST /orders/{id}/cancel`. 10 VUs place new orders simultaneously to test stock restoration. 5 VUs validate individual order retrieval. |
| 4. Validation | ~30s | Verifies all 5 consistency rules (see below). |

## Pass Criteria

### Stress test thresholds (phases 1-3)

| Metric | Threshold |
|--------|-----------|
| Global failed requests | < 1% |
| Response time p99 (global) | < 500ms |

### Validation rules (phase 4)

All checks must pass (100%):

1. **Stock integrity** — `current_stock = initial_stock - SUM(confirmed.qty) + SUM(cancelled.qty)` and stock >= 0.
2. **No duplicate order IDs** — Unique `order_id` values within each product.
3. **No cross-product duplicates** — No `order_id` or `idempotency_key` appears across multiple products.
4. **Order consistency** — Stock delta matches net order impact.
5. **Cancel safety** — Re-cancelling a cancelled order returns `409` and does not change stock.

## Custom API URL

By default the test targets `http://host.docker.internal:9999` (your API on the Docker host). To override:

```bash
BASE_URL=http://host.docker.internal:3000 bash run.sh
```

## Project Structure

```
load-test/gatling/
├── README.md               # This file
├── docker-compose.yml      # Gatling Docker service
├── run.sh                  # Orchestrator script
├── results/                # HTML reports (generated after test run)
└── gatling/
    ├── pom.xml             # Maven project with Gatling plugin
    ├── Dockerfile          # Multi-stage Docker build
    └── src/test/
        ├── scala/flashsale/
        │   ├── FlashSaleSimulation.scala   # Main simulation orchestrator
        │   ├── config/TestConfig.scala     # Products, weights, base URL
        │   ├── state/SharedState.scala     # Thread-safe shared state
        │   ├── helpers/
        │   │   ├── WeightedProductPicker.scala
        │   │   └── JsonHelper.scala
        │   └── scenarios/
        │       ├── WarmupScenario.scala        # Phase 1
        │       ├── FlashSaleScenario.scala     # Phase 2 + 3b
        │       ├── IdempotencyScenario.scala   # Phase 2b
        │       ├── CancelWaveScenario.scala    # Phase 3
        │       ├── GetOrderScenario.scala      # Phase 3c
        │       └── ValidationScenario.scala    # Phase 4
        └── resources/
            ├── gatling.conf
            └── logback-test.xml
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

**First run is slow**
The first Docker build downloads Maven dependencies and compiles Scala. Subsequent runs use the Docker cache and are much faster.
