require('dotenv').config();
const { pool } = require('../src/config/database');
async function main() {
  const { rows } = await pool.query(`
    SELECT p.id, p.name, p.source_url, COUNT(psi.id) AS imgs
    FROM products p JOIN brands b ON b.id = p.brand_id
    LEFT JOIN product_siglip_images psi ON psi.product_id = p.id
    WHERE b.slug = 'muuto'
      AND (p.name ILIKE '%fiber soft%' OR p.name ILIKE '%visu bar stool%')
    GROUP BY p.id, p.name, p.source_url
    ORDER BY p.name
  `);
  rows.forEach(r => console.log(`[id=${r.id}] [${r.imgs} imgs] ${r.name}\n  ${r.source_url}`));
  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
