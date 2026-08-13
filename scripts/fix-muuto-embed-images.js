/**
 * Embed the user-provided images for Raise Glasses, Settle Chair, Visu Bar Stool.
 * (Deletions and URL updates were already applied.)
 */
require('dotenv').config();
const https = require('https');
const http = require('http');
const { pool } = require('../src/config/database');
const siglipService = require('../src/services/siglip-embedding.service');

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, {
      timeout: 30000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.muuto.com/' },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadImage(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
  });
}

async function embedImage(productId, imageUrl) {
  const baseUrl = imageUrl.split('?')[0];
  const { rows } = await pool.query(
    `SELECT id FROM product_siglip_images WHERE product_id = $1 AND split_part(image_url,'?',1) = $2`,
    [productId, baseUrl]
  );
  if (rows.length > 0) { console.log(`    [skip] already embedded: ${baseUrl.split('/').pop()}`); return; }

  const buf = await downloadImage(imageUrl);
  const embedding = await siglipService.getImageEmbeddingFromBuffer(buf);
  await pool.query(
    `INSERT INTO product_siglip_images (product_id, image_url, image_type, siglip_embedding)
     VALUES ($1, $2, 'product', $3::vector) ON CONFLICT DO NOTHING`,
    [productId, baseUrl, `[${embedding.join(',')}]`]
  );
  console.log(`    ✓ ${baseUrl.split('/').pop()}`);
}

async function getProductId(name) {
  const { rows } = await pool.query(
    `SELECT p.id FROM products p JOIN brands b ON b.id = p.brand_id WHERE b.slug = 'muuto' AND p.name = $1`,
    [name]
  );
  return rows[0]?.id || null;
}

async function main() {
  console.log('Loading SigLIP model...');
  await siglipService.initSigLIPModel();
  console.log('Ready.\n');

  // Raise Glasses Set of 2
  console.log('Raise Glasses Set of 2:');
  const raiseId = await getProductId('Raise Glasses Set of 2');
  if (!raiseId) { console.log('  not found'); }
  else {
    for (const url of [
      'https://cdn.occtoo-media.com/4d81f22f-2795-41f2-b8bf-15e9abf03890/6a5b605d-1037-5c1e-b307-97f3a77e4594/Raise-concept-burnt-orange-5-muuto-org.webp',
      'https://cdn.occtoo-media.com/4d81f22f-2795-41f2-b8bf-15e9abf03890/ac21b90b-b283-5957-96a3-91869580af2a/Raise-concept-dark-blue-muuto-org.webp',
    ]) {
      try { await embedImage(raiseId, url); }
      catch (e) { console.log(`    ✗ ${e.message}`); }
    }
  }

  // Settle Outdoor Lounge Chair w. Armrest
  console.log('\nSettle Outdoor Lounge Chair w. Armrest:');
  const settleId = await getProductId('Settle Outdoor Lounge Chair w. Armrest');
  if (!settleId) { console.log('  not found'); }
  else {
    for (const url of [
      'https://cdn.occtoo-media.com/4d81f22f-2795-41f2-b8bf-15e9abf03890/febf400d-6c38-5b08-99aa-a8b94494f810/Settle-1-Seater-Laze1-Grey-Linear-Steel-Coffee-Table-Grey-Hi-Res-1%20-%20Copy.webp',
      'https://cdn.occtoo-media.com/4d81f22f-2795-41f2-b8bf-15e9abf03890/c7fbcfb2-44f5-5210-b76b-e5a1d3dcbd4e/Settle-1-Seater-Laze-1-Grey-Linear-Steel-Cafe-Table-Pale-Blue-Hi-Res-wide.webp',
      'https://cdn.occtoo-media.com/4d81f22f-2795-41f2-b8bf-15e9abf03890/7a6ecef6-2cf4-5d87-8786-67af57727d4d/Settle-lounge-chair-ribbed-weave-2-dark-green-concept-muutohi-res.webp',
    ]) {
      try { await embedImage(settleId, url); }
      catch (e) { console.log(`    ✗ ${e.message}`); }
    }
  }

  // Visu Bar Stool
  console.log('\nVisu Bar Stool:');
  const visuId = await getProductId('Visu Bar Stool');
  if (!visuId) { console.log('  not found'); }
  else {
    for (const url of [
      'https://cdn.occtoo-media.com/4d81f22f-2795-41f2-b8bf-15e9abf03890/846f41c8-2259-52c5-8f44-0c4c08b09ea8/Linear-system-high-table-105-oak-tray-75-visu-bar-stool-75-dark-green-ridge-planter-15-off-white-sketch.webp',
      'https://assets.presscloud.com/file/47/472204019249167/preview.webp',
      'https://assets.presscloud.com/file/28/284098932640784/preview.webp',
    ]) {
      try { await embedImage(visuId, url); }
      catch (e) { console.log(`    ✗ ${e.message}`); }
    }
  }

  // Final coverage
  const { rows: [s] } = await pool.query(`
    SELECT COUNT(*) total,
      SUM(CASE WHEN c=0 THEN 1 ELSE 0 END) zero,
      SUM(CASE WHEN c BETWEEN 1 AND 3 THEN 1 ELSE 0 END) partial,
      SUM(CASE WHEN c>=4 THEN 1 ELSE 0 END) good
    FROM (SELECT p.id, COUNT(psi.id) c FROM products p JOIN brands b ON b.id=p.brand_id
          LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
          WHERE b.slug='muuto' GROUP BY p.id) sub
  `);
  console.log(`\nMuuto: ${s.total} products | ${s.good} good (≥4) | ${s.partial} partial | ${s.zero} zero`);

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
