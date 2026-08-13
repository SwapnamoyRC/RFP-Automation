require('dotenv').config();
const { pool } = require('../src/config/database');
async function main() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN img_count = 0 THEN 1 ELSE 0 END) AS zero,
      SUM(CASE WHEN img_count BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS partial,
      SUM(CASE WHEN img_count >= 4 THEN 1 ELSE 0 END) AS good,
      MIN(img_count) AS min_imgs,
      MAX(img_count) AS max_imgs,
      ROUND(AVG(img_count),1) AS avg_imgs
    FROM (
      SELECT p.id, COUNT(psi.id) AS img_count
      FROM products p
      JOIN brands b ON b.id = p.brand_id
      LEFT JOIN product_siglip_images psi ON psi.product_id = p.id
      WHERE b.slug = 'hay'
      GROUP BY p.id
    ) sub
  `);
  const s = rows[0];
  console.log('HAY Final Coverage:');
  console.log(`  Total products:     ${s.total}`);
  console.log(`  Good (>=4 images):  ${s.good}  (${Math.round(s.good/s.total*100)}%)`);
  console.log(`  Partial (1-3):      ${s.partial}`);
  console.log(`  Zero images:        ${s.zero}`);
  console.log(`  Min / Avg / Max:    ${s.min_imgs} / ${s.avg_imgs} / ${s.max_imgs}`);

  // Products with only 1 image — check they're genuinely sparse, not contaminated
  const { rows: sparse } = await pool.query(`
    SELECT p.name, COUNT(psi.id) as imgs
    FROM products p
    JOIN brands b ON b.id = p.brand_id
    LEFT JOIN product_siglip_images psi ON psi.product_id = p.id
    WHERE b.slug = 'hay'
    GROUP BY p.id, p.name
    HAVING COUNT(psi.id) <= 1
    ORDER BY COUNT(psi.id) ASC, p.name
  `);
  if (sparse.length > 0) {
    console.log(`\nProducts with <=1 image (${sparse.length} total):`);
    sparse.forEach(r => console.log(`  [${r.imgs}] ${r.name}`));
  } else {
    console.log('\n✓ All products have at least 2 images');
  }
  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
