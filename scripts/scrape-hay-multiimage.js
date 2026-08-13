/**
 * Scrape multiple real product images per HAY product and generate SigLIP embeddings.
 *
 * HAY real product images live on: /inriver/integration/service/ CDN
 * Editorial noise images live on:  /blocks/brandsite/ (already cleaned from DB)
 *
 * Strategy: visit each HAY product page, intercept network requests to the inriver CDN,
 * collect up to MAX_IMAGES_PER_PRODUCT unique product images, embed each with SigLIP.
 *
 * Usage:
 *   node scripts/scrape-hay-multiimage.js              # all HAY products with < 4 images
 *   node scripts/scrape-hay-multiimage.js --all        # all HAY products (re-embed everything)
 *   node scripts/scrape-hay-multiimage.js --dry-run    # preview only, no DB writes
 */
require('dotenv').config();
const { chromium } = require('playwright');
const https = require('https');
const http = require('http');
const { pool } = require('../src/config/database');
const siglipService = require('../src/services/siglip-embedding.service');
const logger = require('../src/config/logger');

const args = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');
const ALL_MODE = args.includes('--all');

const MAX_IMAGES_PER_PRODUCT = 6;   // max images to embed per product
const MIN_IMAGES_THRESHOLD   = 4;   // skip product if it already has >= this many embeddings
const PAGE_WAIT_MS           = 3000; // wait for JSON-LD to load
const BETWEEN_PRODUCTS_MS    = 1500;

// ── Helpers ──────────────────────────────────────────────────────────────────

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.hay.com/',
      },
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

function classifyImageType(url) {
  const lower = url.toLowerCase();
  if (lower.includes('brandlifestyle')) return 'lifestyle';
  if (lower.includes('brandvariant'))   return 'variant';
  if (lower.includes('brandmodel'))     return 'product';
  if (lower.includes('detail'))         return 'detail';
  if (lower.includes('group'))          return 'group';
  if (lower.includes('3qtr') || lower.includes('quarter')) return '3qtr';
  if (lower.includes('front'))          return 'front';
  if (lower.includes('side'))           return 'side';
  if (lower.includes('rear'))           return 'rear';
  return 'product';
}

