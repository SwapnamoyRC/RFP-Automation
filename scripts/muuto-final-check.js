/**
 * Quick Muuto final state check — coverage + remaining actual contaminations
 */
require('dotenv').config();
const { pool } = require('../src/config/database');

async function main() {
  // Coverage
  const { rows: stats } = await pool.query(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN img_count = 0 THEN 1 ELSE 0 END) AS zero,
      SUM(CASE WHEN img_count BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS partial,
      SUM(CASE WHEN img_count >= 4 THEN 1 ELSE 0 END) AS good,
      MIN(img_count) AS min_imgs, MAX(img_count) AS max_imgs,
      ROUND(AVG(img_count), 1) AS avg_imgs
    FROM (
      SELECT p.id, COUNT(psi.id) AS img_count
      FROM products p JOIN brands b ON b.id = p.brand_id
      LEFT JOIN product_siglip_images psi ON psi.product_id = p.id
      WHERE b.slug = 'muuto'
      GROUP BY p.id
    ) sub
  `);
  const s = stats[0];
  console.log('=== Muuto Final State ===\n');
  console.log(`Coverage: ${s.total} products | ${s.good} good ≥4 (${Math.round(s.good/s.total*100)}%) | ${s.partial} partial | ${s.zero} zero`);
  console.log(`Min/Avg/Max images: ${s.min_imgs} / ${s.avg_imgs} / ${s.max_imgs}`);

  // Remaining TRUE cross-product contaminations (different product types sharing images)
  // These are the ones that are actually harmful, not just DB duplicate name pairs
  const checks = [
    ['Dots Ceramic has Dots Metal image (or vice versa)',
     `p.name ILIKE '%dots ceramic%' AND psi.image_url ILIKE '%dots-metal%'`],
    ['Dots Metal has Dots Ceramic image',
     `p.name ILIKE '%dots metal%' AND psi.image_url ILIKE '%dots-ceramic%'`],
    ['Rime Pendant Cluster has Wall Lamp image',
     `p.name ILIKE '%rime pendant cluster%' AND psi.image_url ILIKE '%rime-wall-lamp%'`],
    ['Rime Wall Lamp has Pendant image',
     `p.name ILIKE '%rime wall lamp%' AND psi.image_url ILIKE '%rime-pendant%'`],
    ['Rime Chandelier/Cluster cross-sharing',
     `p.name ILIKE '%rime chandelier%' AND psi.image_url ILIKE '%rime-pendant%'`],
    ['Dedicate Wall Lamp has floor lamp angle image',
     `p.name ILIKE '%dedicate wall lamp%' AND psi.image_url ILIKE '%dedicate-floor-lamp%'`],
    ['Leaf Floor Lamp has table lamp image',
     `p.name ILIKE '%leaf floor lamp%' AND psi.image_url ILIKE '%leaf%table%'`],
    ['Leaf Table Lamp has floor lamp image',
     `p.name ILIKE '%leaf table lamp%' AND psi.image_url ILIKE '%leaf%floor%'`],
    ['Linear Pendant Lamp has mounted lamp image',
     `p.name ILIKE '%linear pendant lamp%' AND psi.image_url ILIKE '%linear-mounted-lamp%'`],
    ['Linear Mounted Lamp has pendant image',
     `p.name ILIKE '%linear mounted lamp%' AND psi.image_url ILIKE '%linear-pendant-lamp%'`],
    ['Coltre 2-Seater has 4/6/7-seater config images',
     `p.name ILIKE '%coltre%2-seater%' AND (psi.image_url ILIKE '%coltre-4-seater%' OR psi.image_url ILIKE '%coltre-6-seater%' OR psi.image_url ILIKE '%coltre-7-seater%')`],
    ['org - Copy lifestyle images still in DB',
     `psi.image_url ILIKE '%org - copy%' OR psi.image_url ILIKE '%org%20-%20copy%'`],
    ['cas.png tracker pixel still in DB',
     `psi.image_url LIKE '%cas.png'`],
  ];

  console.log('\nRemaining contamination checks:');
  let anyFound = false;
  for (const [label, condition] of checks) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS n FROM product_siglip_images psi
       JOIN products p ON p.id = psi.product_id
       JOIN brands b ON b.id = p.brand_id
       WHERE b.slug = 'muuto' AND (${condition})`
    );
    const n = parseInt(rows[0].n);
    if (n > 0) {
      console.log(`  ✗ [${n}] ${label}`);
      anyFound = true;
    }
  }
  if (!anyFound) console.log('  ✓ No significant contamination found!');

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
