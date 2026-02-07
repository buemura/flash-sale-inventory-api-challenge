import http from "k6/http";

// Mark expected business-logic HTTP statuses as non-failures
// so the http_req_failed threshold only counts real errors (5xx, timeouts)
http.setResponseCallback(
  http.expectedStatuses(200, 201, 404, 409, 422)
);

export const options = {
  scenarios: {
    // Phase 1 — Warmup: 1 VU, loops for 10s
    warmup: {
      executor: "constant-vus",
      vus: 1,
      duration: "10s",
      exec: "warmup",
      gracefulStop: "5s",
    },

    // Phase 2 — Flash Sale Burst: starts at 15s
    // Ramp 0→50 (5s), hold 50 (45s), ramp 50→0 (10s)
    flash_sale: {
      executor: "ramping-vus",
      startTime: "15s",
      startVUs: 0,
      stages: [
        { duration: "5s", target: 50 },
        { duration: "45s", target: 50 },
        { duration: "10s", target: 0 },
      ],
      exec: "flashSale",
      gracefulStop: "5s",
    },

    // Phase 2b — Idempotency Retries: 10 VUs, starts at 15s
    idempotency_retries: {
      executor: "ramping-vus",
      startTime: "15s",
      startVUs: 0,
      stages: [
        { duration: "1s", target: 10 },
        { duration: "54s", target: 10 },
        { duration: "1s", target: 0 },
      ],
      exec: "idempotencyRetries",
      gracefulStop: "5s",
    },

    // Phase 3 — Cancel Wave: starts at 85s
    // Ramp 0→30 (5s), hold 30 (20s), ramp 30→0 (5s)
    cancel_wave: {
      executor: "ramping-vus",
      startTime: "85s",
      startVUs: 0,
      stages: [
        { duration: "5s", target: 30 },
        { duration: "20s", target: 30 },
        { duration: "5s", target: 0 },
      ],
      exec: "cancelWave",
      gracefulStop: "5s",
    },

    // Phase 3b — Post-Cancel Orders: 10 VUs, starts at 88s
    post_cancel_orders: {
      executor: "ramping-vus",
      startTime: "88s",
      startVUs: 0,
      stages: [
        { duration: "1s", target: 10 },
        { duration: "24s", target: 10 },
        { duration: "1s", target: 0 },
      ],
      exec: "flashSale",
      gracefulStop: "5s",
    },

    // Phase 3c — Get Order by ID: 5 VUs, starts at 88s
    get_order: {
      executor: "ramping-vus",
      startTime: "88s",
      startVUs: 0,
      stages: [
        { duration: "1s", target: 5 },
        { duration: "24s", target: 5 },
        { duration: "1s", target: 0 },
      ],
      exec: "getOrder",
      gracefulStop: "5s",
    },

    // Phase 4 — Validation: 1 VU, 1 iteration, starts at 125s
    validation: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      startTime: "125s",
      maxDuration: "60s",
      exec: "validation",
      gracefulStop: "10s",
    },
  },

  thresholds: {
    http_req_duration: ["p(99)<500"],
    http_req_failed: ["rate<0.01"],
    http_reqs: ["count>0"],
    validation_passed: ["rate==1.00"],
  },
};

// Re-export scenario exec functions
export { warmup } from "./scenarios/warmup.js";
export { flashSale } from "./scenarios/flash-sale.js";
export { idempotencyRetries } from "./scenarios/idempotency.js";
export { cancelWave } from "./scenarios/cancel-wave.js";
export { getOrder } from "./scenarios/get-order.js";
export { validation } from "./scenarios/validation.js";
