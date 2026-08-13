require('dotenv').config();
const { pool } = require('../src/config/database');
async function main() {
  // Accessories whose designer is known from their parent product
  const patches = [
    ['backflip-wall-bracket', 'Gudmundur Ludvik'],  // accessory for Backflip Chair
    ['mimi-cushion',          'Philippe Malouin'],   // accessory for Mimi Sofa
    ['mimi-ottoman',          'Philippe Malouin'],   // accessory for Mimi Sofa
  ];
  for (const [slug, designer] of patches) {
    const r = await pool.query(
      `UPDATE products SET designer=$1, updated_at=NOW() WHERE slug=$2 RETURNING name`,
      [designer, slug]
    );
    if (r.rows[0]) console.log(`  ✓ ${r.rows[0].name}  →  ${designer}`);
    else console.log(`  ✗ slug not found: ${slug}`);
  }
  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
