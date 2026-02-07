import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL } from "../config.js";
import { pickWeightedProduct } from "../helpers/weighted-picker.js";
import { uuidv4 } from "../helpers/uuid.js";
import { ordersCreated, stockExhausted } from "../metrics.js";

export function flashSale() {
  const productId = pickWeightedProduct();
  const quantity = Math.floor(Math.random() * 3) + 1;
  const idempotencyKey = uuidv4();
  const customerId = `customer_vu${__VU}`;

  const payload = JSON.stringify({
    product_id: productId,
    idempotency_key: idempotencyKey,
    customer_id: customerId,
    quantity: quantity,
  });

  const res = http.post(`${BASE_URL}/orders`, payload, {
    headers: { "Content-Type": "application/json" },
    tags: { name: "flash_sale_place_order" },
  });

  if (res.status === 201) {
    ordersCreated.add(1);

    try {
      const order = res.json();
      const orderId = order.id;

      const verifyRes = http.get(`${BASE_URL}/orders/${orderId}`, {
        tags: { name: "flash_sale_verify_order" },
      });

      check(verifyRes, {
        "verify: status 200": (r) => r.status === 200,
        "verify: correct id": (r) => {
          try {
            return r.json().id === orderId;
          } catch (e) {
            return false;
          }
        },
      });
    } catch (e) {
      // JSON parse error, skip verification
    }
  } else if (res.status === 409) {
    stockExhausted.add(1);
  }

  sleep(Math.random() * 0.1);
}
