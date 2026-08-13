/**
 * Muuto third-pass cleanup — fixes re-introduced contaminations from second re-scrape.
 * Issues: lifestyle filter missed "org - Copy" (decoded spaces) pattern.
 */
require('dotenv').config();
const { pool } = require('../src/config/database');

const DRY_RUN = !process.argv.includes('--execute');

async function runDelete(label, condition) {
  const sql = `
    DELETE FROM product_siglip_images psi
    USING products p, brands b
    WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
      AND ${condition}
  `;
  if (DRY_RUN) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS n FROM product_siglip_images psi
       JOIN products p ON p.id = psi.product_id
       JOIN brands b ON b.id = p.brand_id
       WHERE b.slug = 'muuto' AND (${condition})`
    );
    console.log(`  [DRY] ${rows[0].n} rows — ${label}`);
    return 0;
  } else {
    const r = await pool.query(sql);
    console.log(`  ✓ Deleted ${r.rowCount} rows — ${label}`);
    return r.rowCount;
  }
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===\n' : '=== EXECUTING MUUTO THIRD-PASS CLEANUP ===\n');

  let total = 0;

  // 1. All remaining org-copy lifestyle images (decoded spaces pattern: "org - copy" or "org%20")
  total += await runDelete(
    'All org-copy lifestyle images (decoded "org - copy" / encoded "org%20")',
    `(
       psi.image_url ILIKE '%org%20-%20Copy%'
       OR psi.image_url ILIKE '%org - Copy%'
       OR psi.image_url ILIKE '%org%20%25%25%20Copy%'
     )`
  );

  // 2. Linear System furniture images in Linear Table Lamp / Mounted Lamp / Pendant Lamp
  total += await runDelete(
    'Linear System furniture images in Linear Lamp products',
    `(
       p.name ILIKE '%linear table lamp%'
       OR p.name ILIKE '%linear mounted lamp%'
       OR p.name ILIKE '%linear pendant lamp%'
     )
     AND psi.image_url ILIKE '%linear-system%'`
  );

  // Coverage after
  const { rows: stats } = await pool.query(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN img_count = 0 THEN 1 ELSE 0 END) AS zero,
      SUM(CASE WHEN img_count BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS partial,
      SUM(CASE WHEN img_count >= 4 THEN 1 ELSE 0 END) AS good
    FROM (
      SELECT p.id, COUNT(psi.id) AS img_count
      FROM products p JOIN brands b ON b.id=p.brand_id
      LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
      WHERE b.slug='muuto' GROUP BY p.id
    ) sub
  `);
  const s = stats[0];
  console.log(`\nDeleted ${total} rows total`);
  console.log(`Muuto coverage: ${s.total} total | ${s.good} good (≥4) | ${s.partial} partial | ${s.zero} zero`);

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
