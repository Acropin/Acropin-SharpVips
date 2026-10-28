-- Apply with: npx wrangler d1 execute acropin-food-catalog --remote --file=cloudflare/schema.sql

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  requests_per_minute INTEGER NOT NULL DEFAULT 120,
  requests_per_day INTEGER NOT NULL DEFAULT 5000,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS api_keys_active_hash
  ON api_keys (key_hash, revoked_at);

CREATE TABLE IF NOT EXISTS food_images (
  slug TEXT PRIMARY KEY,
  dish_name TEXT NOT NULL,
  canonical_dish_id TEXT,
  category TEXT NOT NULL,
  creator TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  license TEXT NOT NULL,
  attribution TEXT,
  source_url TEXT,
  license_evidence_url TEXT,
  variants_json TEXT NOT NULL DEFAULT '{}',
  approval_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending_review', 'approved', 'rejected', 'revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS food_images_approved_category_name
  ON food_images (approval_status, category, dish_name);

CREATE INDEX IF NOT EXISTS food_images_approved_dish_id
  ON food_images (approval_status, canonical_dish_id);
