require('dotenv').config();
const { pool } = require('../src/config/database');
async function main() {
  // Check what existing Mags Soft products have for dimensions
  const { rows } = await pool.query(`
    SELECT pr.name, pr.dimensions, pr.materials
    FROM products pr JOIN brands br ON br.id=pr.brand_id
    WHERE br.slug='hay' AND pr.name ILIKE 'mags soft%'
      AND pr.dimensions IS NOT NULL
    ORDER BY name LIMIT 10
  `);
  console.log('Existing Mags Soft dimensions:');
  rows.forEach(r => console.log(`  [${r.name}]\n    dims: ${r.dimensions}\n    mats: ${r.materials}`));
  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
