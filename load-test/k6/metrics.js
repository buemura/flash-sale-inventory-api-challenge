import { Counter, Rate } from "k6/metrics";

export const ordersCreated = new Counter("orders_created");
export const stockExhausted = new Counter("stock_exhausted");
export const ordersCancelled = new Counter("orders_cancelled");
export const cancelAlreadyCancelled = new Counter("cancel_already_cancelled");
export const idempotentReplaysCorrect = new Counter(
  "idempotent_replays_correct"
);
export const getOrderSuccess = new Counter("get_order_success");
export const validationPassed = new Rate("validation_passed");
