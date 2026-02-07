export const BASE_URL = __ENV.BASE_URL || "http://host.docker.internal:9999";

export const PRODUCTS = [
  { id: 1, name: "Mechanical Keyboard Ultra", initialStock: 100 },
  { id: 2, name: "Wireless Mouse Pro", initialStock: 50 },
  { id: 3, name: "USB-C Hub 7-in-1", initialStock: 200 },
  { id: 4, name: "4K Webcam Stream", initialStock: 10 },
  { id: 5, name: "Noise-Cancel Headphones", initialStock: 30 },
];

export const PRODUCT_WEIGHTS = [
  { id: 1, weight: 10 },
  { id: 2, weight: 10 },
  { id: 3, weight: 10 },
  { id: 4, weight: 35 },
  { id: 5, weight: 35 },
];

export const TOTAL_WEIGHT = PRODUCT_WEIGHTS.reduce(
  (sum, pw) => sum + pw.weight,
  0
);
