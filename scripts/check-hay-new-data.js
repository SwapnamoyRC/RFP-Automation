require('dotenv').config();
const { pool } = require('../src/config/database');
async function main() {
  const { rows } = await pool.query(`
    SELECT
      pr.name,
      pr.category,
      pr.designer,
      pr.description,
      pr.dimensions,
      pr.materials,
      pr.sustainability,
      pr.certifications,
      pr.pdf_url,
      COUNT(si.id) img_count
    FROM products pr
    JOIN brands br ON br.id = pr.brand_id
    LEFT JOIN product_siglip_images si ON si.product_id = pr.id
    WHERE br.slug = 'hay'
      AND pr.created_at > NOW() - INTERVAL '2 hours'
    GROUP BY pr.id, pr.name, pr.category, pr.designer, pr.description,
             pr.dimensions, pr.materials, pr.sustainability, pr.certifications, pr.pdf_url
    ORDER BY pr.name
  `);

  console.log('=== New HAY products — data completeness ===\n');

  const fields = ['category','designer','description','dimensions','materials','sustainability','certifications','pdf_url'];

  // Header
  console.log('Product'.padEnd(55) + 'imgs  ' + fields.map(f => f.substring(0,5).padEnd(7)).join(''));
  console.log('-'.repeat(55 + 6 + fields.length * 7));

  let missingDims = 0, missingMats = 0, missingDesc = 0, missingDesigner = 0;

  rows.forEach(r => {
    const vals = fields.map(f => r[f] ? '✓' : '✗');
    console.log(
      r.name.substring(0,54).padEnd(55) +
      String(r.img_count).padEnd(6) +
      vals.map(v => v.padEnd(7)).join('')
    );
    if (!r.dimensions)   missingDims++;
    if (!r.materials)    missingMats++;
    if (!r.description)  missingDesc++;
    if (!r.designer)     missingDesigner++;
  });

  console.log(`\n=== Missing field counts (out of ${rows.length} products) ===`);
  console.log(`  description:    ${missingDesc} missing`);
  console.log(`  designer:       ${missingDesigner} missing`);
  console.log(`  dimensions:     ${missingDims} missing`);
  console.log(`  materials:      ${missingMats} missing`);

  // Show descriptions that were saved
  console.log('\n=== Descriptions saved ===');
  rows.forEach(r => {
    if (r.description) {
      console.log(`\n  [${r.name}]`);
      console.log(`  ${r.description.substring(0, 120)}...`);
    }
  });

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
