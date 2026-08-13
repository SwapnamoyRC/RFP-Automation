/**
 * Muuto contamination cleanup.
 *
 * Removes:
 * 1. cas.png  — tracking pixel / UI element in 67 products
 * 2. Oslo Bar Stool images from Oslo Lounge Chair and Oslo Sofa products
 * 3. Linear System Screen/Table images from Linear Pendant/Table Lamp products
 * 4. Lifestyle shots: -org%20-%20Copy, Stregtegninger, low-res, lifestyle-image, showroom
 * 5. 70/70 Table lifestyle/roll-up image
 * 6. Workshop cross-contamination (Coffee Table image in Chair, Bench image in Chair)
 * 7. Beam cross-contamination (Beam Wall Lamp in Workshop Bench; Beam Table Lamp in Gaze Mirror)
 * 8. Coltre/Rime/Verso lifestyle shot shared across 3 wrong products
 * 9. Base High Table/Sketch Toolbox lifestyle
 * 10. Calm Wall Lamp / Outline Daybed lifestyle (wrong for Outline Daybed)
 * 11. Oslo showroom shots in Fiber Soft Armchair products
 */
require('dotenv').config();
const { pool } = require('../src/config/database');

const DRY_RUN = !process.argv.includes('--execute');

async function del(label, sql, params = []) {
  if (DRY_RUN) {
    const { rows } = await pool.query(sql.replace('DELETE FROM', 'SELECT COUNT(*) AS n FROM').replace(/USING.*$/s, '').replace(/WHERE.*$/s, '') + ' ' + sql.replace(/^.*?WHERE/s, 'WHERE'), params);
    // simpler: just do a count
    const count = await pool.query(
      `SELECT COUNT(*) AS n FROM product_siglip_images psi
       JOIN products p ON p.id = psi.product_id
       JOIN brands b ON b.id = p.brand_id
       WHERE b.slug = 'muuto' AND (${label})`,
      params
    ).catch(() => ({ rows: [{ n: '?' }] }));
    console.log(`  [DRY] ${label.slice(0, 80)} → ~${count.rows[0].n} rows`);
  } else {
    const r = await pool.query(sql, params);
    console.log(`  ✓ Deleted ${r.rowCount} rows: ${label.slice(0, 70)}`);
  }
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN (pass --execute to delete) ===\n' : '=== EXECUTING MUUTO CLEANUP ===\n');

  if (!DRY_RUN) {
    // ── 1. cas.png (tracking pixel) ──────────────────────────────────────────
    const r1 = await pool.query(`
      DELETE FROM product_siglip_images psi
      USING products p, brands b
      WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
        AND psi.image_url LIKE '%cas.png'
    `);
    console.log(`✓ [1] cas.png tracker pixel: deleted ${r1.rowCount} rows`);

    // ── 2. Lifestyle: -org%20-%20Copy, Stregtegninger, low-res, lifestyle-image, showroom ──
    const r2 = await pool.query(`
      DELETE FROM product_siglip_images psi
      USING products p, brands b
      WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
        AND (
          psi.image_url LIKE '%-org%25-%25Copy%'
          OR psi.image_url LIKE '%Stregtegninger%'
          OR psi.image_url ILIKE '%-low-res.%'
          OR psi.image_url ILIKE '%lifestyle-image%'
          OR psi.image_url ILIKE '%showroom-2023%'
          OR psi.image_url ILIKE '%-org%20-%20Copy%'
        )
    `);
    console.log(`✓ [2] Lifestyle/bad types: deleted ${r2.rowCount} rows`);

    // ── 3. Oslo Bar Stool images in Oslo Lounge Chair + Oslo Sofa products ──
    const r3 = await pool.query(`
      DELETE FROM product_siglip_images psi
      USING products p, brands b
      WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
        AND (p.name ILIKE '%oslo lounge chair%' OR p.name ILIKE '%oslo sofa%')
        AND psi.image_url ILIKE '%oslo-bar-stool%'
    `);
    console.log(`✓ [3] Oslo Bar Stool in Lounge Chair/Sofa: deleted ${r3.rowCount} rows`);

    // ── 4. Linear System Screen/High-Table/Cable-Tray in Linear Lamp products ──
    const r4 = await pool.query(`
      DELETE FROM product_siglip_images psi
      USING products p, brands b
      WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
        AND (p.name ILIKE '%linear pendant lamp%' OR p.name ILIKE '%linear table lamp%' OR p.name ILIKE '%linear mounted lamp%')
        AND (
          psi.image_url ILIKE '%linear-system-screen%'
          OR psi.image_url ILIKE '%linear-system-high-table%'
          OR psi.image_url ILIKE '%linear-system-table-oak%'
          OR psi.image_url ILIKE '%linear-system-cable-tray%'
          OR psi.image_url ILIKE '%linear-system-power%'
          OR psi.image_url ILIKE '%linear-system-connecting-legs%'
        )
    `);
    console.log(`✓ [4] Linear System images in Linear Lamp products: deleted ${r4.rowCount} rows`);

    // ── 5. Workshop cross-contamination ──────────────────────────────────────
    // Workshop Chair has Workshop Coffee Table and Bench images
    const r5 = await pool.query(`
      DELETE FROM product_siglip_images psi
      USING products p, brands b
      WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
        AND p.name ILIKE '%workshop chair%'
        AND (
          psi.image_url ILIKE '%workshop-coffee-table%'
          OR psi.image_url ILIKE '%workshop-table-200%'
          OR psi.image_url ILIKE '%workshop-bench%'
        )
    `);
    console.log(`✓ [5] Workshop Chair cross-contamination: deleted ${r5.rowCount} rows`);

    // ── 6. Beam cross-contamination ──────────────────────────────────────────
    // Beam Wall Lamp image in Workshop Bench
    const r6a = await pool.query(`
      DELETE FROM product_siglip_images psi
      USING products p, brands b
      WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
        AND p.name ILIKE '%workshop bench%'
        AND psi.image_url ILIKE '%beam-wall-lamp%'
    `);
    // Beam Table Lamp images in Gaze Mirror
    const r6b = await pool.query(`
      DELETE FROM product_siglip_images psi
      USING products p, brands b
      WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
        AND p.name ILIKE '%gaze mirror%'
        AND (
          psi.image_url ILIKE '%beam-table-lamp%'
          OR psi.image_url ILIKE '%rest-sofa%'
          OR psi.image_url ILIKE '%outline-sofa%'
        )
    `);
    console.log(`✓ [6] Beam/Gaze cross-contamination: deleted ${r6a.rowCount + r6b.rowCount} rows`);

    // ── 7. Coltre/Rime/Verso lifestyle (wrong for Cluster Canopy + Rime + Verso Rug) ──
    const r7 = await pool.query(`
      DELETE FROM product_siglip_images psi
      USING products p, brands b
      WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
        AND (p.name ILIKE '%cluster canopy%' OR p.name ILIKE '%verso rug%')
        AND psi.image_url ILIKE '%coltre-center%'
    `);
    console.log(`✓ [7] Coltre lifestyle in Cluster/Verso: deleted ${r7.rowCount} rows`);

    // ── 8. Base High Table lifestyle in Sketch Toolbox ────────────────────────
    const r8 = await pool.query(`
      DELETE FROM product_siglip_images psi
      USING products p, brands b
      WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
        AND p.name ILIKE '%sketch toolbox%'
        AND psi.image_url ILIKE '%base-high%'
    `);
    console.log(`✓ [8] Base High Table lifestyle in Sketch Toolbox: deleted ${r8.rowCount} rows`);

    // ── 9. Calm Wall Lamp lifestyle in Outline Daybed ─────────────────────────
    // The filename says "calm-wall-lamp-90-black-outline-daybed" — it's a lifestyle shot.
    // The Calm Wall Lamp image is correct for Calm Wall Lamp, wrong for Outline Daybed.
    const r9 = await pool.query(`
      DELETE FROM product_siglip_images psi
      USING products p, brands b
      WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
        AND p.name ILIKE '%outline daybed%'
        AND psi.image_url ILIKE '%calm-wall-lamp%'
    `);
    console.log(`✓ [9] Calm Wall Lamp in Outline Daybed: deleted ${r9.rowCount} rows`);

    // ── 10. Rime images in wrong products ─────────────────────────────────────
    // Rime Chandelier and Rime Wall Lamp appear in Rime Pendant Cluster — keep those
    // (same family). But Rime Pendant images appear in Cluster Canopy already handled above.

    // ── 11. Oslo showroom in Fiber Soft Armchair ──────────────────────────────
    const r11 = await pool.query(`
      DELETE FROM product_siglip_images psi
      USING products p, brands b
      WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
        AND p.name ILIKE '%fiber soft armchair%'
        AND psi.image_url ILIKE '%oslo-showroom%'
    `);
    console.log(`✓ [11] Oslo showroom in Fiber Soft Armchair: deleted ${r11.rowCount} rows`);

    // ── 12. Linear System connecting legs in "Modern lines" editorial page ────
    const r12 = await pool.query(`
      DELETE FROM product_siglip_images psi
      USING products p, brands b
      WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
        AND p.name IN ('Modern lines', 'Warm materiality', 'A modern light')
    `);
    console.log(`✓ [12] Editorial/concept page embeddings: deleted ${r12.rowCount} rows`);

    // ── 13. Ambit pendant images in Rail Lamp and Wall Lamp (keep only their own) ──
    // The Ambit Pendant Cluster image appearing in Ambit Rail Lamp and Wall Lamp
    // is from the page fallback showing all Ambit products. Keep Ambit-specific, remove pendant cluster.
    const r13 = await pool.query(`
      DELETE FROM product_siglip_images psi
      USING products p, brands b
      WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
        AND (p.name ILIKE '%ambit rail lamp%' OR p.name ILIKE '%ambit wall lamp%')
        AND (
          psi.image_url ILIKE '%ambit-%C3%B840%'
          OR psi.image_url ILIKE '%Ambit_rail_black%'
        )
    `);
    console.log(`✓ [13] Ambit Pendant in Rail/Wall Lamp: deleted ${r13.rowCount} rows`);

    // ── 14. Fine Suspension Lamp image in Fine Wall/Ceiling Lamp ─────────────
    const r14 = await pool.query(`
      DELETE FROM product_siglip_images psi
      USING products p, brands b
      WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
        AND p.name ILIKE '%fine wall%'
        AND psi.image_url ILIKE '%fine-suspension-lamp%'
    `);
    console.log(`✓ [14] Fine Suspension in Fine Wall/Ceiling: deleted ${r14.rowCount} rows`);

    // ── 15. Dedicate cross (Table lamp in Floor/Wall) ─────────────────────────
    const r15 = await pool.query(`
      DELETE FROM product_siglip_images psi
      USING products p, brands b
      WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
        AND (p.name ILIKE '%dedicate floor lamp%' OR p.name ILIKE '%dedicate wall lamp%')
        AND psi.image_url ILIKE '%dedicate-table-lamp%'
    `);
    console.log(`✓ [15] Dedicate Table Lamp in Floor/Wall Lamp: deleted ${r15.rowCount} rows`);

    // ── 16. Linear System cross into Cable Tray / Screen ─────────────────────
    // Linear System Power Config, Screen, Tray sharing a generic table image
    const r16 = await pool.query(`
      DELETE FROM product_siglip_images psi
      USING products p, brands b
      WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
        AND (
          p.name ILIKE '%linear system tray%'
          OR p.name ILIKE '%linear system screen%'
          OR p.name ILIKE '%linear system power%'
          OR p.name ILIKE '%linear system cable tray%'
        )
        AND (
          psi.image_url ILIKE '%linear-pendant-lamp%'
          OR psi.image_url ILIKE '%linear-table-lamp%'
          OR psi.image_url ILIKE '%linear-mounted-lamp%'
        )
    `);
    console.log(`✓ [16] Linear Lamp images in Linear System accessories: deleted ${r16.rowCount} rows`);

  } else {
    // DRY RUN — show counts for main issues
    const checks = [
      ['cas.png tracker', "psi.image_url LIKE '%cas.png'"],
      ['lifestyle -org%20-%20Copy / Stregtegninger / low-res / lifestyle-image / showroom',
        "psi.image_url LIKE '%-org%25-%25Copy%' OR psi.image_url LIKE '%Stregtegninger%' OR psi.image_url ILIKE '%-low-res.%' OR psi.image_url ILIKE '%lifestyle-image%' OR psi.image_url ILIKE '%showroom-2023%' OR psi.image_url ILIKE '%-org%20-%20Copy%'"],
      ['Oslo Bar Stool in Lounge Chair/Sofa',
        "(p.name ILIKE '%oslo lounge chair%' OR p.name ILIKE '%oslo sofa%') AND psi.image_url ILIKE '%oslo-bar-stool%'"],
      ['Linear System in Linear Lamp products',
        "(p.name ILIKE '%linear pendant lamp%' OR p.name ILIKE '%linear table lamp%' OR p.name ILIKE '%linear mounted lamp%') AND (psi.image_url ILIKE '%linear-system-screen%' OR psi.image_url ILIKE '%linear-system-high-table%' OR psi.image_url ILIKE '%linear-system-table-oak%' OR psi.image_url ILIKE '%linear-system-cable-tray%' OR psi.image_url ILIKE '%linear-system-power%' OR psi.image_url ILIKE '%linear-system-connecting-legs%')"],
      ['Workshop Chair cross-contamination', "p.name ILIKE '%workshop chair%' AND (psi.image_url ILIKE '%workshop-coffee-table%' OR psi.image_url ILIKE '%workshop-table-200%' OR psi.image_url ILIKE '%workshop-bench%')"],
    ];
    for (const [label, condition] of checks) {
      const { rows } = await pool.query(
        `SELECT COUNT(*) AS n FROM product_siglip_images psi
         JOIN products p ON p.id = psi.product_id
         JOIN brands b ON b.id = p.brand_id
         WHERE b.slug = 'muuto' AND (${condition})`
      );
      console.log(`  [${rows[0].n}] ${label}`);
    }
  }

  // ── Final status ──────────────────────────────────────────────────────────
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
  console.log(`\nMuuto coverage: ${s.total} total | ${s.good} good (≥4) | ${s.partial} partial | ${s.zero} zero`);

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
