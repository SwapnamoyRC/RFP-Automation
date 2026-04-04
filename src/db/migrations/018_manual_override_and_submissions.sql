-- Add manual override fields to rfp_session_items
ALTER TABLE rfp_session_items
  ADD COLUMN IF NOT EXISTS override_product_url TEXT,
  ADD COLUMN IF NOT EXISTS override_product_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS override_product_brand VARCHAR(100),
  ADD COLUMN IF NOT EXISTS is_overridden BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS override_note TEXT;

-- Manual product submissions from internal team
CREATE TABLE IF NOT EXISTS product_submissions (
  id SERIAL PRIMARY KEY,
  submitted_by UUID REFERENCES users(id),
  product_url TEXT NOT NULL,
  product_name VARCHAR(255),
  brand VARCHAR(100),
  category VARCHAR(100),
  description TEXT,
  dimensions TEXT,
  materials TEXT,
  image_url TEXT,
  notes TEXT,
  status VARCHAR(20) DEFAULT 'pending', -- pending | approved | rejected | imported
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_submissions_status ON product_submissions(status);
CREATE INDEX IF NOT EXISTS idx_product_submissions_user ON product_submissions(submitted_by);
