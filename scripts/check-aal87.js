require('dotenv').config();
const { pool } = require('../src/config/database');

async function main() {
  const { rows } = await pool.query(`
    SELECT p.name, COUNT(psi.id) as cnt,
      array_agg(split_part(psi.image_url, '/', -1) ORDER BY psi.image_url) as filenames
    FROM products p
    JOIN brands b ON b.id = p.brand_id
    LEFT JOIN product_siglip_images psi ON psi.product_id = p.id
    WHERE b.slug = 'hay' AND p.name IN ('AAL 87 Soft', 'AAL 87', 'AAL 91', '30 Degree', '3 Colour Rug')
    GROUP BY p.id, p.name ORDER BY p.name
  `);

  for (const r of rows) {
    console.log(`\n${r.name} (${r.cnt} embeddings):`);
    if (r.filenames && r.filenames[0]) {
      r.filenames.forEach(f => console.log(`  - ${f}`));
    }
  }

  // Also show overall HAY coverage
  const { rows: stats } = await pool.query(`
    SELECT
      COUNT(DISTINCT p.id) AS total_products,
      SUM(CASE WHEN img_count >= 4 THEN 1 ELSE 0 END) AS good,
      SUM(CASE WHEN img_count BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS partial,
      SUM(CASE WHEN img_count = 0 THEN 1 ELSE 0 END) AS zero
    FROM (
      SELECT p.id, COUNT(psi.id) AS img_count
      FROM products p JOIN brands b ON b.id=p.brand_id
      LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
      WHERE b.slug='hay'
      GROUP BY p.id
    ) sub
  `);
  console.log(`\nHAY coverage: ${stats[0].total_products} total | ${stats[0].good} good (≥4) | ${stats[0].partial} partial (1-3) | ${stats[0].zero} zero`);

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
