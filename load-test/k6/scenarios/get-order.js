import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL } from "../config.js";
import { getOrderSuccess } from "../metrics.js";

export function getOrder() {
  const productId = Math.floor(Math.random() * 5) + 1;

  const listRes = http.get(`${BASE_URL}/orders?product_id=${productId}`, {
    tags: { name: "get_order_list" },
  });

  check(listRes, { "get order list: status 200": (r) => r.status === 200 });

  let targetOrderId = null;
  try {
    const body = listRes.json();
    const orders = body.orders || [];
    if (orders.length > 0) {
      targetOrderId =
        orders[Math.floor(Math.random() * orders.length)].order_id;
    }
  } catch (e) {
    // parse error
  }

  if (targetOrderId) {
    const detailRes = http.get(`${BASE_URL}/orders/${targetOrderId}`, {
      tags: { name: "get_order_by_id" },
    });

    const allFieldsOk = check(detailRes, {
      "get order: status 200": (r) => r.status === 200,
      "get order: has id": (r) => {
        try {
          return r.json().id === targetOrderId;
        } catch (e) {
          return false;
        }
      },
      "get order: has idempotency_key": (r) => {
        try {
          return r.json().idempotency_key !== undefined;
        } catch (e) {
          return false;
        }
      },
      "get order: has product_id": (r) => {
        try {
          return r.json().product_id !== undefined;
        } catch (e) {
          return false;
        }
      },
      "get order: has customer_id": (r) => {
        try {
          return r.json().customer_id !== undefined;
        } catch (e) {
          return false;
        }
      },
      "get order: has quantity": (r) => {
        try {
          return r.json().quantity !== undefined;
        } catch (e) {
          return false;
        }
      },
      "get order: has unit_price": (r) => {
        try {
          return r.json().unit_price !== undefined;
        } catch (e) {
          return false;
        }
      },
      "get order: has total_price": (r) => {
        try {
          return r.json().total_price !== undefined;
        } catch (e) {
          return false;
        }
      },
      "get order: has status": (r) => {
        try {
          return r.json().status !== undefined;
        } catch (e) {
          return false;
        }
      },
      "get order: has created_at": (r) => {
        try {
          return r.json().created_at !== undefined;
        } catch (e) {
          return false;
        }
      },
    });

    if (allFieldsOk) {
      getOrderSuccess.add(1);
    }
  }

  // Test 404 for non-existent order
  const res404 = http.get(
    `${BASE_URL}/orders/00000000-0000-4000-8000-000000000000`,
    { tags: { name: "get_order_404" } }
  );
  check(res404, { "get order 404: status 404": (r) => r.status === 404 });

  // Test 422 for invalid UUID
  const res422 = http.get(`${BASE_URL}/orders/not-a-valid-uuid`, {
    tags: { name: "get_order_422" },
  });
  check(res422, { "get order 422: status 422": (r) => r.status === 422 });

  sleep(Math.random() * 0.3);
}
