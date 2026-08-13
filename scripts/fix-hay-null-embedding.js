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
      headers: { 'User-Agent': 'Mozilla/5.0' },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302)
        return downloadImage(res.headers.location).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  // Find the null-embedding row
  const { rows } = await pool.query(`
    SELECT psi.id, psi.image_url, p.name
    FROM product_siglip_images psi
    JOIN products p ON p.id = psi.product_id
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'hay' AND psi.siglip_embedding IS NULL
  `);

  if (rows.length === 0) { console.log('No NULL embeddings found for HAY.'); await pool.end(); return; }

  console.log(`Found ${rows.length} NULL embedding(s):`);
  rows.forEach(r => console.log(`  [${r.name}] ${r.image_url}`));

  console.log('\nLoading SigLIP model...');
  await siglipService.initSigLIPModel();
  console.log('Ready.\n');

  for (const row of rows) {
    console.log(`Embedding: ${row.image_url.split('/').pop()}`);
    try {
      const buf = await downloadImage(row.image_url);
      const embedding = await siglipService.getImageEmbeddingFromBuffer(buf);
      await pool.query(
        `UPDATE product_siglip_images SET siglip_embedding = $1::vector WHERE id = $2`,
        [`[${embedding.join(',')}]`, row.id]
      );
      console.log(`  ✓ Done`);
    } catch (e) {
      console.log(`  ✗ Failed: ${e.message}`);
    }
  }

  // Verify
  const { rows: [check] } = await pool.query(
    `SELECT COUNT(*) n FROM product_siglip_images WHERE siglip_embedding IS NULL`
  );
  console.log(`\nRemaining NULL embeddings: ${check.n}`);

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
