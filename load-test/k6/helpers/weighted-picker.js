import { PRODUCT_WEIGHTS, TOTAL_WEIGHT } from "../config.js";

export function pickWeightedProduct() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const pw of PRODUCT_WEIGHTS) {
    r -= pw.weight;
    if (r <= 0) return pw.id;
  }
  return PRODUCT_WEIGHTS[PRODUCT_WEIGHTS.length - 1].id;
}
