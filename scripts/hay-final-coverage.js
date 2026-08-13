require('dotenv').config();
const { pool } = require('../src/config/database');
async function main() {
  // Overall HAY coverage
  const q1 = `
    SELECT
      COUNT(DISTINCT t.id) AS total,
      SUM(CASE WHEN t.imgs >= 4 THEN 1 ELSE 0 END) AS good,
      SUM(CASE WHEN t.imgs BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS partial,
      SUM(CASE WHEN t.imgs = 0 THEN 1 ELSE 0 END) AS zero
    FROM (
      SELECT pr.id, COUNT(si.id) AS imgs
      FROM products pr
      JOIN brands br ON br.id = pr.brand_id
      LEFT JOIN product_siglip_images si ON si.product_id = pr.id
      WHERE br.slug = 'hay'
      GROUP BY pr.id
    ) t
  `;
  const { rows: [c] } = await pool.query(q1);
  console.log(`HAY: ${c.total} products | ${c.good} good (>=4) | ${c.partial} partial | ${c.zero} zero`);

  // Newly added products (last 2 hours)
  const q2 = `
    SELECT pr.name, COUNT(si.id) AS imgs
    FROM products pr
    JOIN brands br ON br.id = pr.brand_id
    LEFT JOIN product_siglip_images si ON si.product_id = pr.id
    WHERE br.slug = 'hay'
      AND pr.created_at > NOW() - INTERVAL '2 hours'
    GROUP BY pr.id, pr.name
    ORDER BY pr.name
  `;
  const { rows: newProds } = await pool.query(q2);
  console.log(`\nNew products added today (${newProds.length}):`);
  newProds.forEach(r => console.log(`  [${r.imgs} imgs] ${r.name}`));

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
