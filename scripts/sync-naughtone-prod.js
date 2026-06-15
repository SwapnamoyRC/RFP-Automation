/**
 * Syncs NaughtOne product data (dimensions, materials, embeddings) from local DB to production.
 *
 * Usage:
 *   node scripts/sync-naughtone-prod.js "<PROD_DATABASE_URL>"
 *
 * Example:
 *   node scripts/sync-naughtone-prod.js "postgresql://postgres:password@host/rfp_db?sslmode=require"
 */

require('dotenv').config();
const { Pool } = require('pg');

const PROD_DB_URL = process.argv[2];
if (!PROD_DB_URL) {
  console.error('Error: production DATABASE_URL required as first argument.');
  console.error('Usage: node scripts/sync-naughtone-prod.js "<PROD_DATABASE_URL>"');
  process.exit(1);
}

// Local DB (from .env)
const localPool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
});

// Production DB (from CLI arg)
const prodPool = new Pool({
  connectionString: PROD_DB_URL.replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

// These 4 were discontinued and deleted from local DB
const DISCONTINUED_URLS = [
  'https://www.naughtone.com/products/cloud-plain/',
  'https://www.naughtone.com/products/fiji/',
  'https://www.naughtone.com/products/hush-low-chair/',
  'https://www.naughtone.com/products/hush-low-sofa/',
];

async function main() {
  console.log('Connecting to local DB...');
  await localPool.query('SELECT 1');
  console.log('Connecting to production DB...');
  await prodPool.query('SELECT 1');
  console.log('Both connections OK.\n');

  // ── 1. Get NaughtOne brand IDs ───────────────────────────────────────────
  const { rows: [localBrand] } = await localPool.query(
    "SELECT id FROM brands WHERE slug = 'naughtone'"
  );
  if (!localBrand) throw new Error('NaughtOne brand not found in local DB');

  const { rows: [prodBrand] } = await prodPool.query(
    "SELECT id FROM brands WHERE slug = 'naughtone'"
  );
  if (!prodBrand) throw new Error('NaughtOne brand not found in production DB — run migrations + seed first');

  // ── 2. Delete discontinued products from prod ────────────────────────────
  console.log('Deleting discontinued products from production...');
  const { rows: deletedRows } = await prodPool.query(`
    DELETE FROM products
    WHERE brand_id = $1 AND source_url = ANY($2::text[])
    RETURNING name
  `, [prodBrand.id, DISCONTINUED_URLS]);
  if (deletedRows.length > 0) {
    deletedRows.forEach(r => console.log(`  Deleted: ${r.name}`));
  } else {
    console.log('  None found (already removed or never existed)');
  }


  // ── 4. Load full local product data for insert/update ────────────────────
  const { rows: localProductsFull } = await localPool.query(`
    SELECT p.*
    FROM products p
    WHERE p.brand_id = $1
    ORDER BY p.name
  `, [localBrand.id]);

  // ── 5. Upsert each product in prod + copy embeddings ─────────────────────
  console.log('\nUpserting products and embeddings in production...');
  let updated = 0;
  let inserted = 0;

  for (const lp of localProductsFull) {
    // Upsert by brand_id + slug (same as the scraper's ON CONFLICT key)
    const { rows: [prodProduct] } = await prodPool.query(`
      INSERT INTO products (
        brand_id, name, slug, description, dimensions, materials, weight,
        certifications, pdf_url, pdf_text, image_url, source_url,
        category, designer, sustainability, raw_data, last_scraped_at,
        siglip_embedding
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (brand_id, slug) DO UPDATE SET
        name             = EXCLUDED.name,
        description      = EXCLUDED.description,
        dimensions       = EXCLUDED.dimensions,
        materials        = EXCLUDED.materials,
        weight           = EXCLUDED.weight,
        certifications   = EXCLUDED.certifications,
        pdf_url          = EXCLUDED.pdf_url,
        pdf_text         = EXCLUDED.pdf_text,
        image_url        = EXCLUDED.image_url,
        source_url       = EXCLUDED.source_url,
        category         = EXCLUDED.category,
        designer         = EXCLUDED.designer,
        sustainability   = EXCLUDED.sustainability,
        raw_data         = EXCLUDED.raw_data,
        last_scraped_at  = EXCLUDED.last_scraped_at,
        siglip_embedding = EXCLUDED.siglip_embedding,
        updated_at       = NOW()
      RETURNING id, name, (xmax = 0) AS is_new
    `, [
      prodBrand.id, lp.name, lp.slug, lp.description, lp.dimensions, lp.materials,
      lp.weight, lp.certifications, lp.pdf_url, lp.pdf_text, lp.image_url, lp.source_url,
      lp.category, lp.designer, lp.sustainability,
      lp.raw_data ? JSON.stringify(lp.raw_data) : null,
      lp.last_scraped_at,
      lp.siglip_embedding ?? null
    ]);

    // Copy embedding vectors (same data → same vectors, no OpenAI calls needed)
    const { rows: embeds } = await localPool.query(`
      SELECT embedding_type, embedding::text AS embedding, input_text, model
      FROM product_embeddings
      WHERE product_id = $1
    `, [lp.id]);

    for (const e of embeds) {
      await prodPool.query(`
        INSERT INTO product_embeddings (product_id, embedding_type, embedding, input_text, model)
        VALUES ($1, $2, $3::vector, $4, $5)
        ON CONFLICT (product_id, embedding_type) DO UPDATE SET
          embedding  = EXCLUDED.embedding,
          input_text = EXCLUDED.input_text,
          model      = EXCLUDED.model
      `, [prodProduct.id, e.embedding_type, e.embedding, e.input_text, e.model]);
    }

    const tag = prodProduct.is_new ? 'INSERTED' : 'updated';
    console.log(`  ✓  [${tag}] ${prodProduct.name} (${embeds.length} embeddings)`);
    if (prodProduct.is_new) inserted++; else updated++;
  }

  // ── 6. Summary ────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────');
  console.log(`Products updated  : ${updated}`);
  console.log(`Products inserted : ${inserted}`);
  console.log(`Discontinued del. : ${deletedRows.length}`);
  console.log('─────────────────────────────────────────');
  console.log('Done.');
}

main()
  .catch(err => {
    console.error('\nFatal error:', err.message);
    process.exit(1);
  })
  .finally(() => {
    localPool.end();
    prodPool.end();
  });
