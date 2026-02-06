-- Create tables
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  price INTEGER NOT NULL,
  stock INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(36) PRIMARY KEY,
  idempotency_key VARCHAR(36) NOT NULL UNIQUE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  customer_id VARCHAR(50) NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  total_price INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed initial products
INSERT INTO products (id, name, price, stock) VALUES
  (1, 'Mechanical Keyboard Ultra', 4999, 100),
  (2, 'Wireless Mouse Pro', 2999, 50),
  (3, 'USB-C Hub 7-in-1', 1999, 200),
  (4, '4K Webcam Stream', 8999, 10),
  (5, 'Noise-Cancel Headphones', 14999, 30)
ON CONFLICT (id) DO NOTHING;
