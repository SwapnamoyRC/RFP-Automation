-- =====================================================
-- Migration 014: Add SigLIP image embedding support
-- Adds siglip_embedding column to products table and
-- creates product_siglip_images table for multi-angle images.
-- =====================================================

-- 1. Add SigLIP embedding column to products table (768-dim for SigLIP base)
ALTER TABLE products ADD COLUMN IF NOT EXISTS siglip_embedding vector(768);

-- 2. Create product_siglip_images table for multi-angle product images
CREATE TABLE IF NOT EXISTS product_siglip_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  image_type VARCHAR(50) DEFAULT 'product',  -- '3qtr', 'front', 'side', 'detail', 'lifestyle', 'group'
  siglip_embedding vector(768),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Index on product_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_product_siglip_images_product_id
  ON product_siglip_images (product_id);

-- 4. Vector index on siglip_embedding in products table
-- Using ivfflat for approximate nearest neighbor search
-- Note: IVFFlat needs existing rows to build lists. If table is empty,
-- create the index after ingesting data. Using lists=20 for ~560 products.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_products_siglip_embedding'
  ) THEN
    -- Only create if there are rows with embeddings (IVFFlat requires data)
    IF (SELECT COUNT(*) FROM products WHERE siglip_embedding IS NOT NULL) > 0 THEN
      CREATE INDEX idx_products_siglip_embedding
        ON products USING ivfflat (siglip_embedding vector_cosine_ops) WITH (lists = 20);
    END IF;
  END IF;
END $$;
