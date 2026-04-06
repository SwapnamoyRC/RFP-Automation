exports.up = async function (knex) {
  await knex.raw('ALTER TABLE products ADD COLUMN IF NOT EXISTS siglip_embedding vector(768)');

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS product_siglip_images (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      image_url TEXT NOT NULL,
      image_type VARCHAR(50) DEFAULT 'product',
      siglip_embedding vector(768),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_product_siglip_images_product_id ON product_siglip_images(product_id)');

  // IVFFlat index — only create if data exists
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'idx_products_siglip_embedding'
      ) THEN
        IF (SELECT COUNT(*) FROM products WHERE siglip_embedding IS NOT NULL) > 0 THEN
          CREATE INDEX idx_products_siglip_embedding
            ON products USING ivfflat (siglip_embedding vector_cosine_ops) WITH (lists = 20);
        END IF;
      END IF;
    END $$
  `);
};

exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_products_siglip_embedding');
  await knex.raw('DROP TABLE IF EXISTS product_siglip_images CASCADE');
  await knex.raw('ALTER TABLE products DROP COLUMN IF EXISTS siglip_embedding');
};
