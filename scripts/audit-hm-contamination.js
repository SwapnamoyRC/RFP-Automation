/**
 * Herman Miller contamination audit.
 * Golden rule: any image URL shared across multiple products = contamination.
 */
require('dotenv').config();
const { pool } = require('../src/config/database');

async function main() {
  // ── 0. Find the HM brand slug ────────────────────────────────────────────
  const { rows: brands } = await pool.query(
    `SELECT slug, name FROM brands WHERE name ILIKE '%herman%' OR slug ILIKE '%herman%' OR name ILIKE '%miller%'`
  );
  console.log('HM brand entries:', brands);
  if (brands.length === 0) { await pool.end(); return; }
  const slug = brands[0].slug;
  console.log(`Using slug: ${slug}\n`);

  // ── 1. Coverage overview ─────────────────────────────────────────────────
  const { rows: [cov] } = await pool.query(`
    SELECT COUNT(*) total,
      SUM(CASE WHEN c=0 THEN 1 ELSE 0 END) zero,
      SUM(CASE WHEN c BETWEEN 1 AND 3 THEN 1 ELSE 0 END) partial,
      SUM(CASE WHEN c>=4 THEN 1 ELSE 0 END) good
    FROM (
      SELECT p.id, COUNT(psi.id) c
      FROM products p JOIN brands b ON b.id=p.brand_id
      LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
      WHERE b.slug=$1 GROUP BY p.id
    ) sub
  `, [slug]);
  console.log(`Herman Miller: ${cov.total} products | ${cov.good} good (≥4) | ${cov.partial} partial | ${cov.zero} zero\n`);

  // ── 2. Golden rule — URLs shared across multiple products ─────────────────
  console.log('=== GOLDEN RULE: Shared image URLs ===');
  const { rows: shared } = await pool.query(`
    SELECT psi.image_url, COUNT(DISTINCT psi.product_id) prods,
           string_agg(DISTINCT p.name, ' | ' ORDER BY p.name) prod_names
    FROM product_siglip_images psi
    JOIN products p ON p.id = psi.product_id
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = $1
    GROUP BY psi.image_url
    HAVING COUNT(DISTINCT psi.product_id) > 1
    ORDER BY prods DESC, psi.image_url
    LIMIT 60
  `, [slug]);
  if (shared.length === 0) {
    console.log('  ✓ No shared URLs found.\n');
  } else {
    console.log(`  ${shared.length} shared URLs found:`);
    shared.forEach(r => console.log(`  [${r.prods}p] ${r.image_url.split('/').pop().substring(0,70)}\n    → ${r.prod_names.substring(0,120)}`));
    console.log();
  }

  // ── 3. Zero-image products ───────────────────────────────────────────────
  console.log('=== ZERO-IMAGE PRODUCTS ===');
  const { rows: zeros } = await pool.query(`
    SELECT p.name, p.source_url
    FROM products p JOIN brands b ON b.id=p.brand_id
    LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
    WHERE b.slug=$1
    GROUP BY p.id, p.name, p.source_url
    HAVING COUNT(psi.id)=0
    ORDER BY p.name
  `, [slug]);
  if (zeros.length === 0) {
    console.log('  ✓ None.\n');
  } else {
    zeros.forEach(r => console.log(`  [${r.name}]\n    ${r.source_url}`));
    console.log();
  }

  // ── 4. Sparse products (1–3 images) ─────────────────────────────────────
  console.log('=== SPARSE PRODUCTS (1–3 images) ===');
  const { rows: sparse } = await pool.query(`
    SELECT p.name, COUNT(psi.id) c
    FROM products p JOIN brands b ON b.id=p.brand_id
    LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
    WHERE b.slug=$1
    GROUP BY p.id, p.name
    HAVING COUNT(psi.id) BETWEEN 1 AND 3
    ORDER BY COUNT(psi.id), p.name
  `, [slug]);
  if (sparse.length === 0) {
    console.log('  ✓ None.\n');
  } else {
    sparse.forEach(r => console.log(`  [${r.c} imgs] ${r.name}`));
    console.log();
  }

  // ── 5. Lifestyle / editorial patterns ────────────────────────────────────
  console.log('=== LIFESTYLE / EDITORIAL PATTERNS ===');
  const { rows: life } = await pool.query(`
    SELECT p.name, psi.image_url
    FROM product_siglip_images psi
    JOIN products p ON p.id=psi.product_id
    JOIN brands b ON b.id=p.brand_id
    WHERE b.slug=$1
      AND (psi.image_url ILIKE '%lifestyle%'
        OR psi.image_url ILIKE '%in-situ%'
        OR psi.image_url ILIKE '%editorial%'
        OR psi.image_url ILIKE '%-copy%'
        OR psi.image_url ILIKE '%_copy%'
        OR psi.image_url ILIKE '%environment%'
        OR psi.image_url ILIKE '%inspiration%')
    ORDER BY p.name
  `, [slug]);
  if (life.length === 0) {
    console.log('  ✓ None.\n');
  } else {
    life.forEach(r => console.log(`  [${r.name}]\n    ${r.image_url.split('/').pop()}`));
    console.log();
  }

  // ── 6. Image domain breakdown ─────────────────────────────────────────────
  console.log('=== IMAGE URL DOMAINS ===');
  const { rows: domains } = await pool.query(`
    SELECT split_part(split_part(psi.image_url,'/',3),'?',1) domain, COUNT(*) cnt
    FROM product_siglip_images psi
    JOIN products p ON p.id=psi.product_id
    JOIN brands b ON b.id=p.brand_id
    WHERE b.slug=$1
    GROUP BY 1 ORDER BY cnt DESC LIMIT 10
  `, [slug]);
  domains.forEach(r => console.log(`  ${String(r.cnt).padStart(5)}  ${r.domain}`));

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
