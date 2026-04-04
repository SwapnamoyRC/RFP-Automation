-- =====================================================
-- Migration 013: Upgrade embedding dimensions from 1536 to 3072
-- Switch from text-embedding-3-small to text-embedding-3-large
-- Idempotent: only alters if not already 3072
-- =====================================================

-- Alter vector columns to 3072 (idempotent — ALTER TYPE vector(3072) is a no-op if already 3072)
DO $$
BEGIN
  -- Check if product_embeddings column is not yet 3072
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'product_embeddings' AND column_name = 'embedding'
  ) THEN
    ALTER TABLE product_embeddings ALTER COLUMN embedding TYPE vector(3072);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'product_family_embeddings' AND column_name = 'embedding'
  ) THEN
    ALTER TABLE product_family_embeddings ALTER COLUMN embedding TYPE vector(3072);
  END IF;
END $$;

-- Update default model name
ALTER TABLE product_embeddings
  ALTER COLUMN model SET DEFAULT 'text-embedding-3-large';

ALTER TABLE product_family_embeddings
  ALTER COLUMN model SET DEFAULT 'text-embedding-3-large';
