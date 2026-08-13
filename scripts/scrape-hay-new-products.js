/**
 * Scrape and insert new HAY products from the /products/furniture/new page.
 * For each product:
 *  1. Visit the product page via Playwright
 *  2. Extract data from JSON-LD + page content
 *  3. INSERT into products table (ON CONFLICT DO NOTHING)
 *  4. Scrape product images and generate SigLIP embeddings
 *
 * Usage:
 *   node scripts/scrape-hay-new-products.js              # dry run (no DB writes)
 *   node scripts/scrape-hay-new-products.js --execute    # insert + embed
 *   node scripts/scrape-hay-new-products.js --skip-embed --execute  # insert only
 */
require('dotenv').config();
const { chromium } = require('playwright');
const https = require('https');
const http  = require('http');
const { pool } = require('../src/config/database');
const siglipService = require('../src/services/siglip-embedding.service');

const EXECUTE     = process.argv.includes('--execute');
const SKIP_EMBED  = process.argv.includes('--skip-embed');
const DRY_RUN     = !EXECUTE;

const MAX_IMAGES        = 6;
const PAGE_WAIT_MS      = 3500;
const BETWEEN_MS        = 1500;
const HAY_BRAND_ID      = 1;

// All 27 missing products from /products/furniture/new (Tray Table already in DB)
const PRODUCTS_TO_SCRAPE = [
  { url: 'https://www.hay.com/hay/furniture/seating/chair/pack-chair/pack-chair-10',     category: 'chair' },
  { url: 'https://www.hay.com/hay/furniture/seating/chair/pack-chair/pack-chair-11',     category: 'chair' },
  { url: 'https://www.hay.com/hay/furniture/seating/lounge/mimi-1-seater',               category: 'lounge' },
  { url: 'https://www.hay.com/hay/furniture/seating/sofa/mimi-2-seater',                 category: 'sofa' },
  { url: 'https://www.hay.com/hay/furniture/seating/sofa/mimi-25-seater',                category: 'sofa' },
  { url: 'https://www.hay.com/hay/furniture/seating/sofa/mimi-3-seater',                 category: 'sofa' },
  { url: 'https://www.hay.com/hay/furniture/seating/sofa/mimi-ottoman',                  category: 'ottoman' },
  { url: 'https://www.hay.com/hay/accessories/indoor-living/cushions--throws/mimi-cushion', category: 'accessory' },
  { url: 'https://www.hay.com/hay/furniture/seating/chair/backflip-chair',               category: 'chair' },
  { url: 'https://www.hay.com/hay/furniture/seating/seating-accessory/backflip-wall-bracket', category: 'accessory' },
  { url: 'https://www.hay.com/hay/furniture/seating/stool/chisel-10-stool',              category: 'stool' },
  { url: 'https://www.hay.com/hay/furniture/seating/bar-stool/chisel-30-bar-stool',      category: 'bar-stool' },
  { url: 'https://www.hay.com/hay/furniture/seating/bar-stool/chisel-35-bar-stool',      category: 'bar-stool' },
  { url: 'https://www.hay.com/hay/furniture/seating/chair/chisel-65-chair',              category: 'chair' },
  { url: 'https://www.hay.com/hay/furniture/seating/lounge/chisel-85-lounge-chair',      category: 'lounge' },
  { url: 'https://www.hay.com/hay/furniture/tables/dining-table/chisel-20-table-round',  category: 'table' },
  { url: 'https://www.hay.com/hay/furniture/tables/dining-table/chisel-25-table-round',  category: 'table' },
  { url: 'https://www.hay.com/hay/furniture/tables/dining-table/chisel-29-table-round',  category: 'table' },
  { url: 'https://www.hay.com/hay/furniture/tables/dining-table/chisel-30-table-rectangular',         category: 'table' },
  { url: 'https://www.hay.com/hay/furniture/tables/dining-table/chisel-630-extendable-table-rectangular', category: 'table' },
  { url: 'https://www.hay.com/hay/furniture/seating/sofa/mags-soft-25-seater-low-armrest-with-removable-cover-combination-1',      category: 'sofa' },
  { url: 'https://www.hay.com/hay/furniture/seating/sofa/mags-soft-25-seater-low-armrest-with-removable-cover-combination-3-left', category: 'sofa' },
  { url: 'https://www.hay.com/hay/furniture/seating/sofa/mags-soft-25-seater-low-armrest-with-removable-cover-combination-3-right',category: 'sofa' },
  { url: 'https://www.hay.com/hay/furniture/seating/sofa/mags-soft-3-seater-low-armrest-with-removable-cover-combination-1',       category: 'sofa' },
  { url: 'https://www.hay.com/hay/furniture/seating/sofa/mags-soft-3-seater-low-armrest-with-removable-cover-combination-4-left',  category: 'sofa' },
  { url: 'https://www.hay.com/hay/furniture/seating/sofa/mags-soft-3-seater-low-armrest-with-removable-cover-combination-4-right', category: 'sofa' },
  { url: 'https://www.hay.com/hay/furniture/seating/sofa/mags-soft-with-removable-cover-s01rc', category: 'sofa' },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function urlToSlug(url) {
  return url.split('/').pop();
}

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://www.hay.com/' },
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

function classifyImageType(url) {
  const l = url.toLowerCase();
  if (l.includes('brandlifestyle')) return 'lifestyle';
  if (l.includes('brandvariant'))   return 'variant';
  if (l.includes('brandmodel'))     return 'product';
  if (l.includes('detail'))         return 'detail';
  if (l.includes('group'))          return 'group';
  return 'product';
}

function baseUrl(url) { return url.split('?')[0]; }
function downloadUrl(url) { return baseUrl(url) + '?w=600'; }

// ── Page scraping ──────────────────────────────────────────────────────────────

async function scrapePage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(PAGE_WAIT_MS);

  return await page.evaluate(() => {
    const result = {
      name: null,
      description: null,
      dimensions: null,
      materials: null,
      designer: null,
      images: [],
    };

    // ── JSON-LD extraction ──────────────────────────────────────────────────
    const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
    const images  = new Set();

    for (const s of scripts) {
      try {
        const d = JSON.parse(s.textContent);

        if (d['@type'] === 'Product') {
          if (!result.name && d.name) result.name = d.name;
          if (!result.description && d.description) result.description = d.description;
          if (d.image) {
            const imgs = Array.isArray(d.image) ? d.image : [d.image];
            imgs.forEach(u => images.add(u));
          }
        }

        if (d['@type'] === 'ProductModel') {
          if (d.image) {
            const imgs = Array.isArray(d.image) ? d.image : [d.image];
            imgs.forEach(u => images.add(u));
          }
        }

        // BreadcrumbList for fallback name
        if (d['@type'] === 'BreadcrumbList' && d.itemListElement) {
          const last = d.itemListElement[d.itemListElement.length - 1];
          if (!result.name && last && last.name) result.name = last.name;
        }
      } catch (_) {}
    }

    result.images = [...images];

    // ── Dimensions from page ─────────────────────────────────────────────────
    // HAY puts dimensions in a table or a dl element with "Dimensions" label
    const allText = document.body.innerText;

    // Pattern: "W 50 x D 50 x H 45 cm" or "H45 x W45 x L45" or "Ø 70 x H 45"
    const dimPatterns = [
      /(?:Dimensions?|Size|Measurements?)\s*[:\s]\s*([^\n]{5,80}cm)/i,
      /([WHDLØwhdlø]\s*\d+(?:[.,]\d+)?\s*[x×]\s*[WHDLØwhdlø\s]*\d+(?:[.,]\d+)?(?:\s*[x×]\s*[WHDLØwhdlø\s]*\d+(?:[.,]\d+)?)?\s*(?:cm)?)/,
    ];
    for (const pat of dimPatterns) {
      const m = allText.match(pat);
      if (m) { result.dimensions = m[1] ? m[1].trim() : m[0].trim(); break; }
    }

    // ── Materials from page ──────────────────────────────────────────────────
    // Only extract if it looks like a comma-separated list of short material names (not prose)
    const matMatch = allText.match(/(?:^|\n)Materials?\s*:\s*([^\n]{3,80})/im);
    if (matMatch) {
      const mat = matMatch[1].trim();
      // Reject if it looks like prose (starts with lowercase connector or is a long sentence)
      if (!/^(and|or|the|with|in|for|a |an )/i.test(mat) && mat.split(',').length >= 1 && mat.length < 80) {
        result.materials = mat;
      }
    }

    // ── Designer ─────────────────────────────────────────────────────────────
    const desMatch = allText.match(/(?:Design(?:ed)? by|Designer)\s*[:\s]*([A-Z][a-zÀ-ÿ]+(?:\s+[A-Z][a-zÀ-ÿ]+){1,3})/);
    if (desMatch) result.designer = desMatch[1].trim();

    return result;
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== HAY New Products Scraper ===`);
  console.log(DRY_RUN ? '  DRY RUN — no DB writes\n' : `  EXECUTE mode${SKIP_EMBED ? ' (skip-embed)' : ''}\n`);

  // Check which slugs already exist
  const { rows: existing } = await pool.query(`
    SELECT slug FROM products WHERE brand_id = $1
  `, [HAY_BRAND_ID]);
  const existingSlugs = new Set(existing.map(r => r.slug));

  const toProcess = PRODUCTS_TO_SCRAPE.filter(p => {
    const slug = urlToSlug(p.url);
    if (existingSlugs.has(slug)) {
      console.log(`  ✓ already exists: ${slug}`);
      return false;
    }
    return true;
  });

  console.log(`\n${toProcess.length} products to insert (${PRODUCTS_TO_SCRAPE.length - toProcess.length} already in DB)\n`);

  if (toProcess.length === 0) {
    console.log('Nothing to do.');
    await pool.end();
    return;
  }

  // Load SigLIP model if embedding
  if (!DRY_RUN && !SKIP_EMBED) {
    console.log('Loading SigLIP model...');
    try {
      const warmBuf = await downloadImage('https://www.hay.com/favicon.ico').catch(() => Buffer.alloc(200));
      await siglipService.getImageEmbeddingFromBuffer(warmBuf).catch(() => {});
    } catch (_) {}
    console.log('Model ready\n');
  }

  const browser = await chromium.launch({ headless: true });
  let inserted = 0, failed = 0, totalEmbedded = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const entry = toProcess[i];
    const slug  = urlToSlug(entry.url);
    const prefix = `[${i + 1}/${toProcess.length}]`;
    console.log(`\n${prefix} ${slug}`);
    console.log(`  ${entry.url}`);

    const ctx  = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
    const page = await ctx.newPage();

    try {
      const data = await scrapePage(page, entry.url);

      const name = data.name || slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      console.log(`  name:       ${name}`);
      console.log(`  slug:       ${slug}`);
      console.log(`  designer:   ${data.designer || 'n/a'}`);
      console.log(`  dimensions: ${data.dimensions || 'n/a'}`);
      console.log(`  materials:  ${data.materials || 'n/a'}`);
      console.log(`  images:     ${data.images.length} in JSON-LD`);

      // ── Insert product ────────────────────────────────────────────────────
      let productId = null;

      if (!DRY_RUN) {
        const res = await pool.query(`
          INSERT INTO products (brand_id, name, slug, description, source_url, category, dimensions, materials, designer, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
          ON CONFLICT (brand_id, slug) DO UPDATE SET
            name = EXCLUDED.name,
            description = COALESCE(EXCLUDED.description, products.description),
            dimensions  = COALESCE(EXCLUDED.dimensions, products.dimensions),
            materials   = COALESCE(EXCLUDED.materials, products.materials),
            designer    = COALESCE(EXCLUDED.designer, products.designer),
            updated_at  = NOW()
          RETURNING id
        `, [
          HAY_BRAND_ID,
          name,
          slug,
          data.description,
          entry.url,
          entry.category,
          data.dimensions,
          data.materials,
          data.designer,
        ]);
        productId = res.rows[0].id;
        console.log(`  ✓ inserted/updated product id: ${productId}`);
        inserted++;
      } else {
        console.log(`  [DRY] would insert: ${name}`);
      }

      // ── Embed images ──────────────────────────────────────────────────────
      if (!DRY_RUN && !SKIP_EMBED && productId && data.images.length > 0) {
        const BASE_URL = 'https://www.hay.com';
        const allImages = data.images
          .map(u => (u.startsWith('http') ? u : BASE_URL + u))
          .map(u => baseUrl(u))
          .filter(u =>
            u.includes('/inriver/integration/service/') &&
            !u.includes('/blocks/brandsite/') &&
            !u.includes('logo') &&
            !u.includes('flag')
          );
        const unique = [...new Set(allImages)].slice(0, MAX_IMAGES);

        console.log(`  Embedding ${unique.length} images...`);
        for (const imgBase of unique) {
          const dlUrl    = downloadUrl(imgBase);
          const filename = imgBase.split('/').pop();
          const imgType  = classifyImageType(imgBase);
          try {
            const buf = await downloadImage(dlUrl);
            if (!buf || buf.length < 500) throw new Error('image too small');
            const embedding = await siglipService.getImageEmbeddingFromBuffer(buf);
            await pool.query(
              `INSERT INTO product_siglip_images (product_id, image_url, image_type, siglip_embedding)
               VALUES ($1, $2, $3, $4::vector) ON CONFLICT DO NOTHING`,
              [productId, dlUrl, imgType, `[${embedding.join(',')}]`]
            );
            console.log(`    ✓ [${imgType}] ${filename}`);
            totalEmbedded++;
          } catch (err) {
            console.log(`    ✗ ${filename}: ${err.message}`);
          }
        }
      }

    } catch (err) {
      console.log(`  ✗ FAILED: ${err.message}`);
      failed++;
    } finally {
      await page.close();
      await ctx.close();
      await new Promise(r => setTimeout(r, BETWEEN_MS));
    }
  }

  await browser.close();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(50)}`);
  if (DRY_RUN) {
    console.log('DRY RUN complete — run with --execute to apply');
  } else {
    console.log(`Inserted/updated: ${inserted}`);
    console.log(`Failed:           ${failed}`);
    console.log(`Images embedded:  ${totalEmbedded}`);

    const { rows: [coverage] } = await pool.query(`
      SELECT COUNT(DISTINCT p.id) total,
        SUM(CASE WHEN img_count >= 4 THEN 1 ELSE 0 END) good,
        SUM(CASE WHEN img_count BETWEEN 1 AND 3 THEN 1 ELSE 0 END) partial,
        SUM(CASE WHEN img_count = 0 THEN 1 ELSE 0 END) zero
      FROM (
        SELECT p.id, COUNT(psi.id) img_count
        FROM products p
        JOIN brands b ON b.id = p.brand_id
        LEFT JOIN product_siglip_images psi ON psi.product_id = p.id
        WHERE b.slug = 'hay'
        GROUP BY p.id
      ) sub
    `);
    console.log(`\nHAY coverage: ${coverage.total} products | ${coverage.good} good (≥4) | ${coverage.partial} partial | ${coverage.zero} zero`);
  }

  await pool.end();
}

main().catch(e => { console.error(e.message); pool.end(); });
