require('dotenv').config();
const { pool } = require('../src/config/database');

async function main() {
  // Check Eames Folding Screen images
  console.log('=== Eames Molded Plywood Folding Screen images ===');
  const { rows: fs } = await pool.query(`
    SELECT psi.image_url FROM product_siglip_images psi
    JOIN products p ON p.id=psi.product_id JOIN brands b ON b.id=p.brand_id
    WHERE b.slug='herman-miller' AND p.name ILIKE '%folding screen%'
    ORDER BY psi.image_url
  `);
  fs.forEach(r => console.log(' ', r.image_url.split('/').pop()));

  // Check near-duplicate URLs (same base, different rendition size)
  console.log('\n=== Near-duplicate URLs (same stem, different rendition) ===');
  const { rows: near } = await pool.query(`
    SELECT
      regexp_replace(psi.image_url, '\\.rendition\\.\\d+\\.\\d+', '') AS stem,
      COUNT(DISTINCT psi.product_id) prods,
      string_agg(DISTINCT p.name, ' | ') prod_names,
      string_agg(psi.image_url, ' | ') urls
    FROM product_siglip_images psi
    JOIN products p ON p.id=psi.product_id JOIN brands b ON b.id=p.brand_id
    WHERE b.slug='herman-miller'
    GROUP BY stem
    HAVING COUNT(DISTINCT psi.product_id) > 1
    ORDER BY prods DESC
    LIMIT 30
  `);
  if (near.length === 0) {
    console.log('  ✓ None found.\n');
  } else {
    near.forEach(r => {
      console.log(`  [${r.prods}p] stem: ...${r.stem.split('/').pop()}`);
      console.log(`    → ${r.prod_names.substring(0, 140)}`);
    });
  }

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
