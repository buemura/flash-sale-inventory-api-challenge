import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL } from "../config.js";

export function warmup() {
  for (let productId = 1; productId <= 5; productId++) {
    const res = http.get(`${BASE_URL}/products/${productId}`, {
      tags: { name: "warmup_get_product" },
    });

    check(res, {
      "warmup: status 200": (r) => r.status === 200,
      "warmup: stock exists": (r) => {
        try {
          return r.json().stock !== undefined;
        } catch (e) {
          return false;
        }
      },
    });

    sleep(2);
  }
}
