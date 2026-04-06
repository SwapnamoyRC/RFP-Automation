exports.up = async function (knex) {
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_products_last_scraped ON products(last_scraped_at)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_embeddings_product ON product_embeddings(product_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_embeddings_type ON product_embeddings(embedding_type)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_scrape_logs_brand ON scrape_logs(brand_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_scrape_logs_status ON scrape_logs(status)');
};

exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_scrape_logs_status');
  await knex.raw('DROP INDEX IF EXISTS idx_scrape_logs_brand');
  await knex.raw('DROP INDEX IF EXISTS idx_embeddings_type');
  await knex.raw('DROP INDEX IF EXISTS idx_embeddings_product');
  await knex.raw('DROP INDEX IF EXISTS idx_variants_product');
  await knex.raw('DROP INDEX IF EXISTS idx_products_last_scraped');
  await knex.raw('DROP INDEX IF EXISTS idx_products_slug');
  await knex.raw('DROP INDEX IF EXISTS idx_products_category');
  await knex.raw('DROP INDEX IF EXISTS idx_products_brand');
};
