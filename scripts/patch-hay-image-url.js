/**
 * Set products.image_url for the 27 new HAY products
 * by pulling the first 'product' type image from product_siglip_images.
 */
require('dotenv').config();
const { pool } = require('../src/config/database');

async function main() {
  // Update image_url on the product record from its first product-type image
  const { rowCount } = await pool.query(`
    UPDATE products pr
    SET image_url = sub.image_url,
        updated_at = NOW()
    FROM (
      SELECT DISTINCT ON (psi.product_id)
        psi.product_id,
        psi.image_url
      FROM product_siglip_images psi
      JOIN products p ON p.id = psi.product_id
      JOIN brands b ON b.id = p.brand_id
      WHERE b.slug = 'hay'
        AND p.created_at > NOW() - INTERVAL '3 hours'
        AND (p.image_url IS NULL OR p.image_url = '')
      ORDER BY psi.product_id,
        CASE psi.image_type WHEN 'product' THEN 0 ELSE 1 END,
        psi.created_at
    ) sub
    WHERE pr.id = sub.product_id
  `);

  console.log(`Updated image_url on ${rowCount} products`);

  // Verify
  const { rows } = await pool.query(`
    SELECT pr.name, pr.image_url
    FROM products pr JOIN brands br ON br.id=pr.brand_id
    WHERE br.slug='hay' AND pr.created_at > NOW() - INTERVAL '3 hours'
    ORDER BY pr.name
  `);
  rows.forEach(r => {
    const img = r.image_url ? r.image_url.split('/').pop() : 'MISSING';
    console.log(`  ${r.name.substring(0,50).padEnd(52)} ${img.substring(0,50)}`);
  });

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