// Normalise URL: strip query params, enforce ?w=600 for download
function baseUrl(url) { return url.split('?')[0]; }
function downloadUrl(url) { return baseUrl(url) + '?w=600'; }

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  logger.info(`=== HAY Multi-Image Scraper ===`);
  if (DRY_RUN)  logger.info('DRY RUN — no DB writes');
  if (ALL_MODE) logger.info('ALL MODE — re-processing every product');
  logger.info('');

  // Get HAY products, filtering by current image count unless --all
  const { rows: products } = await pool.query(`
    SELECT p.id, p.name, p.source_url,
           COUNT(psi.id) as existing_images
    FROM products p
    JOIN brands b ON b.id = p.brand_id
    LEFT JOIN product_siglip_images psi ON psi.product_id = p.id
    WHERE b.slug = 'hay'
      AND p.source_url IS NOT NULL
      AND p.source_url != ''
    GROUP BY p.id, p.name, p.source_url
    ${ALL_MODE ? '' : `HAVING COUNT(psi.id) < ${MIN_IMAGES_THRESHOLD}`}
    ORDER BY p.name
  `);

  logger.info(`Found ${products.length} HAY products to process\n`);
  if (products.length === 0) {
    logger.info('Nothing to do.');
    await pool.end();
    return;
  }

  // Warm up SigLIP model before the loop
  logger.info('Loading SigLIP model...');
  try {
    const warmBuf = await downloadImage('https://www.hay.com/favicon.ico').catch(() => Buffer.alloc(200));
    await siglipService.getImageEmbeddingFromBuffer(warmBuf).catch(() => {});
  } catch (_) {}
  logger.info('Model ready\n');

  const browser = await chromium.launch({ headless: true });
  let totalEmbedded = 0, totalSkipped = 0, totalFailed = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const prefix = `[${i + 1}/${products.length}]`;
    logger.info(`${prefix} ${p.name}`);
    logger.info(`  source: ${p.source_url}  (existing: ${p.existing_images})`);

    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });
    const page = await ctx.newPage();

    try {
      await page.goto(p.source_url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(PAGE_WAIT_MS);

      // Use JSON-LD structured data — only contains THIS product's images, not related products
      const productImages = await page.evaluate(() => {
        const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
        const images = new Set();

        for (const s of scripts) {
          try {
            const d = JSON.parse(s.textContent);
            // Product JSON-LD: single image field
            if (d['@type'] === 'Product' && d.image) {
              const imgs = Array.isArray(d.image) ? d.image : [d.image];
              imgs.forEach(u => images.add(u));
            }
            // ProductModel JSON-LD: one per variant, each has its own image
            if (d['@type'] === 'ProductModel' && d.image) {
              const imgs = Array.isArray(d.image) ? d.image : [d.image];
              imgs.forEach(u => images.add(u));
            }
          } catch (_) {}
        }

        return [...images];
      });

      // Normalise URLs and filter to real product images only (no editorial)
      const BASE_URL = 'https://www.hay.com';
      const allImages = productImages
        .map(u => (u.startsWith('http') ? u : BASE_URL + u))
        .map(u => baseUrl(u))
        .filter(u =>
          u.includes('/inriver/integration/service/') &&
          !u.includes('/blocks/brandsite/') &&
          !u.includes('logo') &&
          !u.includes('flag')
        );

      // Deduplicate
      const intercepted = new Set(allImages);

      if (intercepted.size === 0) {
        logger.warn('  ✗ No product images found in JSON-LD');
        totalSkipped++;
        continue;
      }
      logger.info(`  Found ${intercepted.size} product images in JSON-LD`);

      // Get existing embedded URLs for this product (to avoid re-embedding)
      const { rows: existing } = await pool.query(
        `SELECT image_url FROM product_siglip_images WHERE product_id = $1`,
        [p.id]
      );
      const existingBases = new Set(existing.map(r => baseUrl(r.image_url)));
      const remainingSlots = MAX_IMAGES_PER_PRODUCT - existing.length;

      const newCandidates = [...intercepted].filter(u => !existingBases.has(u));
      const toEmbed = newCandidates.slice(0, Math.max(0, remainingSlots));

      logger.info(`  New to embed: ${toEmbed.length}  (${newCandidates.length} new, ${existing.length} existing, ${remainingSlots} slots)`);

      if (toEmbed.length === 0) {
        logger.info('  Already has enough images — skipping');
        totalSkipped++;
        continue;
      }

      let productEmbedded = 0;
      for (const imgBase of toEmbed) {
        const dlUrl = downloadUrl(imgBase);
        const filename = imgBase.substring(imgBase.lastIndexOf('/') + 1);
        const imageType = classifyImageType(imgBase);

        try {
          const buf = await downloadImage(dlUrl);
          if (!buf || buf.length < 500) throw new Error('image too small or empty');

          if (!DRY_RUN) {
            const embedding = await siglipService.getImageEmbeddingFromBuffer(buf);
            await pool.query(
              `INSERT INTO product_siglip_images (product_id, image_url, image_type, siglip_embedding)
               VALUES ($1, $2, $3, $4::vector)
               ON CONFLICT DO NOTHING`,
              [p.id, dlUrl, imageType, `[${embedding.join(',')}]`]
            );
          }

          logger.info(`  ✓ [${imageType}] ${filename}`);
          productEmbedded++;
          totalEmbedded++;
        } catch (err) {
          logger.warn(`  ✗ ${filename}: ${err.message}`);
        }
      }

      if (productEmbedded > 0) {
        logger.info(`  → +${productEmbedded} embeddings added`);
      } else {
        totalFailed++;
      }

    } catch (err) {
      logger.warn(`  FAILED: ${err.message}`);
      totalFailed++;
    } finally {
      await page.close();
      await ctx.close();
      await new Promise(r => setTimeout(r, BETWEEN_PRODUCTS_MS));
    }
  }

  await browser.close();

  logger.info(`\n${'='.repeat(40)}`);
  logger.info(`HAY multi-image scrape complete`);
  logger.info(`  Total new embeddings: ${totalEmbedded}`);
  logger.info(`  Skipped (already enough): ${totalSkipped}`);
  logger.info(`  Failed: ${totalFailed}`);

  if (!DRY_RUN) {
    const { rows } = await pool.query(`
      SELECT ROUND(AVG(cnt),1) as avg, MIN(cnt) as min, MAX(cnt) as max
      FROM (
        SELECT COUNT(*) cnt FROM product_siglip_images psi
        JOIN products p ON p.id = psi.product_id
        JOIN brands b ON b.id = p.brand_id
        WHERE b.slug = 'hay'
        GROUP BY p.id
      ) sub
    `);
    logger.info(`\nHAY embeddings after run: avg=${rows[0].avg} min=${rows[0].min} max=${rows[0].max} per product`);
  }

  await pool.end();
}

main().catch(e => { logger.error('Fatal:', e); pool.end(); process.exit(1); });
