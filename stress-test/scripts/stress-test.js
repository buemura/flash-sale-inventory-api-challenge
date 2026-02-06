import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = __ENV.BASE_URL || "http://host.docker.internal:9999";

const PRODUCTS = [
  { id: 1, initial_stock: 100 },
  { id: 2, initial_stock: 50 },
  { id: 3, initial_stock: 200 },
  { id: 4, initial_stock: 10 },
  { id: 5, initial_stock: 30 },
];

// Weighted toward low-stock products to maximize race-condition pressure
const PRODUCT_WEIGHTS = [
  { id: 1, weight: 10 },
  { id: 2, weight: 10 },
  { id: 3, weight: 10 },
  { id: 4, weight: 35 },
  { id: 5, weight: 35 },
];
const TOTAL_WEIGHT = PRODUCT_WEIGHTS.reduce((s, p) => s + p.weight, 0);

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const ordersCreated = new Counter("orders_created");
const stockExhausted = new Counter("stock_exhausted");
const ordersCancelled = new Counter("orders_cancelled");
const cancelAlreadyCancelled = new Counter("cancel_already_cancelled");
const idempotentReplaysCorrect = new Counter("idempotent_replays_correct");
const getOrderSuccess = new Counter("get_order_success");

// ---------------------------------------------------------------------------
// k6 options
// ---------------------------------------------------------------------------

export const options = {
  scenarios: {
    // Phase 1 — Warm-up: confirm all products are reachable
    warmup: {
      executor: "constant-vus",
      vus: 1,
      duration: "10s",
      startTime: "0s",
      gracefulStop: "5s",
      exec: "warmup",
      tags: { phase: "warmup" },
    },

    // Phase 2 — Flash Sale Burst: heavy concurrent order placement
    flash_sale: {
      executor: "ramping-vus",
      startTime: "15s",
      startVUs: 0,
      stages: [
        { duration: "5s", target: 50 },
        { duration: "45s", target: 50 },
        { duration: "10s", target: 0 },
      ],
      gracefulStop: "10s",
      exec: "flashSale",
      tags: { phase: "flash_sale" },
    },

    // Phase 2b — Idempotency retries running alongside flash sale
    idempotency_retries: {
      executor: "constant-vus",
      vus: 10,
      duration: "50s",
      startTime: "20s",
      gracefulStop: "5s",
      exec: "idempotencyRetry",
      tags: { phase: "idempotency" },
    },

    // Phase 3 — Cancellation Wave
    cancel_wave: {
      executor: "ramping-vus",
      startTime: "85s",
      startVUs: 0,
      stages: [
        { duration: "5s", target: 30 },
        { duration: "20s", target: 30 },
        { duration: "5s", target: 0 },
      ],
      gracefulStop: "10s",
      exec: "cancelWave",
      tags: { phase: "cancel_wave" },
    },

    // Phase 3b — New orders during cancellation (test stock restoration)
    post_cancel_orders: {
      executor: "constant-vus",
      vus: 10,
      duration: "25s",
      startTime: "88s",
      gracefulStop: "5s",
      exec: "flashSale",
      tags: { phase: "post_cancel_orders" },
    },

    // Phase 3c — Get Order by ID (validate individual order retrieval)
    get_order: {
      executor: "constant-vus",
      vus: 5,
      duration: "25s",
      startTime: "88s",
      gracefulStop: "5s",
      exec: "getOrder",
      tags: { phase: "get_order" },
    },
  },

  thresholds: {
    "http_req_failed{phase:flash_sale}": ["rate<0.01"],
    "http_req_failed{phase:cancel_wave}": ["rate<0.01"],
    "http_req_duration{phase:flash_sale}": ["p(99)<500"],
    "http_req_duration{phase:cancel_wave}": ["p(99)<500"],
    "http_req_failed{phase:get_order}": ["rate<0.01"],
    "http_req_duration{phase:get_order}": ["p(99)<500"],
    checks: ["rate>0.95"],
    orders_created: ["count>0"],
    idempotent_replays_correct: ["count>0"],
    get_order_success: ["count>0"],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function pickWeightedProduct() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const p of PRODUCT_WEIGHTS) {
    r -= p.weight;
    if (r <= 0) return p.id;
  }
  return 5;
}

