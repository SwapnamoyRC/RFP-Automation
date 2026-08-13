/**
 * Fix remaining HAY contamination found by audit:
 * 1. terrazza-parasol image still in 6 Terrazza sibling products (exclusion was too broad)
 * 2. AAL 82 / AAL 82 Soft cross-contamination (same pattern as AAL 87 / AAL 87 Soft)
 * 3. Check for similar AAL-family cross-contamination
 */
require('dotenv').config();
const { pool } = require('../src/config/database');

const DRY_RUN = !process.argv.includes('--execute');

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== EXECUTING ===\n');

  // ── 1. Terrazza sub-products ──────────────────────────────────────────────
  // The previous cleanup excluded ALL products with 'terrazza' in the name.
  // Should only keep terrazza-parasol image for THE 'Terrazza Parasol' product.
  const { rows: terrazzaCheck } = await pool.query(`
    SELECT p.name, psi.image_url
    FROM product_siglip_images psi
    JOIN products p ON p.id = psi.product_id
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'hay'
      AND psi.image_url LIKE '%terrazza-parasol_910x1100_brandmodel%'
      AND p.name != 'Terrazza Parasol'
    ORDER BY p.name
  `);
  console.log(`Terrazza sub-products with wrong terrazza-parasol image: ${terrazzaCheck.length}`);
  terrazzaCheck.forEach(r => console.log(`  - ${r.name}`));

  if (!DRY_RUN && terrazzaCheck.length > 0) {
    const { rowCount } = await pool.query(`
      DELETE FROM product_siglip_images psi
      USING products p, brands b
      WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'hay'
        AND psi.image_url LIKE '%terrazza-parasol_910x1100_brandmodel%'
        AND p.name != 'Terrazza Parasol'
    `);
    console.log(`  ✓ Deleted ${rowCount} rows\n`);
  }

  // ── 2. Check ALL AAL soft/non-soft pairs ─────────────────────────────────
  // Pattern: AAL 82 has AAL 82 Soft's images embedded and vice versa
  // Check all AAL variants for this pattern
  console.log('\nAAL family cross-contamination check:');
  const { rows: aalContam } = await pool.query(`
    SELECT
      p.name AS product,
      split_part(psi.image_url, '?', 1) AS image_url
    FROM product_siglip_images psi
    JOIN products p ON p.id = psi.product_id
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'hay'
      AND p.name ~ '^AAL \\d'
      AND (
        -- AAL 82 having aal-82-soft images
        (p.name = 'AAL 82' AND psi.image_url LIKE '%aal-82-soft%')
        -- AAL 82 Soft having aal-82_ images (not aal-82-soft)
        OR (p.name = 'AAL 82 Soft' AND psi.image_url LIKE '%aal-82%' AND psi.image_url NOT LIKE '%aal-82-soft%')
        -- AAL 81 having aal-81-soft images
        OR (p.name = 'AAL 81' AND psi.image_url LIKE '%aal-81-soft%')
        -- AAL 81 Soft having aal-81_ images
        OR (p.name = 'AAL 81 Soft' AND psi.image_url LIKE '%aal-81[_-]%' AND psi.image_url NOT LIKE '%aal-81-soft%')
        -- AAL 83 having aal-83-soft images
        OR (p.name = 'AAL 83' AND psi.image_url LIKE '%aal-83-soft%')
        -- AAL 83 Soft having aal-83_ images
        OR (p.name = 'AAL 83 Soft' AND psi.image_url LIKE '%aal-83[_-]%' AND psi.image_url NOT LIKE '%aal-83-soft%')
        -- AAL 91 having aal-91-soft images
        OR (p.name = 'AAL 91' AND psi.image_url LIKE '%aal-91-soft%')
        -- AAL 91 Soft having aal-91_ images
        OR (p.name = 'AAL 91 Soft' AND psi.image_url LIKE '%aal-91[_-]%' AND psi.image_url NOT LIKE '%aal-91-soft%')
        -- AAL 93 having aal-93-soft images
        OR (p.name = 'AAL 93' AND psi.image_url LIKE '%aal-93-soft%')
        -- AAL 93 Soft having aal-93_ images
        OR (p.name = 'AAL 93 Soft' AND psi.image_url LIKE '%aal-93[_-]%' AND psi.image_url NOT LIKE '%aal-93-soft%')
      )
    ORDER BY p.name, psi.image_url
  `);

  if (aalContam.length === 0) {
    console.log('  ✓ No AAL cross-contamination found\n');
  } else {
    console.log(`  Found ${aalContam.length} cross-contaminated AAL images:`);
    aalContam.forEach(r => {
      const fn = r.image_url.split('/').pop();
      console.log(`    [${r.product}] ${fn}`);
    });

    if (!DRY_RUN) {
      const { rowCount } = await pool.query(`
        DELETE FROM product_siglip_images psi
        USING products p, brands b
        WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'hay'
          AND p.name ~ '^AAL \\d'
          AND (
            (p.name = 'AAL 82' AND psi.image_url LIKE '%aal-82-soft%')
            OR (p.name = 'AAL 82 Soft' AND psi.image_url LIKE '%aal-82%' AND psi.image_url NOT LIKE '%aal-82-soft%')
            OR (p.name = 'AAL 81' AND psi.image_url LIKE '%aal-81-soft%')
            OR (p.name = 'AAL 81 Soft' AND psi.image_url LIKE '%aal-81[_-]%' AND psi.image_url NOT LIKE '%aal-81-soft%')
            OR (p.name = 'AAL 83' AND psi.image_url LIKE '%aal-83-soft%')
            OR (p.name = 'AAL 83 Soft' AND psi.image_url LIKE '%aal-83[_-]%' AND psi.image_url NOT LIKE '%aal-83-soft%')
            OR (p.name = 'AAL 91' AND psi.image_url LIKE '%aal-91-soft%')
            OR (p.name = 'AAL 91 Soft' AND psi.image_url LIKE '%aal-91[_-]%' AND psi.image_url NOT LIKE '%aal-91-soft%')
            OR (p.name = 'AAL 93' AND psi.image_url LIKE '%aal-93-soft%')
            OR (p.name = 'AAL 93 Soft' AND psi.image_url LIKE '%aal-93[_-]%' AND psi.image_url NOT LIKE '%aal-93-soft%')
          )
      `);
      console.log(`  ✓ Deleted ${rowCount} rows\n`);
    }
  }

  // ── 3. Elementaire / Élémentaire ─────────────────────────────────────────
  // Check if these are true duplicates (same product, different DB entries) or distinct products
  const { rows: elemCheck } = await pool.query(`
    SELECT p.name, p.source_url, COUNT(psi.id) as imgs
    FROM products p
    JOIN brands b ON b.id=p.brand_id
    LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
    WHERE b.slug='hay' AND p.name ILIKE '%l%mentaire%chair%'
    GROUP BY p.id, p.name, p.source_url
    ORDER BY p.name
  `);
  console.log('\nElementaire Chair check (accent encoding issue?):');
  elemCheck.forEach(r => console.log(`  [${r.imgs} imgs] ${r.name} → ${r.source_url}`));

  // ── 4. Post-cleanup status of affected products ───────────────────────────
  console.log('\nPost-cleanup image counts for key products:');
  const { rows: keyProds } = await pool.query(`
    SELECT p.name, COUNT(psi.id) as imgs
    FROM products p JOIN brands b ON b.id=p.brand_id
    LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
    WHERE b.slug='hay'
      AND p.name IN (
        'Terrazza Parasol','Terrazza Cushion','Terrazza Folding Seat Cushion',
        'Terrazza Parasol Base','Terrazza Parasol Cover','Terrazza Seat Cushion','Terrazza Tablecloth',
        'AAL 82','AAL 82 Soft','AAL 81','AAL 81 Soft',
        'AAL 87','AAL 87 Soft'
      )
    GROUP BY p.id, p.name ORDER BY p.name
  `);
  keyProds.forEach(r => console.log(`  [${r.imgs}] ${r.name}`));

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
