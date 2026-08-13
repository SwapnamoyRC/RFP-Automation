/**
 * Copy product_siglip_images rows (URL + already-computed 768-dim embedding vector)
 * from dev to prod for the 27 new HAY products (scripts/scrape-hay-new-products.js).
 *
 * This does NOT re-scrape or re-embed anything — it copies the exact vectors that
 * already exist in dev, matched to prod's product row by slug (prod's product_id is a
 * different UUID than dev's, so we can't copy product_id directly).
 *
 * Prerequisite: hay-new-products-insert.sql must already be applied to prod (these
 * 27 products must exist there first).
 *
 * Usage:
 *   node scripts/sync-hay-new-products-images.js            # dry run, prints counts
 *   node scripts/sync-hay-new-products-images.js --execute   # actually inserts into prod
 */
require('dotenv').config();
const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--execute');

const devPool = new Pool({ connectionString: process.env.DATABASE_URL });
const prodPool = new Pool({ connectionString: process.env.PROD_DATABASE_URL, ssl: { rejectUnauthorized: false } });

const SLUGS = [
  'pack-chair-10','pack-chair-11','mimi-1-seater','mimi-2-seater','mimi-25-seater','mimi-3-seater',
  'mimi-ottoman','mimi-cushion','backflip-chair','backflip-wall-bracket','chisel-10-stool',
  'chisel-30-bar-stool','chisel-35-bar-stool','chisel-65-chair','chisel-85-lounge-chair',
  'chisel-20-table-round','chisel-25-table-round','chisel-29-table-round','chisel-30-table-rectangular',
  'chisel-630-extendable-table-rectangular',
  'mags-soft-25-seater-low-armrest-with-removable-cover-combination-1',
  'mags-soft-25-seater-low-armrest-with-removable-cover-combination-3-left',
  'mags-soft-25-seater-low-armrest-with-removable-cover-combination-3-right',
  'mags-soft-3-seater-low-armrest-with-removable-cover-combination-1',
  'mags-soft-3-seater-low-armrest-with-removable-cover-combination-4-left',
  'mags-soft-3-seater-low-armrest-with-removable-cover-combination-4-right',
  'mags-soft-with-removable-cover-s01rc',
];

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN (pass --execute to write to PROD) ===\n' : '=== EXECUTING — writing to PROD ===\n');

  const { rows: devImages } = await devPool.query(
    `SELECT p.slug, psi.image_url, psi.image_type, psi.siglip_embedding
     FROM product_siglip_images psi
     JOIN products p ON p.id = psi.product_id
     JOIN brands b ON b.id = p.brand_id
     WHERE b.slug = 'hay' AND p.slug = ANY($1)`,
    [SLUGS]
  );
  console.log(`Found ${devImages.length} image rows in dev for the 27 new HAY products.`);

  // Confirm the 27 products already exist on prod before touching anything.
  const { rows: prodProducts } = await prodPool.query(
    `SELECT p.id, p.slug FROM products p JOIN brands b ON b.id = p.brand_id
     WHERE b.slug = 'hay' AND p.slug = ANY($1)`,
    [SLUGS]
  );
  console.log(`Found ${prodProducts.length}/${SLUGS.length} matching products already on PROD.`);
  if (prodProducts.length < SLUGS.length) {
    console.warn('⚠ Not all 27 products exist on prod yet — run hay-new-products-insert.sql first.');
  }
  const prodIdBySlug = new Map(prodProducts.map(p => [p.slug, p.id]));

  let inserted = 0, skipped = 0;
  for (const row of devImages) {
    const prodProductId = prodIdBySlug.get(row.slug);
    if (!prodProductId) { skipped++; continue; }

    if (DRY_RUN) {
      inserted++;
      continue;
    }
    await prodPool.query(
      `INSERT INTO product_siglip_images (product_id, image_url, image_type, siglip_embedding)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [prodProductId, row.image_url, row.image_type, row.siglip_embedding]
    );
    inserted++;
  }

  console.log(`\n${DRY_RUN ? 'Would insert' : 'Inserted'}: ${inserted} rows. Skipped (product not on prod): ${skipped}.`);

  await devPool.end();
  await prodPool.end();
}
main().catch(e => { console.error(e.message); devPool.end(); prodPool.end(); });
