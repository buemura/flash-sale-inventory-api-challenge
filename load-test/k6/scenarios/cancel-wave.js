import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL } from "../config.js";
import { ordersCancelled, cancelAlreadyCancelled } from "../metrics.js";

export function cancelWave() {
  const productId = Math.floor(Math.random() * 5) + 1;

  const listRes = http.get(`${BASE_URL}/orders?product_id=${productId}`, {
    tags: { name: "cancel_list_orders" },
  });

  check(listRes, { "cancel list: status 200": (r) => r.status === 200 });

  let targetOrderId = null;
  try {
    const body = listRes.json();
    const orders = body.orders || [];
    const confirmed = orders.filter((o) => o.status === "CONFIRMED");
    if (confirmed.length > 0) {
      targetOrderId =
        confirmed[Math.floor(Math.random() * confirmed.length)].order_id;
    }
  } catch (e) {
    // parse error
  }

  if (targetOrderId) {
    const cancelRes = http.post(
      `${BASE_URL}/orders/${targetOrderId}/cancel`,
      null,
      { tags: { name: "cancel_order" } }
    );

    check(cancelRes, {
      "cancel: expected status": (r) =>
        [200, 409, 404].includes(r.status),
    });

    if (cancelRes.status === 200) {
      ordersCancelled.add(1);
    } else if (cancelRes.status === 409) {
      cancelAlreadyCancelled.add(1);
    }
  }

  sleep(Math.random() * 0.3);
}
