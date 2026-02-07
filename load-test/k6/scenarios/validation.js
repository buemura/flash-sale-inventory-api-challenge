import http from "k6/http";
import { check } from "k6";
import { BASE_URL, PRODUCTS } from "../config.js";
import { validationPassed } from "../metrics.js";

export function validation() {
  console.log("=== Phase 4: Post-test validation ===");

  let failed = false;
  const allOrderIds = [];
  const allIdempotencyKeys = [];

  for (const product of PRODUCTS) {
    const productId = product.id;
    console.log(`\n--- Product ${productId}: ${product.name} ---`);

    // Fetch current product state
    const prodRes = http.get(`${BASE_URL}/products/${productId}`, {
      tags: { name: "validation_get_product" },
    });

    if (prodRes.status !== 200) {
      console.log(`  FAIL: could not fetch product ${productId}`);
      failed = true;
      continue;
    }

    const currentStock = prodRes.json().stock;

    // Fetch orders for this product
    const ordersRes = http.get(`${BASE_URL}/orders?product_id=${productId}`, {
      tags: { name: "validation_get_orders" },
    });

    if (ordersRes.status !== 200) {
      console.log(`  FAIL: could not fetch orders for product ${productId}`);
      failed = true;
      continue;
    }

    const orders = ordersRes.json().orders || [];

    // Categorize orders
    let confirmedQty = 0;
    let cancelledQty = 0;
    let confirmedCount = 0;
    let cancelledCount = 0;
    const orderIds = [];
    const cancelledOrderIds = [];

    for (const order of orders) {
      orderIds.push(order.order_id);
      if (order.status === "CONFIRMED") {
        confirmedQty += order.quantity;
        confirmedCount++;
      } else if (order.status === "CANCELLED") {
        cancelledQty += order.quantity;
        cancelledCount++;
        cancelledOrderIds.push(order.order_id);
      }
    }

    console.log(
      `  Orders: ${orders.length} total, ${confirmedCount} confirmed (qty=${confirmedQty}), ${cancelledCount} cancelled (qty=${cancelledQty})`
    );
    console.log(
      `  Stock: initial=${product.initialStock}, current=${currentStock}`
    );

    // Rule 1: Stock integrity (skip if API returned limit of 50 orders)
    if (orders.length < 50) {
      const expectedStock =
        product.initialStock - confirmedQty + cancelledQty;
      if (currentStock !== expectedStock) {
        console.log(
          `  FAIL: stock integrity — expected=${expectedStock}, actual=${currentStock}`
        );
        failed = true;
      } else {
        console.log(`  PASS: stock integrity`);
      }

      if (currentStock < 0) {
        console.log(`  FAIL: negative stock (${currentStock})`);
        failed = true;
      }
    } else {
      console.log(
        `  WARN: ${orders.length} orders returned (API limit), skipping stock equation check`
      );
    }

    // Rule 2: No duplicate order IDs within this product
    const uniqueIds = new Set(orderIds);
    if (orderIds.length !== uniqueIds.size) {
      console.log(
        `  FAIL: duplicate order_ids (${orderIds.length} total, ${uniqueIds.size} unique)`
      );
      failed = true;
    } else {
      console.log(`  PASS: no duplicate order_ids`);
    }

    // Rule 3: Order consistency (stock delta matches order impact)
    if (orders.length < 50) {
      const stockDelta = product.initialStock - currentStock;
      const orderImpact = confirmedQty - cancelledQty;
      if (stockDelta !== orderImpact) {
        console.log(
          `  FAIL: order consistency — stockDelta=${stockDelta}, orderImpact=${orderImpact}`
        );
        failed = true;
      } else {
        console.log(`  PASS: order consistency`);
      }
    }

    // Rule 4: Individual order field validation + collect idempotency keys
    const collectedKeys = [];
    let fieldFailures = 0;

    for (const order of orders) {
      const detailRes = http.get(`${BASE_URL}/orders/${order.order_id}`, {
        tags: { name: "validation_get_order_detail" },
      });

      if (detailRes.status !== 200) {
        console.log(
          `  FAIL: could not fetch order ${order.order_id} (status=${detailRes.status})`
        );
        fieldFailures++;
        continue;
      }

      const detail = detailRes.json();

      // Validate required fields
      const requiredFields = [
        "id",
        "idempotency_key",
        "product_id",
        "customer_id",
        "quantity",
        "unit_price",
        "total_price",
        "status",
        "created_at",
      ];
      const missingFields = requiredFields.filter(
        (f) => detail[f] === undefined
      );

      if (missingFields.length > 0) {
        console.log(
          `  FAIL: order ${order.order_id} missing fields: ${missingFields.join(", ")}`
        );
        fieldFailures++;
      }

      // Validate consistency between list and detail responses
      if (detail.quantity !== order.quantity) {
        console.log(
          `  FAIL: order ${order.order_id} quantity mismatch (list=${order.quantity}, detail=${detail.quantity})`
        );
        fieldFailures++;
      }

      if (detail.product_id !== productId) {
        console.log(
          `  FAIL: order ${order.order_id} product_id mismatch (expected=${productId}, got=${detail.product_id})`
        );
        fieldFailures++;
      }

      if (detail.idempotency_key) {
        collectedKeys.push(detail.idempotency_key);
      }
    }

    if (fieldFailures > 0) {
      console.log(`  FAIL: ${fieldFailures} field validation failure(s)`);
      failed = true;
    } else {
      console.log(`  PASS: all order fields valid`);
    }

    // Rule 5: Idempotency key uniqueness within this product
    const uniqueKeys = new Set(collectedKeys);
    if (collectedKeys.length !== uniqueKeys.size) {
      console.log(
        `  FAIL: duplicate idempotency_keys (${collectedKeys.length} total, ${uniqueKeys.size} unique)`
      );
      failed = true;
    } else {
      console.log(`  PASS: no duplicate idempotency_keys`);
    }

    // Rule 6: Cancel safety — re-cancel should return 409, stock should not change
    const cancelSamples = cancelledOrderIds.slice(0, 3);
    let cancelSafetyOk = true;

    for (const cancelId of cancelSamples) {
      const stockBefore = http
        .get(`${BASE_URL}/products/${productId}`, {
          tags: { name: "validation_stock_before_recancel" },
        })
        .json().stock;

      const reCancelRes = http.post(
        `${BASE_URL}/orders/${cancelId}/cancel`,
        null,
        { tags: { name: "validation_recancel" } }
      );

      const stockAfter = http
        .get(`${BASE_URL}/products/${productId}`, {
          tags: { name: "validation_stock_after_recancel" },
        })
        .json().stock;

      if (reCancelRes.status !== 409) {
        console.log(
          `  FAIL: re-cancel ${cancelId} returned ${reCancelRes.status} (expected 409)`
        );
        cancelSafetyOk = false;
      }

      if (stockBefore !== stockAfter) {
        console.log(
          `  FAIL: stock changed after re-cancel ${cancelId} (before=${stockBefore}, after=${stockAfter})`
        );
        cancelSafetyOk = false;
      }
    }

    if (cancelSafetyOk && cancelSamples.length > 0) {
      console.log(
        `  PASS: cancel safety (${cancelSamples.length} re-cancel attempts)`
      );
    } else if (cancelSafetyOk) {
      failed = true;
    }

    // Collect for cross-product checks
    orderIds.forEach((id) => allOrderIds.push({ id, productId }));
    collectedKeys.forEach((key) =>
      allIdempotencyKeys.push({ key, productId })
    );
  }

  // Error case testing
  console.log("\n--- Error case testing ---");

  const res404 = http.get(
    `${BASE_URL}/orders/00000000-0000-4000-8000-000000000000`,
    { tags: { name: "validation_error_404" } }
  );
  if (
    !check(res404, {
      "error case: non-existent order returns 404": (r) => r.status === 404,
    })
  ) {
    failed = true;
  }

  const res422 = http.get(`${BASE_URL}/orders/not-a-valid-uuid`, {
    tags: { name: "validation_error_422" },
  });
  if (
    !check(res422, {
      "error case: invalid UUID returns 422": (r) => r.status === 422,
    })
  ) {
    failed = true;
  }

  // Cross-product duplicate checks
  console.log("\n--- Cross-product duplicate checks ---");

  const seenIds = {};
  let crossIdDuplicates = 0;
  for (const { id, productId } of allOrderIds) {
    if (seenIds[id] !== undefined) {
      console.log(
        `  FAIL: order_id ${id} appears in products ${seenIds[id]} and ${productId}`
      );
      crossIdDuplicates++;
    } else {
      seenIds[id] = productId;
    }
  }

  if (crossIdDuplicates > 0) {
    console.log(
      `  FAIL: ${crossIdDuplicates} cross-product order_id duplicate(s)`
    );
    failed = true;
  } else {
    console.log(
      `  PASS: no cross-product order_id duplicates (${allOrderIds.length} orders)`
    );
  }

  const seenKeys = {};
  let crossKeyDuplicates = 0;
  for (const { key, productId } of allIdempotencyKeys) {
    if (seenKeys[key] !== undefined) {
      crossKeyDuplicates++;
    } else {
      seenKeys[key] = productId;
    }
  }

  if (crossKeyDuplicates > 0) {
    console.log(
      `  FAIL: ${crossKeyDuplicates} cross-product idempotency_key duplicate(s)`
    );
    failed = true;
  } else {
    console.log(
      `  PASS: no cross-product idempotency_key duplicates (${allIdempotencyKeys.length} keys)`
    );
  }

  // Report final result
  validationPassed.add(failed ? 0 : 1);

  console.log("\n========================================");
  if (failed) {
    console.log("RESULT: FAIL — One or more validation rules failed");
  } else {
    console.log("RESULT: PASS — All validation rules passed");
  }
  console.log("========================================");
}
