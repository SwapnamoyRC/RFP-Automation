/**
 * Targeted re-scrape for specific NaughtOne products.
 * Visits each product page, collects all /wp-content/uploads/ images
 * (excluding 1920x wide shots and non-product images), embeds with SigLIP.
 */
require('dotenv').config();
const { chromium } = require('playwright');
const https = require('https');
const http = require('http');
const { pool } = require('../src/config/database');
const siglipService = require('../src/services/siglip-embedding.service');
const logger = require('../src/config/logger');

const TARGETS = [
  { name: 'Hudson Coatstand',       url: 'https://www.naughtone.com/products/hudson/' },
  { name: 'Lotti Chair',            url: 'https://www.naughtone.com/products/lotti/' },
  { name: 'Pullman Modular Seating',url: 'https://www.naughtone.com/products/pullman-modular/' },
];

const MAX_IMAGES = 8;
const DRY_RUN = process.argv.includes('--dry-run');

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://www.naughtone.com/' },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) return downloadImage(res.headers.location).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
  });
}

function classifyImageType(url) {
  const lower = url.toLowerCase();
  if (lower.includes('_detail') || lower.includes('detail_')) return 'detail';
  if (lower.includes('_grp') || lower.includes('_group') || lower.includes('group_')) return 'group';
  if (lower.includes('3qtr') || lower.includes('_3q') || lower.includes('qtr')) return '3qtr';
  if (lower.includes('_front') || lower.includes('front_')) return 'front';
  if (lower.includes('_side') || lower.includes('side_')) return 'side';
  if (lower.includes('_hr') || lower.includes('_lr') || lower.includes('_web')) return 'product';
  return 'product';
}

async function main() {
  logger.info('=== NaughtOne Targeted Re-Scraper ===');
  if (DRY_RUN) logger.info('DRY RUN');

  // Warm up SigLIP
  logger.info('Loading SigLIP model...');
  try {
    await siglipService.getImageEmbeddingFromBuffer(Buffer.alloc(200)).catch(() => {});
  } catch (_) {}
  logger.info('Model ready\n');

  const browser = await chromium.launch({ headless: true });

  for (const target of TARGETS) {
    // Get product ID and existing images
    const { rows: prodRows } = await pool.query(
      `SELECT p.id FROM products p JOIN brands b ON b.id=p.brand_id
       WHERE b.slug='naughtone' AND p.name=$1`, [target.name]
    );
    if (!prodRows.length) { logger.warn(`Product not found: ${target.name}`); continue; }
    const productId = prodRows[0].id;

    const { rows: existingRows } = await pool.query(
      `SELECT image_url FROM product_siglip_images WHERE product_id=$1`, [productId]
    );
    const existingUrls = new Set(existingRows.map(r => r.image_url.split('?')[0]));
    const slotsLeft = MAX_IMAGES - existingRows.length;

    logger.info(`[${target.name}] existing=${existingRows.length} slots=${slotsLeft}`);
    if (slotsLeft <= 0) { logger.info('  Already at max — skipping'); continue; }

    const ctx  = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
    const page = await ctx.newPage();

    try {
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 40000 });
      await page.waitForTimeout(2000);
      // Scroll to load lazy images
      for (let s = 0; s < 5; s++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await page.waitForTimeout(500);
      }
      await page.waitForTimeout(1500);

      // Collect all /wp-content/uploads/ images — deduplicate by base URL
      const pageImages = await page.evaluate(() => {
        const seen = new Set();
        const results = [];
        for (const img of document.querySelectorAll('img[src]')) {
          const src = img.src;
          if (!src.includes('/wp-content/uploads/')) continue;
          if (src.includes('logo') || src.includes('loading') || src.endsWith('.svg')) continue;
          // Skip 1920x wide landscape shots
          if (src.includes('1920x')) continue;
          // Skip tiny thumbnails (if naturalWidth is available)
          if (img.naturalWidth > 0 && img.naturalWidth < 150) continue;

          const base = src.split('?')[0];
          // Also deduplicate resized versions: strip -NNNxNNN suffix before extension
          const canonical = base.replace(/-\d+x\d+(\.[a-z]+)$/i, '$1');
          if (seen.has(canonical)) continue;
          seen.add(canonical);
          results.push(base);
        }
        return results;
      });

      logger.info(`  Found ${pageImages.length} candidate images on page`);

      // Filter already-embedded, take up to slotsLeft
      const toEmbed = pageImages
        .filter(u => !existingUrls.has(u))
        .slice(0, slotsLeft);

      logger.info(`  To embed: ${toEmbed.length}`);

      let embedded = 0;
      for (const imgUrl of toEmbed) {
        const filename = imgUrl.split('/').pop();
        const imageType = classifyImageType(imgUrl);
        try {
          const buf = await downloadImage(imgUrl);
          if (!buf || buf.length < 500) throw new Error('too small');

          if (!DRY_RUN) {
            const embedding = await siglipService.getImageEmbeddingFromBuffer(buf);
            await pool.query(
              `INSERT INTO product_siglip_images (product_id, image_url, image_type, siglip_embedding)
               VALUES ($1, $2, $3, $4::vector) ON CONFLICT DO NOTHING`,
              [productId, imgUrl, imageType, `[${embedding.join(',')}]`]
            );
          }
          logger.info(`  ✓ [${imageType}] ${filename}`);
          embedded++;
        } catch (err) {
          logger.warn(`  ✗ ${filename}: ${err.message}`);
        }
      }
      logger.info(`  → +${embedded} embeddings\n`);

    } catch (err) {
      logger.warn(`  FAILED: ${err.message}\n`);
    } finally {
      await page.close();
      await ctx.close();
    }
  }

  await browser.close();

  // Final counts
  const { rows: finalStats } = await pool.query(`
    SELECT p.name, COUNT(psi.id) as imgs
    FROM products p JOIN brands b ON b.id=p.brand_id
    LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
    WHERE b.slug='naughtone' AND p.name IN ('Hudson Coatstand','Lotti Chair','Pullman Modular Seating')
    GROUP BY p.id, p.name ORDER BY p.name
  `);
  logger.info('Final image counts:');
  finalStats.forEach(r => logger.info(`  [${r.imgs}] ${r.name}`));

  await pool.end();
}
main().catch(e => { logger.error('Fatal:', e); pool.end(); process.exit(1); });
