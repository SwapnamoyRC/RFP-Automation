/**
 * NaughtOne contamination cleanup.
 * Removes wrong-product images confirmed by filename analysis.
 */
require('dotenv').config();
const { pool } = require('../src/config/database');

const DRY_RUN = !process.argv.includes('--execute');

async function del(label, condition) {
  const sql = `DELETE FROM product_siglip_images psi
    USING products p, brands b
    WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'naughtone'
      AND (${condition})`;
  if (DRY_RUN) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) n FROM product_siglip_images psi
       JOIN products p ON p.id=psi.product_id JOIN brands b ON b.id=p.brand_id
       WHERE b.slug='naughtone' AND (${condition})`
    );
    console.log(`  [DRY] ${rows[0].n} row(s) — ${label}`);
  } else {
    const r = await pool.query(sql);
    console.log(`  ✓ ${r.rowCount} row(s) — ${label}`);
  }
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN (pass --execute to apply) ===\n' : '=== EXECUTING NAUGHTONE CLEANUP ===\n');

  // 1. Truffle Pouf images on Pippin Chair
  await del(
    'Truffle images on Pippin Chair',
    `p.name ILIKE '%pippin%' AND (psi.image_url ILIKE '%NTO_TUF_%')`
  );

  // 2. Viv-wood material images on Ruby Wood Chair / Barstool
  await del(
    'Viv-wood material images on Ruby Wood',
    `p.name ILIKE '%ruby wood%' AND (
       psi.image_url ILIKE '%viv-wood%'
       OR psi.image_url ILIKE '%VIVBSWD%'
     )`
  );

  // 3. Viv-wood material images on Polly Wood Chair / Barstool
  await del(
    'Viv-wood material images on Polly Wood',
    `p.name ILIKE '%polly wood%' AND psi.image_url ILIKE '%viv-wood%'`
  );

  // 4. "Sofa" copy image on Pullman Desk
  await del(
    'Sofa-copy image on Pullman Desk',
    `p.name ILIKE '%pullman desk%' AND psi.image_url ILIKE '%sofa%'`
  );

  // 5. -copy lifestyle images on Rhyme Modular Seating
  await del(
    'copy lifestyle images on Rhyme Modular Seating',
    `p.name ILIKE '%rhyme%' AND psi.image_url ILIKE '%-copy%'`
  );

  // Summary
  const { rows: [s] } = await pool.query(`
    SELECT COUNT(*) total,
      SUM(CASE WHEN c=0 THEN 1 ELSE 0 END) zero,
      SUM(CASE WHEN c BETWEEN 1 AND 3 THEN 1 ELSE 0 END) partial,
      SUM(CASE WHEN c>=4 THEN 1 ELSE 0 END) good
    FROM (SELECT p.id, COUNT(psi.id) c
          FROM products p JOIN brands b ON b.id=p.brand_id
          LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
          WHERE b.slug='naughtone' GROUP BY p.id) sub
  `);
  console.log(`\nNaughtOne: ${s.total} products | ${s.good} good (≥4) | ${s.partial} partial | ${s.zero} zero`);

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
