# Flash sale inventory API Challenge

A backend performance challenge inspired by [Rinha de Backend](https://github.com/zanfranceschi/rinha-de-backend-2024-q1). Build a **flash sale inventory API** that handles massive concurrent traffic on minimal hardware — without crashing, overselling, or losing data.

## The Scenario

You are building the backend for a flash sale platform. Products have **limited stock** and thousands of users will attempt to purchase them simultaneously. Your API must guarantee:

- **No overselling** — stock must never go negative, even under heavy concurrency.
- **Idempotency** — retried requests with the same idempotency key must not create duplicate orders or decrement stock twice.
- **Atomicity** — stock decrement and order creation must succeed or fail together. No partial state.

---

## Endpoints

### 1. Place an Order

```
POST /orders
```

**Request Body:**

```json
{
  "product_id": 1,
  "idempotency_key": "550e8400-e29b-41d4-a716-446655440000",
  "customer_id": "customer_42",
  "quantity": 2
}
```

**Validation rules:**

| Field             | Rule                                                   |
| ----------------- | ------------------------------------------------------ |
| `product_id`      | Required. Integer. Must reference an existing product. |
| `idempotency_key` | Required. UUID v4 format.                              |
| `customer_id`     | Required. Non-empty string, max 50 chars.              |
| `quantity`        | Required. Integer, min 1, max 5.                       |

**Responses:**

| Status | Condition                                                                         |
| ------ | --------------------------------------------------------------------------------- |
| `201`  | Order created successfully.                                                       |
| `200`  | Idempotent replay — order already exists for this key. Return the original order. |
| `404`  | Product not found.                                                                |
| `409`  | Insufficient stock.                                                               |
| `422`  | Invalid request body (failed validation).                                         |

**Success response body (201 or 200):**

```json
{
  "order_id": "gen-uuid-here",
  "product_id": 1,
  "customer_id": "customer_42",
  "quantity": 2,
  "unit_price": 4999,
  "total_price": 9998,
  "status": "CONFIRMED",
  "created_at": "2025-01-15T10:30:00Z"
}
```

> **Critical:** If two concurrent requests arrive with different idempotency keys for the last remaining unit, exactly one must succeed and the other must receive `409`.

---

### 2. Cancel an Order

```
POST /orders/{order_id}/cancel
```

**Request Body:**

```json
{
  "product_id": 1
}
```

**Validation rules:**

| Field        | Rule                                               |
| ------------ | -------------------------------------------------- |
| `product_id` | Required. Integer. Must match the order's product. |

**Responses:**

| Status | Condition                                                              |
| ------ | ---------------------------------------------------------------------- |
| `200`  | Order cancelled. Stock restored.                                       |
| `404`  | Product or order not found.                                            |
| `409`  | Order already cancelled (cancel is idempotent-safe, but return `409`). |

**Success response body (200):**

```json
{
  "order_id": "gen-uuid-here",
  "status": "CANCELLED",
  "restored_quantity": 2
}
```

> **Critical:** Cancelling an order must atomically restore stock. A cancelled order cannot be cancelled again (return `409`), but concurrent cancel requests for the same order must not restore stock twice.

---

### 3. Get Product Details

```
GET /products/{product_id}
```

**Responses:**

| Status | Condition          |
| ------ | ------------------ |
| `200`  | Product found.     |
| `404`  | Product not found. |

**Success response body:**

```json
{
  "id": 1,
  "name": "Mechanical Keyboard Ultra",
  "price": 4999,
  "initial_stock": 100,
  "current_stock": 73
}
```

> `current_stock` must reflect the **real-time** accurate count considering all confirmed orders and cancellations.

---

### 4. Get Product Orders

```
GET /orders?product_id={product_id}
```

Returns the last 50 orders for the product, sorted by most recent first.

**Responses:**

| Status | Condition          |
| ------ | ------------------ |
| `200`  | Product found.     |
| `404`  | Product not found. |

**Success response body:**

```json
{
  "product_id": 1,
  "orders": [
    {
      "order_id": "uuid-here",
      "customer_id": "customer_42",
      "quantity": 2,
      "total_price": 9998,
      "status": "CONFIRMED",
      "created_at": "2025-01-15T10:30:00Z"
    }
  ]
}
```

---

## Pre-loaded Products

The database must be seeded with these products before the stress test begins:

| ID  | Name                      | Price (cents) | Initial Stock |
| --- | ------------------------- | ------------- | ------------- |
| 1   | Mechanical Keyboard Ultra | 4999          | 100           |
| 2   | Wireless Mouse Pro        | 2999          | 50            |
| 3   | USB-C Hub 7-in-1          | 1999          | 200           |
| 4   | 4K Webcam Stream          | 8999          | 10            |
| 5   | Noise-Cancel Headphones   | 14999         | 30            |

> All prices are in **cents** (integer) to avoid floating-point issues.

---

## Architecture Requirements

Your submission must be a `docker-compose.yml` containing **exactly** these services:

```
┌──────────┐      ┌──────────┐
│          │─────▶│  api-01  │──┐
│    lb    │      └──────────┘  │    ┌────────┐
│  :9999   │                    ├───▶│   db   │
│          │      ┌──────────┐  │    └────────┘
│          │─────▶│  api-02  │──┘
└──────────┘      └──────────┘
```

| Service  | Description                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `lb`     | Load balancer (e.g., Nginx, HAProxy). Listens on **port 9999**. Round-robin to `api-01` and `api-02`.                            |
| `api-01` | First API instance.                                                                                                              |
| `api-02` | Second API instance.                                                                                                             |
| `db`     | Database of your choice (PostgreSQL, MySQL, MongoDB, etc.). **No in-memory-only stores** (Redis, Memcached, etc. as primary DB). |

### Resource Limits

All services combined must fit within:

| Resource | Limit               |
| -------- | ------------------- |
| CPU      | **1.5 units** total |
| Memory   | **550 MB** total    |

Every service in `docker-compose.yml` **must** declare explicit `deploy.resources.limits`. Example:

```yaml
services:
  api-01:
    deploy:
      resources:
        limits:
          cpus: "0.4"
          memory: "150MB"
```

> You decide how to distribute CPU and memory across services. Tuning this is part of the challenge.

---

## Consistency Rules

These are the invariants the stress test will validate **after** the load test completes:

1. **Stock integrity** — For each product: `current_stock = initial_stock - SUM(confirmed_orders.quantity) + SUM(cancelled_orders.quantity)`. Stock must **never** be negative at any point.

2. **Idempotency** — Requests replayed with the same `idempotency_key` must return the same `order_id` and must not decrement stock again.

3. **No duplicates** — Each `idempotency_key` maps to at most one order.

4. **Order consistency** — Every order returned by `GET /orders?product_id={id}` must have a matching stock impact. No phantom orders.

5. **Cancel safety** — A cancelled order restores stock exactly once. Concurrent cancels for the same order must not double-restore.

---

## Stress Test

The stress test uses [Gatling](https://gatling.io/) (or a similar tool like [k6](https://k6.io/)) and runs the following scenario:

### Phase 1: Warm-up (10 seconds)

- Health check polling every 2 seconds on `GET /products/1`.
- All services must be responding before the load begins.

### Phase 2: Flash Sale Burst (60 seconds)

- **High concurrency order placement** across all 5 products.
- Mix of new orders and **retried idempotency keys** (to validate idempotency).
- Intentional overselling attempts — more orders than stock for products with low stock (e.g., product 4 with only 10 units).

### Phase 3: Cancellation Wave (30 seconds)

- Randomly cancel ~30% of confirmed orders.
- Concurrent cancel requests for the same order (to validate cancel idempotency).
- New orders mixed in (to test stock restoration enables new purchases).

### Phase 4: Validation

- Fetch all products via `GET /products/{id}` and verify stock integrity.
- Fetch all orders via `GET /orders?product_id={id}` and cross-check.
- Verify no duplicate orders exist for the same idempotency key.

### Pass Criteria

| Criteria            | Requirement                                       |
| ------------------- | ------------------------------------------------- |
| API availability    | No crashes. Zero `5xx` errors outside of startup. |
| Stock integrity     | All 5 products pass the stock equation.           |
| Idempotency         | Zero duplicate orders.                            |
| Cancel safety       | No double-restored stock.                         |
| Response time (p99) | Under **500ms** for order placement.              |

---

## Submission

Your repository must contain:

```
├── docker-compose.yml      # Required. Full stack definition.
├── README.md               # Brief explanation of your tech choices.
├── sql/init.sql             # (if applicable) Database seed script.
└── ...                      # Your source code.
```

### Rules

1. **Any language, any framework.** Go, Rust, Java, C#, Node.js, Python, Elixir — your call.
2. **Any database.** PostgreSQL, MySQL, MongoDB, etc. Must persist to disk (no in-memory-only).
3. **No external services.** Everything must run inside the docker-compose stack.
4. **Port 9999** is the only entry point. The stress test only hits `localhost:9999`.
5. **No cheating with pre-computed results.** The API must actually process requests.

---

## What This Challenge Tests

| Skill                   | How                                                                     |
| ----------------------- | ----------------------------------------------------------------------- |
| **Concurrency control** | Thousands of simultaneous orders for limited stock.                     |
| **Race conditions**     | Two requests for the last unit — only one can win.                      |
| **Idempotency**         | Retried requests must be safe.                                          |
| **Atomicity**           | Stock + order must update together or not at all.                       |
| **Resource efficiency** | 1.5 CPU and 550MB RAM for everything.                                   |
| **System design**       | Load balancer config, DB tuning, connection pooling, memory management. |

---

## Tips

- Use **database-level locking** (e.g., `SELECT ... FOR UPDATE`, optimistic locking with version columns, or atomic `UPDATE ... WHERE stock >= quantity`) to prevent overselling.
- Use **unique constraints** on `idempotency_key` to prevent duplicates at the DB level.
- Tune your **connection pool** — with 550MB total, every byte counts.
- Consider **prepared statements** and **batch inserts** for throughput.
- Profile your **load balancer** config — buffering, keepalive, and upstream timeout settings matter.
- The DB is usually the bottleneck. Give it enough memory for caching.
