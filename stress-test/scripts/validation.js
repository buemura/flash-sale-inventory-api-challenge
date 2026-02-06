import http from "k6/http";
import { check } from "k6";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = __ENV.BASE_URL || "http://host.docker.internal:9999";

const PRODUCTS = [
  { id: 1, name: "Mechanical Keyboard Ultra", initial_stock: 100 },
  { id: 2, name: "Wireless Mouse Pro", initial_stock: 50 },
  { id: 3, name: "USB-C Hub 7-in-1", initial_stock: 200 },
  { id: 4, name: "4K Webcam Stream", initial_stock: 10 },
  { id: 5, name: "Noise-Cancel Headphones", initial_stock: 30 },
];

// ---------------------------------------------------------------------------
// k6 options — single VU, single iteration, ALL checks must pass
// ---------------------------------------------------------------------------

export const options = {
  scenarios: {
    validation: {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: 1,
      maxDuration: "60s",
    },
  },
  thresholds: {
    checks: ["rate==1.0"],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getProduct(id) {
  const res = http.get(`${BASE_URL}/products/${id}`);
  if (res.status !== 200) return null;
  try {
    return res.json();
  } catch (_) {
    return null;
  }
}

function getOrders(productId) {
  const res = http.get(`${BASE_URL}/orders?product_id=${productId}`);
  if (res.status !== 200) return null;
  try {
    const body = res.json();
    return body.orders || [];
  } catch (_) {
    return null;
  }
}

function log(msg) {
  console.log(`[validation] ${msg}`);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export default function () {
  const allOrderIds = [];
  let allPassed = true;

  for (const product of PRODUCTS) {
    log(`--- Product ${product.id}: ${product.name} ---`);

    // Fetch current product state
    const prod = getProduct(product.id);
    const prodOk = check(prod, {
      [`product ${product.id}: GET succeeded`]: (p) => p !== null,
    });
    if (!prodOk) {
      allPassed = false;
      continue;
    }

    log(
      `  initial_stock=${product.initial_stock}  current_stock=${prod.current_stock}`
    );

    // -----------------------------------------------------------------
    // Rule 1: Stock must never be negative
    // -----------------------------------------------------------------
    check(prod, {
      [`product ${product.id}: stock >= 0`]: (p) => p.current_stock >= 0,
    });

    // Fetch orders
    const orders = getOrders(product.id);
    const ordersOk = check(orders, {
      [`product ${product.id}: GET orders succeeded`]: (o) => o !== null,
    });
    if (!ordersOk) {
      allPassed = false;
      continue;
    }

    const confirmed = orders.filter((o) => o.status === "CONFIRMED");
    const cancelled = orders.filter((o) => o.status === "CANCELLED");

    const confirmedQty = confirmed.reduce((sum, o) => sum + o.quantity, 0);
    const cancelledQty = cancelled.reduce((sum, o) => sum + o.quantity, 0);

    log(
      `  orders: ${orders.length} total, ${confirmed.length} confirmed (qty=${confirmedQty}), ${cancelled.length} cancelled (qty=${cancelledQty})`
    );

    // -----------------------------------------------------------------
    // Rule 1 (cont): Stock integrity equation
    // current_stock = initial_stock - confirmed_qty + cancelled_qty
    // Only verifiable if we can see ALL orders (endpoint returns max 50)
    // -----------------------------------------------------------------
    const expectedStock =
      product.initial_stock - confirmedQty + cancelledQty;

    if (orders.length < 50) {
      // We have all orders — full equation check
      check(null, {
        [`product ${product.id}: stock integrity (expected=${expectedStock}, actual=${prod.current_stock})`]:
          () => prod.current_stock === expectedStock,
      });
    } else {
      // Partial view — can only verify stock is non-negative
      log(
        `  WARNING: ${orders.length} orders returned (endpoint limit 50). Full stock equation cannot be verified.`
      );
      log(`  Falling back to non-negative stock check only.`);
    }

    // -----------------------------------------------------------------
    // Rule 2: No duplicate order IDs within this product
    // -----------------------------------------------------------------
    const orderIds = orders.map((o) => o.order_id);
    const uniqueIds = new Set(orderIds);

    check(null, {
      [`product ${product.id}: no duplicate order_ids (${orderIds.length} orders, ${uniqueIds.size} unique)`]:
        () => orderIds.length === uniqueIds.size,
    });

    // Collect for cross-product check
    for (const oid of orderIds) {
      allOrderIds.push({ orderId: oid, productId: product.id });
    }

    // -----------------------------------------------------------------
    // Rule 4: Order consistency — stock delta matches order impact
    // -----------------------------------------------------------------
    if (orders.length < 50) {
      const stockDelta = product.initial_stock - prod.current_stock;
      const orderImpact = confirmedQty - cancelledQty;

      check(null, {
        [`product ${product.id}: order consistency (delta=${stockDelta}, impact=${orderImpact})`]:
          () => stockDelta === orderImpact,
      });
    }

    // -----------------------------------------------------------------
    // Rule 5: Cancel safety — re-cancelling returns 409, stock unchanged
    // -----------------------------------------------------------------
    if (cancelled.length > 0) {
      // Pick up to 3 cancelled orders to test re-cancel
      const samplesToTest = cancelled.slice(0, 3);

      for (const order of samplesToTest) {
        // Get stock before re-cancel
        const before = getProduct(product.id);
        if (!before) continue;
        const stockBefore = before.current_stock;

        // Attempt to cancel again
        const cancelPayload = JSON.stringify({ product_id: product.id });
        const res = http.post(
          `${BASE_URL}/orders/${order.order_id}/cancel`,
          cancelPayload,
          { headers: { "Content-Type": "application/json" } }
        );

        check(res, {
          [`product ${product.id}: re-cancel order ${order.order_id} returns 409`]:
            (r) => r.status === 409,
        });

        // Get stock after re-cancel
        const after = getProduct(product.id);
        if (!after) continue;

        check(null, {
          [`product ${product.id}: stock unchanged after re-cancel (before=${stockBefore}, after=${after.current_stock})`]:
            () => stockBefore === after.current_stock,
        });
      }
    }

    log(`  Product ${product.id} checks complete.`);
  }

  // -------------------------------------------------------------------
  // Rule 3: No order_id appears across multiple products
  // -------------------------------------------------------------------
  log(`--- Cross-product duplicate check ---`);

  const seenIds = {};
  let crossDuplicates = 0;

  for (const entry of allOrderIds) {
    if (seenIds[entry.orderId] !== undefined) {
      log(
        `  DUPLICATE: order ${entry.orderId} in product ${seenIds[entry.orderId]} and ${entry.productId}`
      );
      crossDuplicates++;
    } else {
      seenIds[entry.orderId] = entry.productId;
    }
  }

  check(null, {
    [`no cross-product duplicate order_ids (found ${crossDuplicates} duplicates)`]:
      () => crossDuplicates === 0,
  });

  log(
    `Total orders checked: ${allOrderIds.length}, cross-product duplicates: ${crossDuplicates}`
  );
  log(`=== Validation complete ===`);
}
