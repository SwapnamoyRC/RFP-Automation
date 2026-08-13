/**
 * Comprehensive HAY embedding contamination audit.
 *
 * Core logic: any image URL shared across multiple HAY products is WRONG
 * for at least one of them, since HAY product images are product-specific.
 *
 * Also checks: brandmodel images where the product slug in the filename
 * doesn't match the product it's embedded under.
 */
require('dotenv').config();
const { pool } = require('../src/config/database');

async function main() {
  console.log('=== HAY Contamination Audit ===\n');

  // ── 1. Golden check: URLs shared across multiple products ──────────────────
  console.log('1. Image URLs appearing in MORE than 1 product (guaranteed contamination):');
  const { rows: sharedUrls } = await pool.query(`
    SELECT
      split_part(psi.image_url, '?', 1) AS base_url,
      COUNT(DISTINCT psi.product_id) AS product_count,
      array_agg(DISTINCT p.name ORDER BY p.name) AS products
    FROM product_siglip_images psi
    JOIN products p ON p.id = psi.product_id
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'hay'
    GROUP BY split_part(psi.image_url, '?', 1)
    HAVING COUNT(DISTINCT psi.product_id) > 1
    ORDER BY product_count DESC, base_url
    LIMIT 50
  `);

  if (sharedUrls.length === 0) {
    console.log('  ✓ NONE — no URLs shared across multiple products\n');
  } else {
    console.log(`  Found ${sharedUrls.length} shared URLs:\n`);
    for (const r of sharedUrls.slice(0, 20)) {
      const filename = r.base_url.split('/').pop();
      console.log(`  [${r.product_count} products] ${filename}`);
      r.products.forEach(p => console.log(`    - ${p}`));
    }
    if (sharedUrls.length > 20) {
      console.log(`  ... and ${sharedUrls.length - 20} more`);
    }
  }

  // ── 2. brandmodel images where slug mismatches product ────────────────────
  // brandmodel filenames follow pattern: {product-slug}_{dims}_brandmodel*.jpg
  // We can extract the slug part and compare against the product's source_url slug
  console.log('\n2. Brandmodel images where filename slug != product slug:');
  const { rows: allBrandmodels } = await pool.query(`
    SELECT
      p.name,
      p.source_url,
      split_part(psi.image_url, '?', 1) AS image_url
    FROM product_siglip_images psi
    JOIN products p ON p.id = psi.product_id
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'hay'
      AND psi.image_url LIKE '%brandmodel%'
    ORDER BY p.name
  `);

  const mismatches = [];
  for (const row of allBrandmodels) {
    // Extract product slug from source_url (last path segment)
    const productSlug = row.source_url
      ? row.source_url.replace(/\/$/, '').split('/').pop()
      : null;
    if (!productSlug) continue;

    // Extract filename slug: everything before the first underscore-followed-by-digits
    const filename = row.image_url.split('/').pop();
    // Filename like: terrazza-parasol_910x1100_brandmodel.jpg → slug = terrazza-parasol
    // Or: aal-87-soft_910x1100_brandmodel.jpg → slug = aal-87-soft
    const filenameSlug = filename.split('_')[0];

    // Check if the filename slug matches the product slug
    if (filenameSlug && filenameSlug !== productSlug && !productSlug.startsWith(filenameSlug)) {
      // Also allow: filename slug is contained in product slug or vice versa (for minor variations)
      if (!productSlug.includes(filenameSlug) && !filenameSlug.includes(productSlug)) {
        mismatches.push({
          product: row.name,
          productSlug,
          filenameSlug,
          filename,
        });
      }
    }
  }

  if (mismatches.length === 0) {
    console.log('  ✓ NONE — all brandmodel images match their product\n');
  } else {
    console.log(`  Found ${mismatches.length} mismatches:\n`);
    for (const m of mismatches.slice(0, 30)) {
      console.log(`  Product: ${m.product} (slug: ${m.productSlug})`);
      console.log(`    Image filename slug: ${m.filenameSlug} ← ${m.filename}`);
    }
    if (mismatches.length > 30) console.log(`  ... and ${mismatches.length - 30} more`);
  }

  // ── 3. Overall HAY coverage check ─────────────────────────────────────────
  const { rows: stats } = await pool.query(`
    SELECT
      COUNT(DISTINCT p.id) AS total,
      SUM(CASE WHEN img_count = 0 THEN 1 ELSE 0 END) AS zero,
      SUM(CASE WHEN img_count BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS partial,
      SUM(CASE WHEN img_count >= 4 THEN 1 ELSE 0 END) AS good
    FROM (
      SELECT p.id, COUNT(psi.id) AS img_count
      FROM products p JOIN brands b ON b.id=p.brand_id
      LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
      WHERE b.slug='hay'
      GROUP BY p.id
    ) sub
  `);
  console.log(`\n3. HAY coverage snapshot:`);
  console.log(`  Total: ${stats[0].total}`);
  console.log(`  Good (≥4 images): ${stats[0].good}`);
  console.log(`  Partial (1-3):    ${stats[0].partial}`);
  console.log(`  Zero images:      ${stats[0].zero}`);

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
