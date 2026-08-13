/**
 * Cleanup HAY cross-product contamination from the first (broken) network-interception scraper run.
 *
 * The first scraper run intercepted WRONG product images (from other HAY products being loaded
 * simultaneously) and embedded them across hundreds of products. The 5 known wrong images are:
 *   - tin-container_910x1100_brandmodel3.jpg
 *   - bella_910x1100_brandmodel.jpg
 *   - cph-90-desk_910x1100_brandmodel2.jpg
 *   - terrazza-parasol_910x1100_brandmodel.jpg
 *   - arcs-salt--pepper-grinder_910x1100_brandmodel.jpg
 *
 * We also remove aal-87-soft image from AAL 87 (the non-soft version).
 *
 * Exclusions: keep these images for their OWN products (Bella product keeps bella image, etc.)
 */
require('dotenv').config();
const { pool } = require('../src/config/database');

const DRY_RUN = !process.argv.includes('--execute');

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN (pass --execute to delete) ===' : '=== EXECUTING CLEANUP ===');

  // Step 1: Count/show what will be deleted
  const { rows: counts } = await pool.query(`
    SELECT
      SUM(CASE WHEN psi.image_url LIKE '%tin-container_910x1100%'
                AND LOWER(p.name) NOT LIKE '%tin container%' THEN 1 ELSE 0 END) AS tin_container,
      SUM(CASE WHEN psi.image_url LIKE '%bella_910x1100_brandmodel%'
                AND LOWER(p.name) NOT LIKE '%bella%' THEN 1 ELSE 0 END) AS bella,
      SUM(CASE WHEN psi.image_url LIKE '%cph-90-desk_910x1100%'
                AND LOWER(p.name) NOT LIKE '%cph 90%' THEN 1 ELSE 0 END) AS cph90desk,
      SUM(CASE WHEN psi.image_url LIKE '%terrazza-parasol_910x1100%'
                AND LOWER(p.name) NOT LIKE '%terrazza%' THEN 1 ELSE 0 END) AS terrazza,
      SUM(CASE WHEN psi.image_url LIKE '%arcs-salt--pepper-grinder_910x1100%'
                AND LOWER(p.name) NOT LIKE '%arcs%' THEN 1 ELSE 0 END) AS arcs_salt,
      SUM(CASE WHEN psi.image_url LIKE '%aal-87-soft_910x1100%'
                AND p.name != 'AAL 87 Soft' THEN 1 ELSE 0 END) AS aal87soft_wrong,
      COUNT(*) AS total_checked
    FROM product_siglip_images psi
    JOIN products p ON p.id = psi.product_id
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'hay'
    AND (
      (psi.image_url LIKE '%tin-container_910x1100%' AND LOWER(p.name) NOT LIKE '%tin container%')
      OR (psi.image_url LIKE '%bella_910x1100_brandmodel%' AND LOWER(p.name) NOT LIKE '%bella%')
      OR (psi.image_url LIKE '%cph-90-desk_910x1100%' AND LOWER(p.name) NOT LIKE '%cph 90%')
      OR (psi.image_url LIKE '%terrazza-parasol_910x1100%' AND LOWER(p.name) NOT LIKE '%terrazza%')
      OR (psi.image_url LIKE '%arcs-salt--pepper-grinder_910x1100%' AND LOWER(p.name) NOT LIKE '%arcs%')
      OR (psi.image_url LIKE '%aal-87-soft_910x1100%' AND p.name != 'AAL 87 Soft')
    )
  `);

  console.log('\nWill delete:');
  console.log(`  tin-container in wrong products: ${counts[0].tin_container}`);
  console.log(`  bella in wrong products:         ${counts[0].bella}`);
  console.log(`  cph-90-desk in wrong products:   ${counts[0].cph90desk}`);
  console.log(`  terrazza-parasol in wrong:        ${counts[0].terrazza}`);
  console.log(`  arcs-salt in wrong products:     ${counts[0].arcs_salt}`);
  console.log(`  aal-87-soft under AAL 87:        ${counts[0].aal87soft_wrong}`);
  console.log(`  TOTAL rows to delete:            ${counts[0].total_checked}`);

  // Count affected products
  const { rows: affectedProds } = await pool.query(`
    SELECT COUNT(DISTINCT p.id) as affected_products
    FROM product_siglip_images psi
    JOIN products p ON p.id = psi.product_id
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'hay'
    AND (
      (psi.image_url LIKE '%tin-container_910x1100%' AND LOWER(p.name) NOT LIKE '%tin container%')
      OR (psi.image_url LIKE '%bella_910x1100_brandmodel%' AND LOWER(p.name) NOT LIKE '%bella%')
      OR (psi.image_url LIKE '%cph-90-desk_910x1100%' AND LOWER(p.name) NOT LIKE '%cph 90%')
      OR (psi.image_url LIKE '%terrazza-parasol_910x1100%' AND LOWER(p.name) NOT LIKE '%terrazza%')
      OR (psi.image_url LIKE '%arcs-salt--pepper-grinder_910x1100%' AND LOWER(p.name) NOT LIKE '%arcs%')
      OR (psi.image_url LIKE '%aal-87-soft_910x1100%' AND p.name != 'AAL 87 Soft')
    )
  `);
  console.log(`  Across ${affectedProds[0].affected_products} products\n`);

  if (DRY_RUN) {
    console.log('Pass --execute to actually delete.\n');
    await pool.end();
    return;
  }

  // Step 2: Execute deletion
  const { rowCount } = await pool.query(`
    DELETE FROM product_siglip_images psi
    USING products p, brands b
    WHERE psi.product_id = p.id
      AND p.brand_id = b.id
      AND b.slug = 'hay'
      AND (
        (psi.image_url LIKE '%tin-container_910x1100%' AND LOWER(p.name) NOT LIKE '%tin container%')
        OR (psi.image_url LIKE '%bella_910x1100_brandmodel%' AND LOWER(p.name) NOT LIKE '%bella%')
        OR (psi.image_url LIKE '%cph-90-desk_910x1100%' AND LOWER(p.name) NOT LIKE '%cph 90%')
        OR (psi.image_url LIKE '%terrazza-parasol_910x1100%' AND LOWER(p.name) NOT LIKE '%terrazza%')
        OR (psi.image_url LIKE '%arcs-salt--pepper-grinder_910x1100%' AND LOWER(p.name) NOT LIKE '%arcs%')
        OR (psi.image_url LIKE '%aal-87-soft_910x1100%' AND p.name != 'AAL 87 Soft')
      )
  `);
  console.log(`✓ Deleted ${rowCount} bad embeddings from dev DB`);

  // Step 3: Show how many products now need re-scraping
  const { rows: needsScrape } = await pool.query(`
    SELECT COUNT(*) AS cnt
    FROM (
      SELECT p.id
      FROM products p JOIN brands b ON b.id=p.brand_id
      LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
      WHERE b.slug='hay'
      GROUP BY p.id
      HAVING COUNT(psi.id) < 4
    ) sub
  `);
  console.log(`→ ${needsScrape[0].cnt} HAY products now have < 4 embeddings and need re-scraping\n`);

  // Step 4: Verify AAL 87 Soft specifically
  const { rows: aal87soft } = await pool.query(`
    SELECT psi.image_url
    FROM product_siglip_images psi
    JOIN products p ON p.id=psi.product_id
    JOIN brands b ON b.id=p.brand_id
    WHERE b.slug='hay' AND p.name='AAL 87 Soft'
  `);
  console.log(`AAL 87 Soft now has ${aal87soft.length} embeddings:`);
  aal87soft.forEach(r => console.log(`  - ${r.image_url.split('/').pop().split('?')[0]}`));

  const { rows: aal87 } = await pool.query(`
    SELECT psi.image_url
    FROM product_siglip_images psi
    JOIN products p ON p.id=psi.product_id
    JOIN brands b ON b.id=p.brand_id
    WHERE b.slug='hay' AND p.name='AAL 87'
  `);
  console.log(`\nAAL 87 now has ${aal87.length} embeddings:`);
  aal87.forEach(r => console.log(`  - ${r.image_url.split('/').pop().split('?')[0]}`));

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
