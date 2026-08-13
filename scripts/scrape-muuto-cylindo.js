/**
 * Muuto multi-image scraper + SigLIP embedder
 *
 * Strategy per product:
 *  1. Derive Cylindo code from product name (uppercase + underscores), try frame 1
 *     - If 200: fetch frames 1–6 (clean 3D renders, white bg, correct product)
 *     - If 404: fall back to page scraping
 *  2. Page fallback: visit page, extract images, filter by product-name keywords
 *     to avoid cross-contamination from "related products" sections
 *
 * Usage:
 *   node scripts/scrape-muuto-cylindo.js           # products with < 4 embeddings
 *   node scripts/scrape-muuto-cylindo.js --all     # all Muuto products
 *   node scripts/scrape-muuto-cylindo.js --dry-run # preview only, no DB writes
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

const CYLINDO_ACCOUNT        = '4928';
const CYLINDO_BASE           = `https://content.cylindo.com/api/v2/${CYLINDO_ACCOUNT}/products`;
const MAX_FRAMES             = 6;
const MAX_IMAGES_PER_PRODUCT = 6;
const MIN_IMAGES_THRESHOLD   = 4;
const PAGE_WAIT_MS           = 3500;

// Common English words to skip when building the name filter
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'with', 'in', 'on', 'for',
  'to', 'by', 'at', 'from', 'up', 'as', 'cm', 'mm', 'w', 'h', 'd'
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.muuto.com/',
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

/** Derive a Cylindo product code guess from a product name.
 *  "Doze Ottoman" → "DOZE_OTTOMAN"
 *  "Oslo Sofa 2-Seater" → "OSLO_SOFA_2-SEATER"
 */
function deriveCode(name) {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\-\s]/g, '')  // keep letters, digits, hyphens
    .replace(/\s+/g, '_');
}

/** Try the derived code + common variations; return the first valid code or null */
async function tryFindCylindoCode(name) {
  const base = deriveCode(name);
  const candidates = [
    base,
    // Strip trailing size/config text: "SOFA_2_SEATER" variants
    base.replace(/_\d+[\-_]SEATER$/, ''),
    base.replace(/_\d+$/, ''),
    base + '_BASE',
  ];

  for (const code of [...new Set(candidates)]) {
    if (!code || code.length < 3) continue;
    const url = `${CYLINDO_BASE}/${code}/frames/1/${code}.webp?size=300`;
    try {
      const buf = await downloadImage(url);
      if (buf && buf.length > 500) return code;
    } catch (err) {
      if (err.message.includes('timeout')) break;
      // 404 → try next candidate
    }
  }
  return null;
}

/** Fetch valid Cylindo frames 1–MAX_FRAMES */
async function fetchValidCylindoFrames(code) {
  const valid = [];
  for (let frame = 1; frame <= MAX_FRAMES; frame++) {
    const url = `${CYLINDO_BASE}/${code}/frames/${frame}/${code}.webp?size=768`;
    try {
      const buf = await downloadImage(url);
      if (buf && buf.length > 500) valid.push({ url, buf });
    } catch (err) {
      if (err.message.includes('HTTP 404') || err.message.includes('HTTP 40')) break;
    }
  }
  return valid;
}

/** Build a keyword filter list from the product name.
 *  "Ambit Pendant Cluster" → ["ambit", "pendant", "cluster"]
 *  Used to filter out cross-product contamination from page scraping.
 */
