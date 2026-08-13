require('dotenv').config();
const { pool } = require('../src/config/database');
async function main() {
  const patches = [
    { slug: 'backflip-wall-bracket',                    dimensions: 'H8 x W53 x L17' },
    { slug: 'chisel-630-extendable-table-rectangular',  dimensions: 'H74 x W180 x L95' },
  ];
  for (const p of patches) {
    const r = await pool.query(
      `UPDATE products SET dimensions=$1, updated_at=NOW() WHERE slug=$2 RETURNING name`,
      [p.dimensions, p.slug]
    );
    if (r.rows[0]) console.log(`  ✓ ${r.rows[0].name}  →  ${p.dimensions}`);
    else console.log(`  ✗ not found: ${p.slug}`);
  }
  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
