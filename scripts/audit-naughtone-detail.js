/**
 * Deep-dive: check specific shared images to determine which product each image
 * actually belongs to (by reading the product code in the filename).
 */
require('dotenv').config();
const { pool } = require('../src/config/database');

async function main() {
  // Check specific suspicious pairs
  const checks = [
    // Truffle images on Pippin Chair
    { label: 'Truffle images on Pippin Chair', cond: `p.name ILIKE '%pippin%' AND psi.image_url ILIKE '%TUF%'` },
    // Viv images on Ruby
    { label: 'Viv images on Ruby Wood', cond: `p.name ILIKE '%ruby%' AND (psi.image_url ILIKE '%viv%' OR psi.image_url ILIKE '%VIV%')` },
    // Viv wood image on Polly
    { label: 'Viv-wood image on Polly', cond: `p.name ILIKE '%polly%' AND psi.image_url ILIKE '%viv-wood%'` },
    // Pippin image on Knot Laptop Table
    { label: 'Pippin image on Knot Laptop Table', cond: `p.name ILIKE '%knot%' AND psi.image_url ILIKE '%PIPPIN%'` },
    // -copy images on any product
    { label: 'Any -copy images (all products)', cond: `psi.image_url ILIKE '%-copy%'` },
    // Sofa image on Pullman Desk
    { label: 'Sofa image on Pullman Desk', cond: `p.name ILIKE '%pullman desk%' AND psi.image_url ILIKE '%sofa%'` },
    // Material swatches shared across Knot/Lasso/Pullman
    { label: 'MDF edge swatches on Lasso Stool', cond: `p.name ILIKE '%lasso%' AND psi.image_url ILIKE '%MDF_edge%'` },
    { label: 'MDF edge swatches on Knot Laptop', cond: `p.name ILIKE '%knot laptop%' AND psi.image_url ILIKE '%MDF_edge%'` },
    // Multi-product group shots
    { label: 'NOMSA group shot distribution', cond: `psi.image_url ILIKE '%NOMSA524%'` },
    { label: 'EVER+Sideboard group shot', cond: `psi.image_url ILIKE '%EVER12A_TUN620ST%'` },
    // Hue Seating/Table (same family, expected)
    { label: 'Hue shared image', cond: `psi.image_url ILIKE '%NOHUE__0002%'` },
    // Pullman Booth/Chair shared (same family)
    { label: 'Pullman Booth+Chair shared image', cond: `psi.image_url ILIKE '%PULB2H_PUL15HPL%'` },
  ];

  for (const { label, cond } of checks) {
    const { rows } = await pool.query(`
      SELECT p.name, psi.image_url
      FROM product_siglip_images psi
      JOIN products p ON p.id=psi.product_id
      JOIN brands b ON b.id=p.brand_id
      WHERE b.slug='naughtone' AND (${cond})
      ORDER BY p.name
    `);
    if (rows.length === 0) {
      console.log(`✓ [CLEAN] ${label}`);
    } else {
      console.log(`✗ [${rows.length}] ${label}`);
      rows.forEach(r => console.log(`   → [${r.name}] ${r.image_url.split('/').pop()}`));
    }
  }

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