const JSON_HEADERS = { headers: { "Content-Type": "application/json" } };

// Only treat 5xx as HTTP failures — 4xx are valid business responses (409, 422, etc.)
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

// ---------------------------------------------------------------------------
// Phase 1 — Warm-up
// ---------------------------------------------------------------------------

export function warmup() {
  for (let id = 1; id <= 5; id++) {
    const res = http.get(`${BASE_URL}/products/${id}`, {
      tags: { endpoint: "get_product" },
    });

    check(res, {
      "warmup: status 200": (r) => r.status === 200,
      "warmup: has current_stock": (r) => {
        try {
          return r.json().stock !== undefined;
        } catch (_) {
          return false;
        }
      },
    });
  }
  sleep(2);
}

// ---------------------------------------------------------------------------
// Phase 2 — Flash Sale Burst
// ---------------------------------------------------------------------------

export function flashSale() {
  const productId = pickWeightedProduct();
  const quantity = Math.floor(Math.random() * 3) + 1; // 1-3

  const payload = JSON.stringify({
    product_id: productId,
    idempotency_key: uuidv4(),
    customer_id: `customer_vu${__VU}`,
    quantity: quantity,
  });

  const res = http.post(
    `${BASE_URL}/orders`,
    payload,
    Object.assign({ tags: { endpoint: "place_order" } }, JSON_HEADERS)
  );

  check(res, {
    "order: valid status (201|200|409|422)": (r) =>
      [200, 201, 409, 422].includes(r.status),
    "order: not 5xx": (r) => r.status < 500,
  });

  if (res.status === 201) {
    ordersCreated.add(1);

    // Verify the created order via GET /orders/{order_id}
    try {
      const orderId = res.json().id;
      if (orderId) {
        const getRes = http.get(`${BASE_URL}/orders/${orderId}`, {
          tags: { endpoint: "get_order" },
        });
        check(getRes, {
          "get_order: status 200 after creation": (r) => r.status === 200,
          "get_order: correct order_id": (r) => {
            try {
              return r.json().id === orderId;
            } catch (_) {
              return false;
            }
          },
        });
      }
    } catch (_) {
      // Ignore JSON parse errors
    }
  } else if (res.status === 409) {
    stockExhausted.add(1);
  }

  sleep(Math.random() * 0.1);
}

// ---------------------------------------------------------------------------
// Phase 2b — Idempotency Retries
// ---------------------------------------------------------------------------

// VU-scoped state — each VU gets its own copy
const vuState = {};

export function idempotencyRetry() {
  const productId = (__VU % 5) + 1;

  if (__ITER === 0) {
    // First iteration: place a new order and remember the key + result
    const key = uuidv4();
    const customerId = `idem_vu${__VU}`;
    const quantity = 1;

    const payload = JSON.stringify({
      product_id: productId,
      idempotency_key: key,
      customer_id: customerId,
      quantity: quantity,
    });

    const res = http.post(
      `${BASE_URL}/orders`,
      payload,
      Object.assign(
        { tags: { endpoint: "idempotency_original" } },
        JSON_HEADERS
      )
    );

    vuState.key = key;
    vuState.productId = productId;
    vuState.customerId = customerId;
    vuState.quantity = quantity;

    if (res.status === 201) {
      vuState.orderId = res.json().id;
      vuState.originalCreated = true;
    } else {
      vuState.originalCreated = false;
    }
  } else {
    // Subsequent iterations: replay the exact same request
    if (!vuState.key) {
      sleep(0.5);
      return;
    }

    const payload = JSON.stringify({
      product_id: vuState.productId,
      idempotency_key: vuState.key,
      customer_id: vuState.customerId,
      quantity: vuState.quantity,
    });

    const res = http.post(
      `${BASE_URL}/orders`,
      payload,
      Object.assign(
        { tags: { endpoint: "idempotency_replay" } },
        JSON_HEADERS
      )
    );

    if (vuState.originalCreated) {
      // Original succeeded → replay must return 200 with same order_id
      const ok = check(res, {
        "idempotency: replay returns 200": (r) => r.status === 200,
        "idempotency: same id on replay": (r) => {
          try {
            return r.json().id === vuState.orderId;
          } catch (_) {
            return false;
          }
        },
      });
      if (ok) {
        idempotentReplaysCorrect.add(1);
      }
    } else {
      // Original failed (e.g. 409 no stock) → replay should also fail
      check(res, {
        "idempotency: replay of failed order is not 201": (r) =>
          r.status !== 201,
      });
    }
  }

  sleep(0.5 + Math.random() * 0.5);
}

