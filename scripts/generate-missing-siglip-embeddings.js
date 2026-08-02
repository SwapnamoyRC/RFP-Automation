require('dotenv').config();
const https = require('https');
const http = require('http');
const { pool } = require('../src/config/database');
const siglipService = require('../src/services/siglip-embedding.service');
const logger = require('../src/config/logger');

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
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

async function main() {
  // All products where image_url is NOT yet embedded
  const { rows } = await pool.query(`
    SELECT p.id, p.name, p.image_url, b.name brand
    FROM products p
    JOIN brands b ON b.id = p.brand_id
    WHERE p.image_url IS NOT NULL AND p.image_url != ''
      AND NOT EXISTS (
        SELECT 1 FROM product_siglip_images s
        WHERE s.product_id = p.id AND s.image_url = p.image_url
      )
    ORDER BY b.name, p.name
  `);

  logger.info(`Found ${rows.length} products needing new embeddings\n`);

  let success = 0, failed = 0;
  const failedNames = [];

  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    const prefix = `[${i + 1}/${rows.length}] [${p.brand}]`;

    try {
      const buf = await downloadImage(p.image_url);
      if (!buf || buf.length === 0) throw new Error('empty image');

      const embedding = await siglipService.getImageEmbeddingFromBuffer(buf);

      await pool.query(
        `INSERT INTO product_siglip_images (product_id, image_url, image_type, siglip_embedding)
         VALUES ($1, $2, 'product', $3::vector)
         ON CONFLICT DO NOTHING`,
        [p.id, p.image_url, `[${embedding.join(',')}]`]
      );

      logger.info(`${prefix} ${p.name} ✓`);
      success++;
    } catch (err) {
      logger.warn(`${prefix} ${p.name} ✗ ${err.message}`);
      failed++;
      failedNames.push(`${p.brand} / ${p.name}`);
    }

    // Brief pause every 20 to avoid hammering the model
    if ((i + 1) % 20 === 0) await new Promise(r => setTimeout(r, 500));
  }

  logger.info(`\n=== Done ===`);
  logger.info(`Success: ${success}`);
  logger.info(`Failed:  ${failed}`);
  if (failedNames.length) {
    logger.info(`\nFailed products:`);
    failedNames.forEach(n => logger.info(`  - ${n}`));
  }

  await pool.end();
}

main().catch(err => { logger.error('Fatal:', err); pool.end(); process.exit(1); });
