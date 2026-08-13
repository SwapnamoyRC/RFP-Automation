require('dotenv').config();
const { pool } = require('../src/config/database');
async function main() {
  // Workshop Chair was re-contaminated by the page fallback scraper
  // "Workshop" first-keyword matches Coffee Table, Bench, Table images
  const del = await pool.query(`
    DELETE FROM product_siglip_images psi
    USING products p, brands b
    WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
      AND p.name ILIKE '%workshop chair%'
      AND (
        psi.image_url ILIKE '%workshop-coffee-table%'
        OR psi.image_url ILIKE '%workshop-table-200%'
        OR psi.image_url ILIKE '%workshop-bench%'
      )
  `);
  console.log(`Deleted ${del.rowCount} re-contaminated Workshop Chair rows`);

  // Check remaining images for Workshop Chair
  const { rows } = await pool.query(`
    SELECT psi.image_url
    FROM product_siglip_images psi
    JOIN products p ON p.id = psi.product_id
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'muuto' AND p.name ILIKE '%workshop chair%'
    ORDER BY psi.image_url
  `);
  console.log(`\nWorkshop Chair now has ${rows.length} images:`);
  rows.forEach(r => console.log(`  - ${r.image_url.split('/').pop().split('?')[0]}`));

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
