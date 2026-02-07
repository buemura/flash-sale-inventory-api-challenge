# k6 Load Test — Flash Sale API

Load test suite built with [k6](https://k6.io/) that simulates a flash-sale scenario against the API, including order placement bursts, idempotency retries, cancellation waves, and a post-test validation phase.

## Prerequisites

- Docker and Docker Compose
- The Flash Sale API stack running via the root `docker-compose.yml` (creates the `flashsale` Docker network)

## How to Run

### 1. Start the API stack

From the project root:

```bash
docker compose up -d --build
```

This brings up the API instances, Nginx reverse proxy (port 9999), and PostgreSQL.

### 2. Run the load test

From the project root:

```bash
bash load-test/k6/run.sh
```

The `run.sh` script will:

1. **Pre-flight check** — wait up to 30 seconds for the API to become reachable at `http://localhost:9999`
2. **Run the k6 simulation** — build the k6 Docker image and execute all test phases
3. **Print results** — report PASS/FAIL based on k6 exit code

### Alternative: run via Docker Compose directly

```bash
docker compose -f load-test/k6/docker-compose.yml run --rm k6-stress
```

> The k6 container connects to the same `flashsale` network as the API, so it reaches Nginx at `http://nginx:9999` by default. Override with the `BASE_URL` environment variable if needed.

## Test Phases

The simulation runs four sequential phases (total ~3 minutes):

| Phase | Time Window | VUs | Description |
|-------|------------|-----|-------------|
| **1 — Warmup** | 0–10s | 1 | GETs each product to warm up connections and verify the API is healthy |
| **2 — Flash Sale** | 15–75s | 0→50→0 | Burst of `POST /orders` with weighted product selection and random quantities (1–3) |
| **2b — Idempotency** | 15–70s | 10 | Places an order then replays the same idempotency key 3 times, asserting the same order ID is returned |
| **3 — Cancel Wave** | 85–115s | 0→30→0 | Lists confirmed orders and cancels them via `POST /orders/:id/cancel` |
| **3b — Post-Cancel Orders** | 88–114s | 10 | Additional `POST /orders` during the cancel wave to test concurrent create + cancel |
| **3c — Get Order** | 88–114s | 5 | Fetches orders by ID, validates all response fields, and tests 404/422 error cases |
| **4 — Validation** | 125s+ | 1 | Single-iteration check that asserts stock integrity, no duplicate IDs/keys, order field completeness, and cancel safety |

## Thresholds

k6 will fail (non-zero exit) if any threshold is breached:

| Metric | Threshold |
|--------|-----------|
| `http_req_duration` | p99 < 500ms |
| `http_req_failed` | rate < 1% |
| `http_reqs` | count > 0 |
| `validation_passed` | rate == 100% |

## Custom Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `orders_created` | Counter | Successful order placements (201) |
| `stock_exhausted` | Counter | Orders rejected due to out-of-stock (409) |
| `orders_cancelled` | Counter | Successful cancellations (200) |
| `cancel_already_cancelled` | Counter | Re-cancel attempts (409) |
| `idempotent_replays_correct` | Counter | Idempotency replays that returned the same order |
| `get_order_success` | Counter | Order detail fetches with all fields present |
| `validation_passed` | Rate | Final validation pass/fail (must be 100%) |

## Validation Rules (Phase 4)

For each product:

1. **Stock integrity** — `current_stock == initial_stock - confirmed_qty + cancelled_qty`
2. **No negative stock** — `current_stock >= 0`
3. **No duplicate order IDs** — within and across products
4. **No duplicate idempotency keys** — within and across products
5. **Order field completeness** — every order has `id`, `idempotency_key`, `product_id`, `customer_id`, `quantity`, `unit_price`, `total_price`, `status`, `created_at`
6. **Order consistency** — list and detail responses agree on quantity and product_id
7. **Cancel safety** — re-cancelling an already-cancelled order returns 409 and does not change stock
8. **Error cases** — non-existent order returns 404, invalid UUID returns 422

## Project Structure

```
load-test/k6/
├── main.js                   # Entry point — scenario config + thresholds
├── config.js                 # BASE_URL, product catalog, weights
├── metrics.js                # Custom k6 counters and rates
├── Dockerfile                # k6 Docker image
├── docker-compose.yml        # Compose service definition
├── run.sh                    # Runner script with pre-flight checks
├── helpers/
│   ├── uuid.js               # UUID v4 generator
│   └── weighted-picker.js    # Weighted random product selection
└── scenarios/
    ├── warmup.js             # Phase 1
    ├── flash-sale.js         # Phase 2
    ├── idempotency.js        # Phase 2b
    ├── cancel-wave.js        # Phase 3
    ├── get-order.js          # Phase 3c
    └── validation.js         # Phase 4
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `BASE_URL` | `http://nginx:9999` | API base URL used inside the k6 container |
