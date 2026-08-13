require('dotenv').config();
const { pool } = require('../src/config/database');

async function main() {
  const del = await pool.query(`
    DELETE FROM product_siglip_images
    WHERE product_id IN (
      SELECT p.id FROM products p JOIN brands b ON b.id = p.brand_id WHERE b.slug = 'muuto'
    )
    AND (
      image_url LIKE '%-org_%'
      OR image_url LIKE '%_org_%'
      OR image_url LIKE '%-org.%'
      OR image_url LIKE '%_org.%'
      OR image_url LIKE '%in-situ%'
    )
  `);
  console.log('Deleted', del.rowCount, 'Muuto lifestyle shots from dev');

  const { rows } = await pool.query(`
    SELECT COUNT(DISTINCT p.id) as cnt
    FROM products p JOIN brands b ON b.id=p.brand_id
    LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
    WHERE b.slug='muuto'
    GROUP BY p.id HAVING COUNT(psi.id) < 4
  `);
  console.log('Muuto products now with < 4 images:', rows.length);

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
