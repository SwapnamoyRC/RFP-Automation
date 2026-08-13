/**
 * Muuto final cleanup — remaining cross-product contaminations.
 */
require('dotenv').config();
const { pool } = require('../src/config/database');
const DRY_RUN = !process.argv.includes('--execute');

async function del(label, condition) {
  const sql = `DELETE FROM product_siglip_images psi
    USING products p, brands b
    WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
      AND (${condition})`;
  if (DRY_RUN) {
    const { rows } = await pool.query(`SELECT COUNT(*) AS n FROM product_siglip_images psi
      JOIN products p ON p.id = psi.product_id JOIN brands b ON b.id = p.brand_id
      WHERE b.slug = 'muuto' AND (${condition})`);
    console.log(`  [DRY] ${rows[0].n} — ${label}`);
  } else {
    const r = await pool.query(sql);
    console.log(`  ✓ ${r.rowCount} — ${label}`);
  }
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===\n' : '=== EXECUTING FINAL MUUTO CLEANUP ===\n');

  await del('Dots Ceramic — dots-metal image',
    `p.name ILIKE '%dots ceramic%' AND psi.image_url ILIKE '%dots-metal%'`);

  await del('Dots Metal — dots-ceramic image',
    `p.name ILIKE '%dots metal%' AND psi.image_url ILIKE '%dots-ceramic%'`);

  await del('Rime Pendant Cluster — rime-wall-lamp image',
    `p.name ILIKE '%rime pendant cluster%' AND psi.image_url ILIKE '%rime-wall-lamp%'`);

  await del('Rime Wall Lamp — rime-pendant image',
    `p.name ILIKE '%rime wall lamp%' AND psi.image_url ILIKE '%rime-pendant%'`);

  await del('Dedicate Wall Lamp — dedicate-floor-lamp image',
    `p.name ILIKE '%dedicate wall lamp%' AND psi.image_url ILIKE '%dedicate-floor-lamp%'`);

  await del('Leaf Floor Lamp — leaf table lamp image',
    `p.name ILIKE '%leaf floor lamp%' AND psi.image_url ILIKE '%leaf%table%'`);

  await del('Coltre 2-Seater — 4/6/7-seater config images',
    `p.name ILIKE '%coltre%2-seater%' AND (
       psi.image_url ILIKE '%coltre-4-seater%'
       OR psi.image_url ILIKE '%coltre-6-seater%'
       OR psi.image_url ILIKE '%coltre-7-seater%'
     )`);

  const { rows: s } = await pool.query(`
    SELECT SUM(CASE WHEN c>=4 THEN 1 ELSE 0 END) good, SUM(CASE WHEN c<4 AND c>0 THEN 1 ELSE 0 END) partial,
      SUM(CASE WHEN c=0 THEN 1 ELSE 0 END) zero, COUNT(*) total
    FROM (SELECT p.id, COUNT(psi.id) c FROM products p JOIN brands b ON b.id=p.brand_id
          LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
          WHERE b.slug='muuto' GROUP BY p.id) sub`);
  console.log(`\nMuuto: ${s[0].total} total | ${s[0].good} good (≥4) | ${s[0].partial} partial | ${s[0].zero} zero`);
  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
