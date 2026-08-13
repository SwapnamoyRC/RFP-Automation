require('dotenv').config();
const { pool } = require('../src/config/database');

async function main() {
  // Sample 10 products with terrazza-parasol images that aren't terrazza products
  const { rows } = await pool.query(`
    SELECT p.name, psi.image_url
    FROM product_siglip_images psi
    JOIN products p ON p.id = psi.product_id
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'hay'
      AND psi.image_url LIKE '%terrazza-parasol_910x1100%'
      AND LOWER(p.name) NOT LIKE '%terrazza%'
    ORDER BY p.name
    LIMIT 15
  `);
  console.log(`Sample of products with terrazza-parasol image:\n`);
  rows.forEach(r => console.log(`  [${r.name}] ${r.image_url}`));

  // Also check the actual URL length / patterns
  const { rows: urlExamples } = await pool.query(`
    SELECT DISTINCT psi.image_url
    FROM product_siglip_images psi
    JOIN products p ON p.id = psi.product_id
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'hay'
      AND psi.image_url LIKE '%terrazza-parasol_910x1100%'
    LIMIT 5
  `);
  console.log('\nDistinct terrazza-parasol URLs:');
  urlExamples.forEach(r => console.log(`  ${r.image_url}`));

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
