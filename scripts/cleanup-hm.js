/**
 * Herman Miller cleanup — remove 2 wrong-product images from Eames Folding Screen.
 */
require('dotenv').config();
const { pool } = require('../src/config/database');

const DRY_RUN = !process.argv.includes('--execute');

async function del(label, condition) {
  const sql = `DELETE FROM product_siglip_images psi
    USING products p, brands b
    WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'herman-miller'
      AND (${condition})`;
  if (DRY_RUN) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) n FROM product_siglip_images psi
       JOIN products p ON p.id=psi.product_id JOIN brands b ON b.id=p.brand_id
       WHERE b.slug='herman-miller' AND (${condition})`
    );
    console.log(`  [DRY] ${rows[0].n} row(s) — ${label}`);
  } else {
    const r = await pool.query(sql);
    console.log(`  ✓ ${r.rowCount} row(s) — ${label}`);
  }
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===\n' : '=== EXECUTING HM CLEANUP ===\n');

  // Hang-It-All image on Folding Screen
  await del(
    'Hang-It-All image on Eames Folding Screen',
    `p.name ILIKE '%folding screen%' AND psi.image_url ILIKE '%hang_it_all%'`
  );

  // Girard Posters image on Folding Screen
  await del(
    'Girard Posters image on Eames Folding Screen',
    `p.name ILIKE '%folding screen%' AND psi.image_url ILIKE '%girard_environmental%'`
  );

  const { rows: [s] } = await pool.query(`
    SELECT COUNT(*) total,
      SUM(CASE WHEN c=0 THEN 1 ELSE 0 END) zero,
      SUM(CASE WHEN c BETWEEN 1 AND 3 THEN 1 ELSE 0 END) partial,
      SUM(CASE WHEN c>=4 THEN 1 ELSE 0 END) good
    FROM (SELECT p.id, COUNT(psi.id) c
          FROM products p JOIN brands b ON b.id=p.brand_id
          LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
          WHERE b.slug='herman-miller' GROUP BY p.id) sub
  `);
  console.log(`\nHerman Miller: ${s.total} products | ${s.good} good (≥4) | ${s.partial} partial | ${s.zero} zero`);

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
