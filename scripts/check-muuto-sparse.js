require('dotenv').config();
const { pool } = require('../src/config/database');
async function main() {
  const { rows } = await pool.query(`
    SELECT p.name, COUNT(psi.id) AS imgs
    FROM products p JOIN brands b ON b.id=p.brand_id
    LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
    WHERE b.slug='muuto'
    GROUP BY p.id, p.name
    HAVING COUNT(psi.id) < 4
    ORDER BY COUNT(psi.id), p.name
  `);
  console.log('Products needing re-scrape (' + rows.length + '):');
  rows.forEach(r => console.log('  [' + r.imgs + '] ' + r.name));
  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
