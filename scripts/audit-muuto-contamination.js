/**
 * Comprehensive Muuto embedding contamination audit.
 *
 * Three checks:
 * 1. GOLDEN RULE: any image URL shared across multiple Muuto products = wrong for ≥1
 * 2. Cylindo code mismatch: Cylindo URL contains a product code — if that code
 *    doesn't match the product it's embedded under, it's a wrong product's image
 * 3. Leftover lifestyle images (-org_, _org_, in-situ, stregtegninger, low-res)
 */
require('dotenv').config();
const { pool } = require('../src/config/database');

function deriveExpectedCode(name) {
  return name.trim().toUpperCase()
    .replace(/[^A-Z0-9\-\s]/g, '')
    .replace(/\s+/g, '_');
}

async function main() {
  console.log('=== Muuto Contamination Audit ===\n');

  // ── 1. Golden check: URLs shared across multiple products ─────────────────
  console.log('1. Image URLs appearing in MORE than 1 Muuto product:');
  const { rows: shared } = await pool.query(`
    SELECT
      split_part(psi.image_url, '?', 1) AS base_url,
      COUNT(DISTINCT psi.product_id) AS prod_count,
      array_agg(DISTINCT p.name ORDER BY p.name) AS products
    FROM product_siglip_images psi
    JOIN products p ON p.id = psi.product_id
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'muuto'
    GROUP BY split_part(psi.image_url, '?', 1)
    HAVING COUNT(DISTINCT psi.product_id) > 1
    ORDER BY prod_count DESC, base_url
  `);

  if (shared.length === 0) {
    console.log('  ✓ NONE — no URLs shared across multiple products\n');
  } else {
    console.log(`  Found ${shared.length} shared URLs:\n`);
    for (const r of shared) {
      const filename = r.base_url.split('/').pop();
      console.log(`  [${r.prod_count} products] ${filename}`);
      r.products.forEach(p => console.log(`    - ${p}`));
    }
  }

  // ── 2. Cylindo code mismatch ──────────────────────────────────────────────
  console.log('\n2. Cylindo images where product code in URL doesn\'t match the product:');
  const { rows: cylindoRows } = await pool.query(`
    SELECT p.name, psi.image_url
    FROM product_siglip_images psi
    JOIN products p ON p.id = psi.product_id
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'muuto'
      AND psi.image_url LIKE '%cylindo.com%'
    ORDER BY p.name
  `);

  const cylindoMismatches = [];
  for (const row of cylindoRows) {
    // Extract code from Cylindo URL: /products/{CODE}/frames/
    const match = row.image_url.match(/\/products\/([^/]+)\/frames\//);
    if (!match) continue;
    const urlCode = match[1].toUpperCase();

    // Derive expected code from product name
    const expectedCode = deriveExpectedCode(row.name);

    // Check: URL code should contain or be contained by the expected code
    // (some products have configs appended to the base name code)
    if (!urlCode.startsWith(expectedCode) && !expectedCode.startsWith(urlCode) &&
        !urlCode.includes(expectedCode.slice(0, 8))) {
      cylindoMismatches.push({
        product: row.name,
        expectedCode,
        urlCode,
        url: row.image_url,
      });
    }
  }

  if (cylindoMismatches.length === 0) {
    console.log('  ✓ NONE — all Cylindo codes match their products\n');
  } else {
    console.log(`  Found ${cylindoMismatches.length} Cylindo code mismatches:`);
    cylindoMismatches.slice(0, 20).forEach(m => {
      console.log(`  Product: ${m.product}`);
      console.log(`    Expected code prefix: ${m.expectedCode.slice(0, 20)}`);
      console.log(`    URL code: ${m.urlCode.slice(0, 40)}`);
    });
    if (cylindoMismatches.length > 20) console.log(`  ... and ${cylindoMismatches.length - 20} more`);
  }

  // ── 3. Leftover lifestyle / bad images ────────────────────────────────────
  console.log('\n3. Leftover lifestyle / bad images:');
  const { rows: lifestyle } = await pool.query(`
    SELECT p.name, psi.image_url
    FROM product_siglip_images psi
    JOIN products p ON p.id = psi.product_id
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'muuto'
      AND (
        psi.image_url LIKE '%-org_%'
        OR psi.image_url LIKE '%_org_%'
        OR psi.image_url LIKE '%-org.%'
        OR psi.image_url LIKE '%_org.%'
        OR psi.image_url ILIKE '%in-situ%'
        OR psi.image_url ILIKE '%lifestyle%'
        OR psi.image_url ILIKE '%stregtegninger%'
        OR psi.image_url ILIKE '%low-res%'
      )
    ORDER BY p.name
    LIMIT 30
  `);

  if (lifestyle.length === 0) {
    console.log('  ✓ NONE — no leftover lifestyle images\n');
  } else {
    console.log(`  Found ${lifestyle.length} leftover lifestyle/bad images:`);
    lifestyle.forEach(r => {
      console.log(`  [${r.name}] ${r.image_url.split('/').pop().split('?')[0]}`);
    });
  }

  // ── 4. Coverage snapshot ──────────────────────────────────────────────────
  const { rows: stats } = await pool.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN img_count = 0 THEN 1 ELSE 0 END) AS zero,
      SUM(CASE WHEN img_count BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS partial,
      SUM(CASE WHEN img_count >= 4 THEN 1 ELSE 0 END) AS good,
      MIN(img_count) AS min_imgs, MAX(img_count) AS max_imgs,
      ROUND(AVG(img_count), 1) AS avg_imgs
    FROM (
      SELECT p.id, COUNT(psi.id) AS img_count
      FROM products p JOIN brands b ON b.id = p.brand_id
      LEFT JOIN product_siglip_images psi ON psi.product_id = p.id
      WHERE b.slug = 'muuto'
      GROUP BY p.id
    ) sub
  `);
  const s = stats[0];
  console.log('\n4. Muuto coverage:');
  console.log(`  Total: ${s.total} | Good (≥4): ${s.good} (${Math.round(s.good/s.total*100)}%) | Partial: ${s.partial} | Zero: ${s.zero}`);
  console.log(`  Min/Avg/Max: ${s.min_imgs} / ${s.avg_imgs} / ${s.max_imgs}`);

  // Products with 0 or 1 image
  const { rows: sparse } = await pool.query(`
    SELECT p.name, COUNT(psi.id) AS imgs
    FROM products p JOIN brands b ON b.id=p.brand_id
    LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
    WHERE b.slug='muuto'
    GROUP BY p.id, p.name
    HAVING COUNT(psi.id) <= 1
    ORDER BY COUNT(psi.id), p.name
  `);
  if (sparse.length > 0) {
    console.log(`\n  Products with ≤1 image (${sparse.length}):`);
    sparse.forEach(r => console.log(`    [${r.imgs}] ${r.name}`));
  }

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
