require('dotenv').config();
const { chromium } = require('playwright');
const https = require('https');
const http = require('http');
const { pool } = require('../src/config/database');
const siglipService = require('../src/services/siglip-embedding.service');
const logger = require('../src/config/logger');

// 3-Seater already fixed — remaining 5
const NAMES = [
  'Oslo Sofa 1 Seater',
  'In Situ Modular Sofa 2-Seater Configurations - Frame and Module - Ocean 80/Black - 2-Seater - Configuration 7',
  'In Situ Modular Sofa 4-Seater Configurations - Frame and Module - Clay 15/Black - 4-Seater - Configuration 5',
  'In Situ Modular Sofa Corner Configurations - Frame and Module - Ocean 80/Black - Corner - Configuration 9',
  'Outline Corner Sofa Vidar 733/Black',
];

// New-format source URL overrides
const SOURCE_URL_OVERRIDES = {
  'Oslo Sofa 1 Seater': 'https://www.muuto.com/product/Oslo-Sofa/',
  'In Situ Modular Sofa 2-Seater Configurations - Frame and Module - Ocean 80/Black - 2-Seater - Configuration 7':
    'https://www.muuto.com/product/In-Situ-Modular-Sofa-2-Seater-Configurations/',
  'In Situ Modular Sofa 4-Seater Configurations - Frame and Module - Clay 15/Black - 4-Seater - Configuration 5':
    'https://www.muuto.com/product/In-Situ-Modular-Sofa-4-Seater-Configurations/',
  'In Situ Modular Sofa Corner Configurations - Frame and Module - Ocean 80/Black - Corner - Configuration 9':
    'https://www.muuto.com/product/In-Situ-Modular-Sofa-Corner-Configurations/',
  'Outline Corner Sofa Vidar 733/Black': 'https://www.muuto.com/product/Outline-Sofa/',
};

const BLOCKLIST = ['stregtegn', 'drawing', 'technical', 'news', 'menu', 'brandsite'];

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
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

async function main() {
  const { rows: products } = await pool.query(
    `SELECT p.id, p.name, p.source_url FROM products p
     JOIN brands b ON b.id=p.brand_id
     WHERE b.slug='muuto' AND p.name=ANY($1)
     ORDER BY p.name`, [NAMES]
  );

  logger.info(`Processing ${products.length} products\n`);

  // Pre-load SigLIP once
  logger.info('Loading SigLIP model...');
  const testBuf = await downloadImage('https://www.muuto.com/favicon.ico').catch(() => Buffer.alloc(100));
  // warm up model with a dummy call
  try { await siglipService.getImageEmbeddingFromBuffer(testBuf); } catch (_) {}
  logger.info('Model ready\n');

  const browser = await chromium.launch({ headless: true });

  for (const product of products) {
    const srcUrl = SOURCE_URL_OVERRIDES[product.name] || product.source_url;
    logger.info(`\n${product.name}`);
    logger.info(`  source: ${srcUrl}`);

    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });
    const page = await ctx.newPage();

    const intercepted = [];
    page.on('request', req => {
      const u = req.url();
      if (u.includes('occtoo-media.com') && !BLOCKLIST.some(b => u.includes(b))) {
        intercepted.push(u);
      }
    });

    try {
      await page.goto(srcUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(6000);

      if (intercepted.length === 0) {
        logger.warn('  No occtoo images intercepted — skipping');
        continue;
      }

      logger.info(`  ${intercepted.length} images intercepted`);

      // Deduplicate and pick first (most likely hero image)
      const unique = [...new Set(intercepted)];
      const best = unique[0];
      logger.info(`  Best: ${best.substring(0, 100)}`);

      const buf = await downloadImage(best);
      if (!buf || buf.length === 0) throw new Error('empty image');

      const embedding = await siglipService.getImageEmbeddingFromBuffer(buf);

      await pool.query(`UPDATE products SET image_url=$1, updated_at=NOW() WHERE id=$2`, [best, product.id]);
      await pool.query(
        `INSERT INTO product_siglip_images (product_id, image_url, image_type, siglip_embedding)
         VALUES ($1, $2, 'product', $3::vector) ON CONFLICT DO NOTHING`,
        [product.id, best, `[${embedding.join(',')}]`]
      );

      logger.info('  ✓ Image + embedding updated');
    } catch (err) {
      logger.warn(`  FAILED: ${err.message}`);
    } finally {
      await page.close();
      await ctx.close();
      // Brief pause between products to let memory settle
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  await browser.close();
  await pool.end();
}

main().catch(err => { logger.error('Fatal:', err); pool.end(); process.exit(1); });
