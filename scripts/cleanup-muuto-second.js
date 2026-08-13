/**
 * Muuto second-pass contamination cleanup.
 * Fixes contamination re-introduced by Cylindo re-scrape and other remaining issues.
 *
 * Issues fixed:
 *  1. Gaze Mirror — 3 lifestyle org%20-%20Copy images re-added by scrape
 *  2. Fine Wall/Ceiling Lamp — lifestyle image + fine-suspension image
 *  3. Oslo Lounge Chair Swivel/Tube Base — Oslo Bench image
 *  4. Ambit cross-contamination (wall lamp grey in rail/cluster; φ40 in rail; rail_black in cluster)
 *  5. Outline Highback Sofa 100/120 1-Seater — has 3-seater divina detail image
 *  6. In Situ 3/4-Seater + Corner — has 2-seater config-1 image
 *  7. Strand Pendant Lamp — has strand-table-lamp image
 *  8. Beam Table Lamp + Beam Portable Lamp — has beam-wall-lamp images
 *  9. Rest Sofa 3-Seater — has rest-corner-sofa image
 * 10. Corky Carafe — has corky glasses image
 * 11. Cluster Canopy + Rime Pendant Cluster — coltre-center lifestyle (re-added)
 * 12. Linear Mounted Lamp + Linear Table Lamp — has linear-pendant-lamp image
 * 13. Linear Pendant Lamp — has linear-mounted-lamp image (cross-type)
 * 14. Tip Floor/Wall Lamp cross-contamination
 */
require('dotenv').config();
const { pool } = require('../src/config/database');

const DRY_RUN = !process.argv.includes('--execute');

