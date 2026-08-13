require('dotenv').config();
const { pool } = require('../src/config/database');

const newPageProducts = [
  'Pack Chair 10',
  'Pack Chair 11',
  'Mimi 1 Seater',
  'Mimi 2 Seater',
  'Mimi 2.5 Seater',
  'Mimi 3 Seater',
  'Mimi Ottoman',
  'Mimi Cushion',
  'Backflip Chair',
  'Backflip Wall Bracket',
  'Chisel 10 Stool',
  'Chisel 30 Bar Stool',
  'Chisel 35 Bar Stool',
  'Chisel 65 Chair',
  'Chisel 85 Lounge Chair',
  'Chisel 20 Table Round',
  'Chisel 25 Table Round',
  'Chisel 29 Table Round',
  'Chisel 30 Table Rectangular',
  'Chisel 630 Extendable Table Rectangular',
  'Tray Table',
  'Mags Soft 2.5 Seater Low armrest with removable cover',
  'Mags Soft 3 Seater Low armrest with removable cover',
  'Mags Soft with Removable Cover S01RC',
];

async function main() {
  // Get all HAY products in DB
  const { rows: hayProducts } = await pool.query(`
    SELECT p.name, p.slug
    FROM products p
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'hay'
    ORDER BY p.name
  `);

  console.log(`\nTotal HAY products in DB: ${hayProducts.length}\n`);

  const dbNames = hayProducts.map(r => r.name.toLowerCase().trim());

  console.log('=== NEW PAGE PRODUCTS — STATUS ===\n');
  const missing = [];
  for (const product of newPageProducts) {
    const found = dbNames.some(n =>
      n.includes(product.toLowerCase().trim()) ||
      product.toLowerCase().trim().includes(n)
    );
    const status = found ? '✓ IN DB' : '✗ MISSING';
    if (!found) missing.push(product);
    console.log(`  ${status}  ${product}`);
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`  In DB:   ${newPageProducts.length - missing.length}`);
  console.log(`  Missing: ${missing.length}`);
  if (missing.length > 0) {
    console.log('\nProducts to add:');
    missing.forEach(p => console.log(`  - ${p}`));
  }

  // Also show all hay products that contain "mags soft", "chisel", "mimi", "pack", "backflip", "tray" to help identify partial matches
  console.log('\n=== RELEVANT EXISTING HAY PRODUCTS ===');
  const keywords = ['mags', 'chisel', 'mimi', 'pack', 'backflip', 'tray'];
  hayProducts
    .filter(p => keywords.some(k => p.name.toLowerCase().includes(k)))
    .forEach(p => console.log(`  ${p.name}`));

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