// ---------------------------------------------------------------------------
// Phase 3 — Cancellation Wave
// ---------------------------------------------------------------------------

export function cancelWave() {
  const productId = Math.floor(Math.random() * 5) + 1;

  // Discover orders via the API
  const listRes = http.get(`${BASE_URL}/orders?product_id=${productId}`, {
    tags: { endpoint: "list_orders" },
  });

  if (listRes.status !== 200) {
    sleep(0.5);
    return;
  }

  let orders;
  try {
    const body = listRes.json();
    orders = body.orders || [];
  } catch (_) {
    sleep(0.5);
    return;
  }

  // Filter to CONFIRMED orders only
  const confirmed = orders.filter((o) => o.status === "CONFIRMED");

  if (confirmed.length === 0) {
    sleep(0.3);
    return;
  }

  // Pick a random confirmed order to cancel
  const target = confirmed[Math.floor(Math.random() * confirmed.length)];

  const cancelRes = http.post(
    `${BASE_URL}/orders/${target.order_id}/cancel`,
    null,
    { tags: { endpoint: "cancel_order" } }
  );

  check(cancelRes, {
    "cancel: valid status (200|409|404)": (r) =>
      [200, 409, 404].includes(r.status),
    "cancel: not 5xx": (r) => r.status < 500,
  });

  if (cancelRes.status === 200) {
    ordersCancelled.add(1);
  } else if (cancelRes.status === 409) {
    cancelAlreadyCancelled.add(1);
  }

  sleep(Math.random() * 0.3);
}

// ---------------------------------------------------------------------------
// Phase 3c — Get Order by ID
// ---------------------------------------------------------------------------

export function getOrder() {
  const productId = Math.floor(Math.random() * 5) + 1;

  // Discover orders via the list API
  const listRes = http.get(`${BASE_URL}/orders?product_id=${productId}`, {
    tags: { endpoint: "list_orders" },
  });

  if (listRes.status !== 200) {
    sleep(0.5);
    return;
  }

  let orders;
  try {
    const body = listRes.json();
    orders = body.orders || [];
  } catch (_) {
    sleep(0.5);
    return;
  }

  if (orders.length === 0) {
    sleep(0.3);
    return;
  }

  // Pick a random order and fetch it by ID
  const target = orders[Math.floor(Math.random() * orders.length)];

  const getRes = http.get(`${BASE_URL}/orders/${target.order_id}`, {
    tags: { endpoint: "get_order" },
  });

  check(getRes, {
    "get_order: status 200": (r) => r.status === 200,
    "get_order: has required fields": (r) => {
      try {
        const body = r.json();
        return (
          body.id !== undefined &&
          body.idempotency_key !== undefined &&
          body.product_id !== undefined &&
          body.customer_id !== undefined &&
          body.quantity !== undefined &&
          body.unit_price !== undefined &&
          body.total_price !== undefined &&
          body.status !== undefined &&
          body.created_at !== undefined
        );
      } catch (_) {
        return false;
      }
    },
    "get_order: matches list data": (r) => {
      try {
        const body = r.json();
        return (
          body.id === target.order_id &&
          body.status === target.status &&
          body.quantity === target.quantity
        );
      } catch (_) {
        return false;
      }
    },
  });

  if (getRes.status === 200) {
    getOrderSuccess.add(1);
  }

  // Also test 404 for a non-existent order
  const fakeRes = http.get(
    `${BASE_URL}/orders/00000000-0000-4000-8000-000000000000`,
    { tags: { endpoint: "get_order_404" } }
  );

  check(fakeRes, {
    "get_order: 404 for non-existent order": (r) => r.status === 404,
  });

  // Test 422 for an invalid order_id format
  const invalidRes = http.get(`${BASE_URL}/orders/not-a-valid-uuid`, {
    tags: { endpoint: "get_order_422" },
  });

  check(invalidRes, {
    "get_order: 422 for invalid order_id": (r) => r.status === 422,
  });

  sleep(Math.random() * 0.3);
}