async function del(label, sql) {
  if (DRY_RUN) {
    const count = await pool.query(
      sql.replace(/^DELETE FROM product_siglip_images psi\s+USING products p, brands b\s+WHERE/,
                  'SELECT COUNT(*) AS n FROM product_siglip_images psi JOIN products p ON p.id = psi.product_id JOIN brands b ON b.id = p.brand_id WHERE')
    ).catch(async () => {
      // Fallback if regex substitution fails
      return { rows: [{ n: '?' }] };
    });
    console.log(`  [DRY] ${count.rows[0].n} rows — ${label}`);
  } else {
    const r = await pool.query(sql);
    console.log(`  ✓ Deleted ${r.rowCount} rows — ${label}`);
  }
}

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
  console.log(DRY_RUN ? '=== DRY RUN (pass --execute to delete) ===\n' : '=== EXECUTING MUUTO SECOND-PASS CLEANUP ===\n');

  let total = 0;

  // ── 1. Gaze Mirror — remaining lifestyle/org%20-%20Copy images (re-added by re-scrape) ──
  total += await runDelete(
    'Gaze Mirror — org%20-%20Copy lifestyle images',
    `p.name ILIKE '%gaze mirror%'
     AND psi.image_url ILIKE '%-org%20-%20Copy%'`
  );

  // ── 2. Fine Wall/Ceiling Lamp — lifestyle image + fine-suspension image ──
  total += await runDelete(
    'Fine Wall/Ceiling Lamp — lifestyle + fine-suspension-lamp images',
    `p.name ILIKE '%fine wall%'
     AND (
       psi.image_url ILIKE '%-org%20-%20Copy%'
       OR psi.image_url ILIKE '%fine-suspension-lamp%'
       OR psi.image_url ILIKE '%stacked-seat-cushion%'
     )`
  );

  // ── 3. Oslo Lounge Chair — Oslo Bench image ──
  total += await runDelete(
    'Oslo Lounge Chair — Oslo Bench image',
    `p.name ILIKE '%oslo lounge chair%'
     AND psi.image_url ILIKE '%oslo-bench%'`
  );

  // ── 4. Ambit cross-contamination ──
  // Ambit Wall Lamp grey image in Rail Lamp and Pendant Cluster (not Wall Lamp itself)
  total += await runDelete(
    'Ambit Rail Lamp + Pendant Cluster — wall-lamp-grey image',
    `(p.name ILIKE '%ambit rail lamp%' OR p.name ILIKE '%ambit pendant cluster%')
     AND psi.image_url ILIKE '%ambit-wall-lamp-grey%'`
  );

  // Ambit φ40 pendant image in Rail Lamp (correct for Pendant Cluster, wrong for Rail Lamp)
  total += await runDelete(
    'Ambit Rail Lamp — ambit-φ40 pendant image',
    `p.name ILIKE '%ambit rail lamp%'
     AND psi.image_url ILIKE '%ambit-%C3%B840%'`
  );

  // Ambit rail_black image in Pendant Cluster (correct for Rail Lamp, wrong for Pendant Cluster)
  total += await runDelete(
    'Ambit Pendant Cluster — rail_black image',
    `p.name ILIKE '%ambit pendant cluster%'
     AND psi.image_url ILIKE '%ambit_rail_black%'`
  );

  // ── 5. Outline Highback 1-Seater — has 3-seater detail image ──
  total += await runDelete(
    'Outline Highback Sofa 100/120 1-Seater — 3-seater divina detail image',
    `(
       p.name ILIKE '%outline highback sofa 100 1-seater%'
       OR p.name ILIKE '%outline highback sofa 120 1-seater%'
     )
     AND psi.image_url ILIKE '%outline-high-back-3-seater-divina%'`
  );

  // ── 6. In Situ — 2-seater image in 3/4-seater + corner configs ──
  total += await runDelete(
    'In Situ 3/4-Seater + Corner — 2-seater config-1 image',
    `(
       p.name ILIKE '%in situ modular sofa 3-seater%'
       OR p.name ILIKE '%in situ modular sofa 4-seater%'
       OR p.name ILIKE '%in situ modular sofa corner%'
     )
     AND psi.image_url ILIKE '%in-situ-sofa-2-seater-config-1%'`
  );

  // ── 7. Strand Pendant Lamp — strand-table-lamp image ──
  total += await runDelete(
    'Strand Pendant Lamp — strand-table-lamp image',
    `p.name ILIKE '%strand pendant lamp%'
     AND psi.image_url ILIKE '%strand-table-lamp%'`
  );

  // ── 8. Beam Table + Portable Lamp — beam-wall-lamp images ──
  total += await runDelete(
    'Beam Table + Portable Lamp — beam-wall-lamp images',
    `(p.name ILIKE '%beam table lamp%' OR p.name ILIKE '%beam portable lamp%')
     AND psi.image_url ILIKE '%beam-wall-lamp%'`
  );

  // ── 9. Rest Sofa 3-Seater — rest-corner-sofa image ──
  total += await runDelete(
    'Rest Sofa 3-Seater — rest-corner-sofa image',
    `p.name ILIKE '%rest sofa 3-seater%'
     AND psi.image_url ILIKE '%rest-corner-sofa%'`
  );

  // ── 10. Corky Carafe — glasses image ──
  total += await runDelete(
    'Corky Carafe — glasses image',
    `p.name ILIKE '%corky carafe%'
     AND psi.image_url ILIKE '%corky%glass%'`
  );

  // ── 11. Cluster Canopy + Rime Pendant Cluster — coltre-center lifestyle (re-added) ──
  total += await runDelete(
    'Cluster Canopy + Rime Pendant Cluster — coltre-center lifestyle',
    `(p.name ILIKE '%cluster canopy%' OR p.name ILIKE '%rime pendant cluster%')
     AND psi.image_url ILIKE '%coltre-center%'`
  );

  // ── 12. Linear Mounted Lamp + Linear Table Lamp — linear-pendant image ──
  total += await runDelete(
    'Linear Mounted + Table Lamp — linear-pendant-lamp image',
    `(p.name ILIKE '%linear mounted lamp%' OR p.name ILIKE '%linear table lamp%')
     AND psi.image_url ILIKE '%linear-pendant-lamp%'`
  );

  // ── 13. Linear Pendant Lamp — linear-mounted-lamp image (cross-type) ──
  total += await runDelete(
    'Linear Pendant Lamp — linear-mounted-lamp image',
    `p.name ILIKE '%linear pendant lamp%'
     AND psi.image_url ILIKE '%linear-mounted-lamp%'`
  );

  // ── 14. Tip Floor Lamp — wall lamp image (and table lamp in wall lamp) ──
  total += await runDelete(
    'Tip Floor Lamp — tip-wall-lamp image',
    `p.name ILIKE '%tip floor lamp%'
     AND psi.image_url ILIKE '%tip-wall-lamp%'`
  );

  total += await runDelete(
    'Tip Wall Lamp — tip-floor-lamp image',
    `p.name ILIKE '%tip wall lamp%'
     AND psi.image_url ILIKE '%tip-floor-lamp%'`
  );

  // ── 15. Oslo Sofa cross-seater (Oslo Sofa 1-Seater image in 3-Seater) ──
  // Oslo_steelcut_closeup shared across all 3 sizes is ok (same fabric detail)
  // But keep these — they're arguably acceptable cross-size shots

  // ── Final coverage snapshot ──────────────────────────────────────────────
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
  console.log(`\n${DRY_RUN ? 'Would delete' : 'Deleted'} ~${total} rows total`);
  console.log(`\nMuuto coverage after cleanup:`);
  console.log(`  Total: ${s.total} | Good (≥4): ${s.good} (${Math.round(s.good/s.total*100)}%) | Partial: ${s.partial} | Zero: ${s.zero}`);

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
