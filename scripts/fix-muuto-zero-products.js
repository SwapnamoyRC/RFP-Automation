/**
 * Fix Muuto zero-image products:
 * 1. Delete 3 editorial DB artifacts (wrong names scraped from concept sections)
 * 2. Delete Fiber Soft Armchair (generic) + Fiber Soft Armchair Swivel Base W. Return
 * 3. Delete Visu Bar Stool Wood Base 75 Cm 29.5 (dimension-suffixed duplicate)
 * 4. Update Raise Glasses Set of 2 source_url + embed 2 user-provided images
 * 5. Update Settle Outdoor Lounge Chair w. Armrest source_url + embed 3 user-provided images
 * 6. Update Visu Bar Stool source_url + embed 3 user-provided images
 */
require('dotenv').config();
const https = require('https');
const http = require('http');
const { pool } = require('../src/config/database');
const siglipService = require('../src/services/siglip-embedding.service');

const DRY_RUN = !process.argv.includes('--execute');

function downloadImage(url) {
  // Strip query params for the actual download (keep full URL for storage)
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, {
      timeout: 30000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.muuto.com/' },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadImage(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
  });
}

async function embedImage(productId, imageUrl, label) {
  // Store URL without query params
  const baseUrl = imageUrl.split('?')[0];

  // Check if already embedded
  const { rows: existing } = await pool.query(
    `SELECT id FROM product_siglip_images WHERE product_id = $1 AND split_part(image_url, '?', 1) = $2`,
    [productId, baseUrl]
  );
  if (existing.length > 0) {
    console.log(`    [skip] ${label} — already embedded`);
    return false;
  }

  const buf = await downloadImage(imageUrl);
  const embedding = await siglipService.getImageEmbeddingFromBuffer(buf);

  await pool.query(
    `INSERT INTO product_siglip_images (product_id, image_url, embedding)
     VALUES ($1, $2, $3)
     ON CONFLICT (product_id, image_url) DO NOTHING`,
    [productId, baseUrl, JSON.stringify(embedding)]
  );
  console.log(`    ✓ Embedded: ${label}`);
  return true;
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN (pass --execute to apply) ===\n' : '=== EXECUTING MUUTO PRODUCT FIXES ===\n');

  // ── 1. Delete 3 editorial DB artifacts ──────────────────────────────────
  console.log('1. Deleting editorial DB artifacts...');
  const artifacts = ['A modern light', 'Modern lines', 'Warm materiality'];
  for (const name of artifacts) {
    const { rows } = await pool.query(
      `SELECT p.id FROM products p JOIN brands b ON b.id = p.brand_id WHERE b.slug = 'muuto' AND p.name = $1`,
      [name]
    );
    if (rows.length === 0) { console.log(`   [skip] "${name}" — not found`); continue; }
    if (DRY_RUN) {
      console.log(`   [DRY] Would delete product: "${name}" (id=${rows[0].id})`);
    } else {
      await pool.query('DELETE FROM product_siglip_images WHERE product_id = $1', [rows[0].id]);
      await pool.query('DELETE FROM products WHERE id = $1', [rows[0].id]);
      console.log(`   ✓ Deleted: "${name}"`);
    }
  }

  // ── 2. Delete Fiber Soft Armchair (generic) ──────────────────────────────
  console.log('\n2. Deleting Fiber Soft Armchair duplicates...');
  const fiberToDelete = ['Fiber Soft Armchair', 'Fiber Soft Armchair Swivel Base W. Return'];
  for (const name of fiberToDelete) {
    const { rows } = await pool.query(
      `SELECT p.id FROM products p JOIN brands b ON b.id = p.brand_id WHERE b.slug = 'muuto' AND p.name = $1`,
      [name]
    );
    if (rows.length === 0) { console.log(`   [skip] "${name}" — not found`); continue; }
    if (DRY_RUN) {
      console.log(`   [DRY] Would delete: "${name}" (id=${rows[0].id})`);
    } else {
      await pool.query('DELETE FROM product_siglip_images WHERE product_id = $1', [rows[0].id]);
      await pool.query('DELETE FROM products WHERE id = $1', [rows[0].id]);
      console.log(`   ✓ Deleted: "${name}"`);
    }
  }

  // ── 3. Delete Visu Bar Stool Wood Base 75 Cm 29.5 (dimension-suffix duplicate) ──
  console.log('\n3. Deleting Visu Bar Stool duplicate...');
  const { rows: visuDup } = await pool.query(
    `SELECT p.id FROM products p JOIN brands b ON b.id = p.brand_id WHERE b.slug = 'muuto' AND p.name = 'Visu Bar Stool Wood Base   75 Cm 29.5'`
  );
  if (visuDup.length === 0) {
    console.log('   [skip] "Visu Bar Stool Wood Base 75 Cm 29.5" — not found');
  } else if (DRY_RUN) {
    console.log(`   [DRY] Would delete "Visu Bar Stool Wood Base 75 Cm 29.5" (id=${visuDup[0].id})`);
  } else {
    await pool.query('DELETE FROM product_siglip_images WHERE product_id = $1', [visuDup[0].id]);
    await pool.query('DELETE FROM products WHERE id = $1', [visuDup[0].id]);
    console.log('   ✓ Deleted "Visu Bar Stool Wood Base 75 Cm 29.5"');
  }

  if (DRY_RUN) {
    console.log('\n[DRY] Skipping URL updates and image downloads — pass --execute to apply.\n');
    await pool.end();
    return;
  }

  // ── 4. Raise Glasses Set of 2 ────────────────────────────────────────────
  console.log('\n4. Fixing "Raise Glasses Set of 2"...');
  const { rows: raiseRows } = await pool.query(
    `SELECT p.id FROM products p JOIN brands b ON b.id = p.brand_id WHERE b.slug = 'muuto' AND p.name = 'Raise Glasses Set of 2'`
  );
  if (raiseRows.length === 0) { console.log('   [skip] not found in DB'); }
  else {
    const raiseId = raiseRows[0].id;
    await pool.query(`UPDATE products SET source_url = $1 WHERE id = $2`,
      ['https://www.muuto.com/product/Raise-Glasses--RAIGLS20S2/RAIGLS20S201/', raiseId]);
    console.log('   ✓ Updated source_url');
    const raiseImages = [
      'https://cdn.occtoo-media.com/4d81f22f-2795-41f2-b8bf-15e9abf03890/6a5b605d-1037-5c1e-b307-97f3a77e4594/Raise-concept-burnt-orange-5-muuto-org.webp',
      'https://cdn.occtoo-media.com/4d81f22f-2795-41f2-b8bf-15e9abf03890/ac21b90b-b283-5957-96a3-91869580af2a/Raise-concept-dark-blue-muuto-org.webp',
    ];
    for (const url of raiseImages) {
      try { await embedImage(raiseId, url, url.split('/').pop()); }
      catch (e) { console.log(`    ✗ Failed: ${e.message}`); }
    }
  }

  // ── 5. Settle Outdoor Lounge Chair w. Armrest ────────────────────────────
  console.log('\n5. Fixing "Settle Outdoor Lounge Chair w. Armrest"...');
  const { rows: settleRows } = await pool.query(
    `SELECT p.id FROM products p JOIN brands b ON b.id = p.brand_id WHERE b.slug = 'muuto' AND p.name = 'Settle Outdoor Lounge Chair w. Armrest'`
  );
  if (settleRows.length === 0) { console.log('   [skip] not found in DB'); }
  else {
    const settleId = settleRows[0].id;
    await pool.query(`UPDATE products SET source_url = $1 WHERE id = $2`,
      ['https://www.muuto.com/product/Settle-Lounge-Chair-Armrest--STTLOARM/STTLOARMLB0102/', settleId]);
    console.log('   ✓ Updated source_url');
    const settleImages = [
      'https://cdn.occtoo-media.com/4d81f22f-2795-41f2-b8bf-15e9abf03890/febf400d-6c38-5b08-99aa-a8b94494f810/Settle-1-Seater-Laze1-Grey-Linear-Steel-Coffee-Table-Grey-Hi-Res-1%20-%20Copy.webp',
      'https://cdn.occtoo-media.com/4d81f22f-2795-41f2-b8bf-15e9abf03890/c7fbcfb2-44f5-5210-b76b-e5a1d3dcbd4e/Settle-1-Seater-Laze-1-Grey-Linear-Steel-Cafe-Table-Pale-Blue-Hi-Res-wide.webp',
      'https://cdn.occtoo-media.com/4d81f22f-2795-41f2-b8bf-15e9abf03890/7a6ecef6-2cf4-5d87-8786-67af57727d4d/Settle-lounge-chair-ribbed-weave-2-dark-green-concept-muutohi-res.webp',
    ];
    for (const url of settleImages) {
      try { await embedImage(settleId, url, url.split('/').pop().split('?')[0]); }
      catch (e) { console.log(`    ✗ Failed: ${e.message}`); }
    }
  }

  // ── 6. Visu Bar Stool ────────────────────────────────────────────────────
  console.log('\n6. Fixing "Visu Bar Stool"...');
  const { rows: visuRows } = await pool.query(
    `SELECT p.id FROM products p JOIN brands b ON b.id = p.brand_id WHERE b.slug = 'muuto' AND p.name = 'Visu Bar Stool'`
  );
  if (visuRows.length === 0) { console.log('   [skip] not found in DB'); }
  else {
    const visuId = visuRows[0].id;
    await pool.query(`UPDATE products SET source_url = $1 WHERE id = $2`,
      ['https://www.muuto.com/product/Visu-Bar-Stool-Wood-Base--VIBARN/VIBARN01011/', visuId]);
    console.log('   ✓ Updated source_url');
    const visuImages = [
      'https://cdn.occtoo-media.com/4d81f22f-2795-41f2-b8bf-15e9abf03890/846f41c8-2259-52c5-8f44-0c4c08b09ea8/Linear-system-high-table-105-oak-tray-75-visu-bar-stool-75-dark-green-ridge-planter-15-off-white-sketch.webp',
      'https://assets.presscloud.com/file/47/472204019249167/preview.webp',
      'https://assets.presscloud.com/file/28/284098932640784/preview.webp',
    ];
    for (const url of visuImages) {
      try { await embedImage(visuId, url, url.split('/').pop()); }
      catch (e) { console.log(`    ✗ Failed: ${e.message}`); }
    }
  }

  // ── Final coverage ────────────────────────────────────────────────────────
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
  console.log(`\nMuuto: ${s.total} products | ${s.good} good (≥4) | ${s.partial} partial | ${s.zero} zero`);

  await pool.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
