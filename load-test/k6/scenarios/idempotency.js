import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL } from "../config.js";
import { uuidv4 } from "../helpers/uuid.js";
import { idempotentReplaysCorrect } from "../metrics.js";

export function idempotencyRetries() {
  const productId = (__VU % 5) + 1;
  const key = uuidv4();
  const customerId = `idem_vu${__VU}`;
  const quantity = 1;

  const payload = JSON.stringify({
    product_id: productId,
    idempotency_key: key,
    customer_id: customerId,
    quantity: quantity,
  });

  const headers = { "Content-Type": "application/json" };

  // Step 1: Place original order
  const originalRes = http.post(`${BASE_URL}/orders`, payload, {
    headers,
    tags: { name: "idempotency_original" },
  });

  let originalCreated = false;
  let orderId = null;

  if (originalRes.status === 201) {
    try {
      orderId = originalRes.json().id;
      originalCreated = true;
    } catch (e) {
      // parse error
    }
  }

  // Step 2: Replay same idempotency key 3 times
  for (let i = 0; i < 3; i++) {
    if (originalCreated) {
      const replayRes = http.post(`${BASE_URL}/orders`, payload, {
        headers,
        tags: { name: "idempotency_replay_success" },
      });

      const replayOk = check(replayRes, {
        "idempotency replay: status 200": (r) => r.status === 200,
        "idempotency replay: same order_id": (r) => {
          try {
            return r.json().id === orderId;
          } catch (e) {
            return false;
          }
        },
      });

      if (replayOk) {
        idempotentReplaysCorrect.add(1);
      }
    } else {
      const replayRes = http.post(`${BASE_URL}/orders`, payload, {
        headers,
        tags: { name: "idempotency_replay_failed" },
      });

      check(replayRes, {
        "idempotency failed replay: expected status": (r) =>
          [200, 409, 422].includes(r.status),
      });
    }

    sleep(0.2 + Math.random() * 0.3);
  }

  sleep(0.3 + Math.random() * 0.3);
}
