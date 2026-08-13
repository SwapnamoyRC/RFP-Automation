require('dotenv').config();
const { pool } = require('../src/config/database');
async function main() {
  const { rows } = await pool.query(`
    SELECT p.name, p.source_url
    FROM products p JOIN brands b ON b.id = p.brand_id
    LEFT JOIN product_siglip_images psi ON psi.product_id = p.id
    WHERE b.slug = 'muuto'
    GROUP BY p.id, p.name, p.source_url
    HAVING COUNT(psi.id) = 0
    ORDER BY p.name
  `);
  rows.forEach(r => console.log(`[${r.name}]\n  ${r.source_url}\n`));
  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
