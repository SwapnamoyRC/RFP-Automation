require('dotenv').config();
const { chromium } = require('playwright');
const https = require('https');
const { pool } = require('../src/config/database');
const siglipService = require('../src/services/siglip-embedding.service');
const logger = require('../src/config/logger');

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? require('https') : require('http');
    lib.get(url, {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
  });
}

const BLOCKLIST = ['stregtegn', 'drawing', 'technical', 'news', 'menu', 'brandsite'];

async function main() {
  // 1. Delete Outline Corner Sofa Vidar 733/Black
  const { rows: outline } = await pool.query(
    `SELECT p.id FROM products p JOIN brands b ON b.id=p.brand_id
     WHERE b.slug='muuto' AND p.name='Outline Corner Sofa Vidar 733/Black'`
  );
  for (const r of outline) {
    await pool.query(`DELETE FROM product_siglip_images WHERE product_id=$1`, [r.id]);
    await pool.query(`DELETE FROM products WHERE id=$1`, [r.id]);
  }
  logger.info(`✓ Deleted: Outline Corner Sofa Vidar 733/Black`);

  // 2. Scrape Oslo Sofa 1 Seater from correct URL
  const url = 'https://www.muuto.com/product/Oslo-Sofa-1-Seater/';
  logger.info(`\nScraping Oslo Sofa 1 Seater → ${url}`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
  const page = await ctx.newPage();

  const intercepted = [];
  page.on('request', req => {
    const u = req.url();
    if (u.includes('occtoo-media.com') && !BLOCKLIST.some(b => u.includes(b))) intercepted.push(u);
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(6000);

    logger.info(`  ${intercepted.length} images intercepted`);

    if (intercepted.length === 0) {
      logger.warn('  No occtoo images found');
    } else {
      const best = [...new Set(intercepted)][0];
      logger.info(`  Best: ${best.substring(0, 100)}`);

      const buf = await downloadImage(best);
      const embedding = await siglipService.getImageEmbeddingFromBuffer(buf);

      const { rows } = await pool.query(
        `SELECT p.id FROM products p JOIN brands b ON b.id=p.brand_id
         WHERE b.slug='muuto' AND p.name='Oslo Sofa 1 Seater'`
      );
      if (rows.length) {
        await pool.query(
          `UPDATE products SET image_url=$1, source_url=$2, updated_at=NOW() WHERE id=$3`,
          [best, url, rows[0].id]
        );
        await pool.query(
          `INSERT INTO product_siglip_images (product_id, image_url, image_type, siglip_embedding)
           VALUES ($1, $2, 'product', $3::vector) ON CONFLICT DO NOTHING`,
          [rows[0].id, best, `[${embedding.join(',')}]`]
        );
        logger.info('  ✓ Image + source_url + embedding updated');
      }
    }
  } catch (err) {
    logger.warn(`  FAILED: ${err.message}`);
  } finally {
    await page.close();
    await ctx.close();
    await browser.close();
  }

  await pool.end();
}

main().catch(err => { logger.error('Fatal:', err); pool.end(); process.exit(1); });
