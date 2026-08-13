/**
 * NaughtOne contamination audit.
 * Golden rule: any image URL shared across multiple products = contamination.
 */
require('dotenv').config();
const { pool } = require('../src/config/database');

async function main() {
  // ── 0. Coverage overview ─────────────────────────────────────────────────
  const { rows: [cov] } = await pool.query(`
    SELECT COUNT(*) total,
      SUM(CASE WHEN c=0 THEN 1 ELSE 0 END) zero,
      SUM(CASE WHEN c BETWEEN 1 AND 3 THEN 1 ELSE 0 END) partial,
      SUM(CASE WHEN c>=4 THEN 1 ELSE 0 END) good
    FROM (
      SELECT p.id, COUNT(psi.id) c
      FROM products p JOIN brands b ON b.id=p.brand_id
      LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
      WHERE b.slug='naughtone' GROUP BY p.id
    ) sub
  `);
  console.log(`NaughtOne: ${cov.total} products | ${cov.good} good (≥4) | ${cov.partial} partial | ${cov.zero} zero\n`);

  // ── 1. Golden rule — URLs shared across multiple products ─────────────────
  console.log('=== 1. GOLDEN RULE: Shared image URLs ===');
  const { rows: shared } = await pool.query(`
    SELECT psi.image_url, COUNT(DISTINCT psi.product_id) prods,
           string_agg(DISTINCT p.name, ' | ') prod_names
    FROM product_siglip_images psi
    JOIN products p ON p.id = psi.product_id
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'naughtone'
    GROUP BY psi.image_url
    HAVING COUNT(DISTINCT psi.product_id) > 1
    ORDER BY prods DESC, psi.image_url
  `);
  if (shared.length === 0) {
    console.log('  ✓ No shared URLs found.\n');
  } else {
    shared.forEach(r => console.log(`  [${r.prods} products] ${r.image_url.split('/').pop()}\n    → ${r.prod_names}`));
    console.log();
  }

  // ── 2. Products with zero images ─────────────────────────────────────────
  console.log('=== 2. ZERO-IMAGE PRODUCTS ===');
  const { rows: zeros } = await pool.query(`
    SELECT p.name, p.source_url
    FROM products p JOIN brands b ON b.id=p.brand_id
    LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
    WHERE b.slug='naughtone'
    GROUP BY p.id, p.name, p.source_url
    HAVING COUNT(psi.id)=0
    ORDER BY p.name
  `);
  if (zeros.length === 0) {
    console.log('  ✓ No zero-image products.\n');
  } else {
    zeros.forEach(r => console.log(`  [${r.name}]\n    ${r.source_url}`));
    console.log();
  }

  // ── 3. Products with 1–3 images (sparse) ─────────────────────────────────
  console.log('=== 3. SPARSE PRODUCTS (1–3 images) ===');
  const { rows: sparse } = await pool.query(`
    SELECT p.name, COUNT(psi.id) c
    FROM products p JOIN brands b ON b.id=p.brand_id
    LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
    WHERE b.slug='naughtone'
    GROUP BY p.id, p.name
    HAVING COUNT(psi.id) BETWEEN 1 AND 3
    ORDER BY COUNT(psi.id), p.name
  `);
  if (sparse.length === 0) {
    console.log('  ✓ No sparse products.\n');
  } else {
    sparse.forEach(r => console.log(`  [${r.c} imgs] ${r.name}`));
    console.log();
  }

  // ── 4. Lifestyle / editorial patterns ────────────────────────────────────
  console.log('=== 4. LIFESTYLE / EDITORIAL IMAGE PATTERNS ===');
  const { rows: lifestyle } = await pool.query(`
    SELECT p.name, psi.image_url
    FROM product_siglip_images psi
    JOIN products p ON p.id=psi.product_id
    JOIN brands b ON b.id=p.brand_id
    WHERE b.slug='naughtone'
      AND (psi.image_url ILIKE '%lifestyle%'
        OR psi.image_url ILIKE '%in-situ%'
        OR psi.image_url ILIKE '%editorial%'
        OR psi.image_url ILIKE '%concept%'
        OR psi.image_url ILIKE '%inspiration%'
        OR psi.image_url ILIKE '%-copy%'
        OR psi.image_url ILIKE '%environment%')
    ORDER BY p.name
  `);
  if (lifestyle.length === 0) {
    console.log('  ✓ No suspicious lifestyle images found.\n');
  } else {
    lifestyle.forEach(r => console.log(`  [${r.name}]\n    ${r.image_url}`));
    console.log();
  }

  // ── 5. All image URLs sample (to spot naming patterns) ───────────────────
  console.log('=== 5. IMAGE URL DOMAIN SAMPLE ===');
  const { rows: domains } = await pool.query(`
    SELECT DISTINCT
      split_part(split_part(psi.image_url, '/', 3), '?', 1) AS domain,
      COUNT(*) cnt
    FROM product_siglip_images psi
    JOIN products p ON p.id=psi.product_id
    JOIN brands b ON b.id=p.brand_id
    WHERE b.slug='naughtone'
    GROUP BY 1 ORDER BY cnt DESC LIMIT 15
  `);
  domains.forEach(r => console.log(`  ${r.cnt.toString().padStart(5)}  ${r.domain}`));

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