function buildKeywords(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/** Scrape hi-res product images from a product page, filtered by product keywords */
async function scrapePageImages(page, productName) {
  const keywords = buildKeywords(productName);
  const keywordsJson = JSON.stringify(keywords);

  return page.evaluate((kwJson) => {
    const keywords = JSON.parse(kwJson);
    const imgs = [...document.querySelectorAll('img[src]')];
    const seen = new Set();
    const results = [];

    for (const img of imgs) {
      const src = img.src;
      if (!src) continue;
      const lower = src.toLowerCase();

      // Reject known non-product images
      if (lower.includes('logo') || lower.includes('portrait') || lower.includes('flag')) continue;
      if (lower.includes('designer') || lower.includes('person') || lower.includes('avatar')) continue;

      // Must be from known Muuto CDNs
      const isAzure = src.includes('azurefd.net') || src.includes('muuto.com/globalassets');
      const isOcctoo = src.includes('occtoo-media.com');
      if (!isAzure && !isOcctoo) continue;

      // Reject lifestyle/editorial shots.
      // Patterns: -org_ / _org_ / -org. / _org. (URL-encoded spaces still in src)
      // ALSO: "org - copy" or "org%20-%20copy" (space-decoded or percent-encoded pattern from Muuto's CMS)
      if (lower.includes('-org_') || lower.includes('_org_') || lower.includes('-org.') || lower.includes('_org.')) continue;
      if (lower.includes('org - copy') || lower.includes('org%20-%20copy') || lower.includes('- copy')) continue;
      if (lower.includes('in-situ')) continue;

      // Reject technical drawings and other non-product images
      if (lower.includes('stregtegninger') || lower.includes('low-res')) continue;

      // Reject Linear System FURNITURE images from lamp products
      // "linear-system" images (desks/tables/screens) must NOT be added to lamp products
      if (lower.includes('linear-system') && keywords.includes('lamp') && !keywords.includes('system')) continue;

      // Reject tiny thumbnails
      if (img.naturalWidth > 0 && img.naturalWidth < 200) continue;

      // ── Keyword filter: filename must contain the FIRST TWO keywords ──
      // Using only the first keyword causes false positives for product families:
      //   "ambit" matches ambit-wall-lamp in an ambit-rail-lamp product.
      //   "workshop" matches workshop-bench in a workshop-chair product.
      // Requiring TWO keywords eliminates sibling cross-contamination:
      //   "Ambit Rail Lamp" → needs "ambit" AND "rail" → rejects ambit-wall-lamp.webp ✓
      //   "Workshop Chair"  → needs "workshop" AND "chair" → rejects workshop-bench.webp ✓
      const filename = decodeURIComponent(src.split('/').pop().split('?')[0]).toLowerCase();
      const k0 = keywords[0];
      const k1 = keywords[1]; // may be undefined for single-word product names
      if (k0 && !filename.includes(k0)) continue;
      if (k1 && !filename.includes(k1)) continue;

      const baseUrl = src.split('?')[0];
      if (seen.has(baseUrl)) continue;
      seen.add(baseUrl);
      results.push(baseUrl);
    }

    // Sort: hi-res product shots first
    return results.sort((a, b) => {
      const aScore = (a.includes('hi-res') || a.includes('5000x5000')) ? 1 : 0;
      const bScore = (b.includes('hi-res') || b.includes('5000x5000')) ? 1 : 0;
      return bScore - aScore;
    });
  }, keywordsJson);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  logger.info('=== Muuto Multi-Image Scraper (Cylindo + Fallback) ===');
  if (DRY_RUN)  logger.info('DRY RUN — no DB writes');
  if (ALL_MODE) logger.info('ALL MODE — re-processing every product');

  const { rows: products } = await pool.query(`
    SELECT p.id, p.name, p.source_url,
           COUNT(psi.id) as existing_images
    FROM products p
    JOIN brands b ON b.id = p.brand_id
    LEFT JOIN product_siglip_images psi ON psi.product_id = p.id
    WHERE b.slug = 'muuto'
      AND p.source_url IS NOT NULL
      AND p.source_url != ''
    GROUP BY p.id, p.name, p.source_url
    ${ALL_MODE ? '' : `HAVING COUNT(psi.id) < ${MIN_IMAGES_THRESHOLD}`}
    ORDER BY COUNT(psi.id), p.name
  `);

  logger.info(`Found ${products.length} Muuto products to process\n`);
  if (products.length === 0) {
    logger.info('Nothing to do.'); await pool.end(); return;
  }

  // Warm up SigLIP
  logger.info('Loading SigLIP model...');
  try {
    const warmBuf = await downloadImage('https://www.muuto.com/favicon.ico').catch(() => Buffer.alloc(200));
    await siglipService.getImageEmbeddingFromBuffer(warmBuf).catch(() => {});
  } catch (_) {}
  logger.info('Model ready\n');

  const browser = await chromium.launch({ headless: true });
  let totalEmbedded = 0, totalSkipped = 0, totalFailed = 0;
  let cylindoCount = 0, fallbackCount = 0, fallbackPageCount = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const prefix = `[${i + 1}/${products.length}]`;
    logger.info(`${prefix} ${p.name}  (existing: ${p.existing_images})`);

    try {
      // Get existing embedded URLs
      const { rows: existing } = await pool.query(
        `SELECT image_url FROM product_siglip_images WHERE product_id = $1`, [p.id]
      );
      const existingBases = new Set(existing.map(r => r.image_url.split('?')[0]));
      const remainingSlots = MAX_IMAGES_PER_PRODUCT - existing.length;

      if (remainingSlots <= 0) {
        logger.info('  Already at max — skipping'); totalSkipped++; continue;
      }

      // ── Step 1: Try Cylindo by deriving code from product name ────────────
      let toEmbed = [];
      const code = await tryFindCylindoCode(p.name);

      if (code) {
        logger.info(`  ✓ Cylindo code: ${code}`);
        const frames = await fetchValidCylindoFrames(code);
        logger.info(`  Frames: ${frames.length}`);
        toEmbed = frames
          .filter(f => !existingBases.has(f.url.split('?')[0]))
          .slice(0, remainingSlots)
          .map(f => ({ url: f.url, buf: f.buf, imageType: 'product', source: 'cylindo' }));
        if (toEmbed.length > 0) cylindoCount++;
      }

      // ── Step 2: If Cylindo failed or not enough frames — scrape page ──────
      if (toEmbed.length === 0) {
        logger.info('  No Cylindo — loading page for fallback images');
        const ctx  = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
        const page = await ctx.newPage();
        try {
          await page.goto(p.source_url, { waitUntil: 'domcontentloaded', timeout: 40000 });
          await page.waitForTimeout(2000);
          await page.evaluate(() => window.scrollBy(0, 500));
          await page.waitForTimeout(PAGE_WAIT_MS);

          // Also try Cylindo code from the live page (might be in img tag)
          const pageCode = await page.evaluate(() => {
            const cylindoImgs = [...document.querySelectorAll('img[src*="cylindo.com/api/v2"]')];
            for (const img of cylindoImgs) {
              const m = img.src.match(/\/products\/([A-Z0-9_\-]+)\/frames\//);
              if (m) return m[1];
            }
            const allText = document.documentElement.innerHTML;
            const m = allText.match(/cylindo\.com\/api\/v2\/\d+\/products\/([A-Z0-9_\-]+)\/frames\//);
            return m ? m[1] : null;
          });

          if (pageCode && pageCode !== code) {
            logger.info(`  ✓ Cylindo code from page: ${pageCode}`);
            const frames = await fetchValidCylindoFrames(pageCode);
            toEmbed = frames
              .filter(f => !existingBases.has(f.url.split('?')[0]))
              .slice(0, remainingSlots)
              .map(f => ({ url: f.url, buf: f.buf, imageType: 'product', source: 'cylindo-page' }));
            if (toEmbed.length > 0) cylindoCount++;
          }

          if (toEmbed.length === 0) {
            // True fallback: page image scraping with keyword filter
            const pageImgs = await scrapePageImages(page, p.name);
            logger.info(`  Page fallback: ${pageImgs.length} keyword-matched images`);

            for (const imgBase of pageImgs.filter(u => !existingBases.has(u)).slice(0, remainingSlots)) {
              try {
                const dlUrl = imgBase + '?w=800';
                const buf = await downloadImage(dlUrl);
                if (buf && buf.length > 500) {
                  toEmbed.push({ url: dlUrl, buf, imageType: 'product', source: 'page' });
                }
              } catch (_) {}
            }
            if (toEmbed.length > 0) fallbackPageCount++;
          }
        } catch (err) {
          logger.warn(`  Page load failed: ${err.message}`);
        } finally {
          await page.close(); await ctx.close();
        }
        fallbackCount++;
      }

      if (toEmbed.length === 0) {
        logger.info('  Nothing found — skipping'); totalSkipped++; continue;
      }

      // ── Embed ─────────────────────────────────────────────────────────────
      let productEmbedded = 0;
      for (const item of toEmbed) {
        const filename = item.url.split('/').pop().split('?')[0];
        try {
          if (!DRY_RUN) {
            const embedding = await siglipService.getImageEmbeddingFromBuffer(item.buf);
            await pool.query(
              `INSERT INTO product_siglip_images (product_id, image_url, image_type, siglip_embedding)
               VALUES ($1, $2, $3, $4::vector)
               ON CONFLICT DO NOTHING`,
              [p.id, item.url, item.imageType, `[${embedding.join(',')}]`]
            );
          }
          logger.info(`  ✓ [${item.source}] ${decodeURIComponent(filename)}`);
          productEmbedded++; totalEmbedded++;
        } catch (err) {
          logger.warn(`  ✗ ${filename}: ${err.message}`);
        }
      }

      if (productEmbedded > 0) {
        logger.info(`  → +${productEmbedded} embeddings`);
      } else {
        totalFailed++;
      }

    } catch (err) {
      logger.warn(`  FAILED: ${err.message}`); totalFailed++;
    }
  }

  await browser.close();

  logger.info(`\n${'='.repeat(40)}`);
  logger.info('Muuto scrape complete');
  logger.info(`  New embeddings:  ${totalEmbedded}`);
  logger.info(`  Cylindo hits:    ${cylindoCount}`);
  logger.info(`  Page fallbacks:  ${fallbackPageCount}`);
  logger.info(`  Skipped:         ${totalSkipped}`);
  logger.info(`  Failed:          ${totalFailed}`);

  if (!DRY_RUN) {
    const { rows } = await pool.query(`
      SELECT ROUND(AVG(cnt),1) as avg, MIN(cnt) as min, MAX(cnt) as max
      FROM (
        SELECT COUNT(*) cnt FROM product_siglip_images psi
        JOIN products p ON p.id = psi.product_id
        JOIN brands b ON b.id = p.brand_id
        WHERE b.slug = 'muuto' GROUP BY p.id
      ) sub
    `);
    logger.info(`\nMuuto avg/min/max after: ${rows[0].avg}/${rows[0].min}/${rows[0].max}`);
  }

  await pool.end();
}

main().catch(e => { logger.error('Fatal:', e); pool.end(); process.exit(1); });
