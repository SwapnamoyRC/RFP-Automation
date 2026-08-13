require('dotenv').config();
const { pool } = require('../src/config/database');

async function main() {
  const del = await pool.query(`
    DELETE FROM product_siglip_images
    WHERE image_url LIKE '%naughtone%'
      AND image_url LIKE '%1920x%'
  `);
  console.log('Deleted:', del.rowCount, 'NaughtOne wide shots (1920x)');

  // Which products now have < 4 images?
  const { rows } = await pool.query(`
    SELECT p.id, p.name, p.source_url, COUNT(psi.id) as imgs
    FROM products p
    JOIN brands b ON b.id = p.brand_id
    LEFT JOIN product_siglip_images psi ON psi.product_id = p.id
    WHERE b.slug = 'naughtone'
    GROUP BY p.id, p.name, p.source_url
    HAVING COUNT(psi.id) < 4
    ORDER BY COUNT(psi.id), p.name
  `);
  console.log(`\nNaughtOne products now with < 4 images: ${rows.length}`);
  rows.forEach(r => console.log(`  [${r.imgs}] ${r.name}`));

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
