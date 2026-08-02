require('dotenv').config();
const https = require('https');
const http = require('http');
const { pool } = require('../src/config/database');
const siglipService = require('../src/services/siglip-embedding.service');
const { toSql } = require('pgvector/pg');
const logger = require('../src/config/logger');

const NAMES = [
  'Apex Clip Lamp','Apex Desk Lamp','Apex Table Lamp',
  'ARCS Arcs Salt & Pepper Grinder',
  'Crate Dining Chair','Crate Lounge Chair','Crate Low Table','Crate Side Table',
  'Mousqueton Portable','Nelson Fixture','New Order Combination',
  'Palissade Cord Chaise longue',
  'Pao Glass Floor Lamp','Pao Glass Pendant','Pao Glass Table Lamp','Pao Portable',
  'Weekday Bench','Weekday Bench duo','Weekday Table','X-Line Chair'
];

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.hay.com/' } }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.image_url FROM products p JOIN brands b ON b.id=p.brand_id
     WHERE b.slug='hay' AND p.name=ANY($1) ORDER BY p.name`, [NAMES]
  );
  logger.info(`Processing ${rows.length} products\n`);

  let fixed = 0, failed = [];

  for (const product of rows) {
    logger.info(`${product.name}`);

    // Step 1: delete wrong siglip entries (brandsite/news/menu images)
    const { rowCount } = await pool.query(
      `DELETE FROM product_siglip_images
       WHERE product_id=$1
         AND (image_url LIKE '%brandsite%' OR image_url LIKE '%/news/%' OR image_url LIKE '%/menu/%')`,
      [product.id]
    );
    logger.info(`  Deleted ${rowCount} wrong embeddings`);

    // Step 2: generate new embedding from correct image_url
    if (!product.image_url) { logger.info(`  No image_url — skipping`); failed.push(product.name); continue; }

    try {
      const imageBuffer = await downloadImage(product.image_url);
      const embedding = await siglipService.getImageEmbeddingFromBuffer(imageBuffer);
      await pool.query(
        `INSERT INTO product_siglip_images (product_id, image_url, image_type, siglip_embedding)
         VALUES ($1, $2, 'product', $3::vector)
         ON CONFLICT DO NOTHING`,
        [product.id, product.image_url, `[${embedding.join(',')}]`]
      );
      logger.info(`  Generated new embedding from: ${product.image_url.substring(0, 80)}`);
      fixed++;
    } catch (err) {
      logger.warn(`  Embedding failed: ${err.message}`);
      failed.push(product.name);
    }
  }

  logger.info(`\nDone — Fixed: ${fixed}, Failed: ${failed.length}`);
  if (failed.length) logger.info(`Failed: ${failed.join(', ')}`);
  await pool.end();
}

main().catch(err => { logger.error('Fatal:', err); pool.end(); process.exit(1); });
