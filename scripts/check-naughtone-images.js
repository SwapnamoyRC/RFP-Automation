require('dotenv').config();
const { pool } = require('../src/config/database');

async function main() {
  const { rows } = await pool.query(`
    SELECT p.name, COUNT(psi.id) c,
      array_agg(split_part(psi.image_url, '/', -1) ORDER BY psi.image_url) urls
    FROM products p JOIN brands b ON b.id=p.brand_id
    LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
    WHERE b.slug='naughtone'
    GROUP BY p.id, p.name
    ORDER BY p.name
  `);
  rows.forEach(r => {
    console.log(`\n[${r.c} imgs] ${r.name}`);
    (r.urls || []).forEach(u => console.log(`   ${u}`));
  });
  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
