/**
 * Re-scrape the 15 new Muuto products that are missing image_url, dimensions, materials.
 * Muuto redesigned their product pages — new CDN (occtoo-media.com) and new accordion names.
 *
 * Usage: node scripts/rescrape-muuto-new-products.js
 */
require('dotenv').config();
const { chromium } = require('playwright');
const { pool } = require('../src/config/database');
const logger = require('../src/config/logger');

const PRODUCT_URLS = [
  'https://www.muuto.com/product/Ambit-Pendant-Cluster/',
  'https://www.muuto.com/product/Brink-Chair-Cantilever-Base/',
  'https://www.muuto.com/product/Brink-Chair-Wood-Base/',
  'https://www.muuto.com/product/Cluster-Canopy/',
  'https://www.muuto.com/product/Coltre-Modular-Sofa-8-Seater-Configurations/',
  'https://www.muuto.com/product/Coltre-Modular-Sofa-Modules/',
  'https://www.muuto.com/product/Contra-Floor-Lamp/',
  'https://www.muuto.com/product/Fiber-Soft-Lounge-Chair-Tube-Base/',
  'https://www.muuto.com/product/Fiber-Soft-Lounge-Chair-Wood-Base/',
  'https://www.muuto.com/product/Folded-Trolley/',
  'https://www.muuto.com/product/Rest-Corner-Sofa/',
  'https://www.muuto.com/product/Rest-Sofa-Chaise-Longue/',
  'https://www.muuto.com/product/Rime-Pendant-Cluster/',
  'https://www.muuto.com/product/Settle-Otoman/',
  'https://www.muuto.com/product/Verso-Rug/',
];

function slugFromUrl(url) {
  // e.g. ".../product/Contra-Floor-Lamp/" → "contra-floor-lamp"
  const match = url.match(/\/product\/(.+?)\/?$/);
  return match ? match[1].toLowerCase() : '';
}

function parseDimensions(text) {
  if (!text) return null;
  const patterns = [
    /(?:width|height|depth|length|diameter|W|H|D|L|Ø)\s*[:=]\s*[\d.,]+\s*(?:cm|mm|in|")/gi,
    /\d+[\s]*[xX×][\s]*\d+[\s]*(?:[xX×][\s]*\d+)?\s*(?:cm|mm|in)?/g,
  ];
  const matches = [];
  for (const pattern of patterns) {
    const found = text.match(pattern);
    if (found) matches.push(...found);
  }
  return matches.length > 0 ? [...new Set(matches)].join('; ') : null;
}

async function clickAccordion(page, label) {
  await page.evaluate((lbl) => {
    const buttons = document.querySelectorAll('button.accordion__trigger, button[class*="accordion"]');
    for (const btn of buttons) {
      if (btn.textContent.trim() === lbl) { btn.click(); return; }
    }
  }, label);
  await page.waitForTimeout(1000);
}

async function getAccordionContent(page, label) {
  return page.evaluate((lbl) => {
    const sections = document.querySelectorAll('.accordion');
    for (const sec of sections) {
      const trigger = sec.querySelector('.accordion__trigger, button');
      if (trigger && trigger.textContent.trim() === lbl) {
        const content = sec.querySelector('.accordion__content, [class*="accordion-content"]');
        return content ? content.textContent.trim() : null;
      }
    }
    return null;
  }, label);
}

async function scrapePage(page, url) {
  const slug = slugFromUrl(url);
  logger.info(`Scraping: ${url} (slug: ${slug})`);

  // domcontentloaded — Muuto site never reaches networkidle (continuous background requests)
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch (err) {
    logger.warn(`  Goto failed (${err.message}), retrying...`);
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });
  }
  await page.waitForTimeout(5000);

  // Scroll to trigger lazy-load
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let y = 0;
      const step = () => {
        window.scrollBy(0, 400);
        y += 400;
        if (y < document.body.scrollHeight) setTimeout(step, 80);
        else { window.scrollTo(0, 0); resolve(); }
      };
      step();
    });
  });
  await page.waitForTimeout(1500);

  // ── Image extraction ────────────────────────────────────────────────────────
  // New Muuto pages use cdn.occtoo-media.com. Find the first image whose src
  // contains the product slug (filename embedded in path).
  const imageUrl = await page.evaluate((productSlug) => {
    const imgs = Array.from(document.querySelectorAll('img[src]'));

    // 1. cdn.occtoo-media.com with product slug in URL (high-res preferred)
    const occtooWithSlug = imgs
      .filter(img =>
        img.src.includes('occtoo-media.com') &&
        img.src.toLowerCase().includes(productSlug) &&
        img.naturalWidth >= 500
      )
      .sort((a, b) => b.naturalWidth - a.naturalWidth);
    if (occtooWithSlug.length) return occtooWithSlug[0].src;

    // 2. Any occtoo-media.com image with decent resolution
    const occtooAny = imgs
      .filter(img => img.src.includes('occtoo-media.com') && img.naturalWidth >= 1000)
      .sort((a, b) => b.naturalWidth - a.naturalWidth);
    if (occtooAny.length) return occtooAny[0].src;

    // 3. Muuto CDN-CGI (Cloudflare image resize) with globalassets
    const cdnCgi = imgs.find(img =>
      img.src.includes('cdn-cgi/image') &&
      img.src.includes('globalassets') &&
      !img.src.includes('logo')
    );
    if (cdnCgi) return cdnCgi.src;

    // 4. Old CDN fallback
    const old = imgs.find(img =>
      img.src.includes('digitalassets') &&
      !img.src.includes('logo')
    );
    if (old) return old.src;

    return null;
  }, slug);

  // ── Expand accordions and collect content ───────────────────────────────────

  // New accordion names (Muuto redesign)
  await clickAccordion(page, 'Product description');
  const productDesc = await getAccordionContent(page, 'Product description');

  await clickAccordion(page, 'Product Material');
  const materialContent = await getAccordionContent(page, 'Product Material');

  // Old accordion names (fallback for products still on old layout)
  let productInfo = productDesc;
  if (!productInfo) {
    await clickAccordion(page, 'Product information');
    productInfo = await getAccordionContent(page, 'Product information');
  }

  let materialInfo = materialContent;
  if (!materialInfo) {
    await clickAccordion(page, 'Material information');
    materialInfo = await getAccordionContent(page, 'Material information');
  }

  // ── Description ─────────────────────────────────────────────────────────────
  // Prefer the accordion content (which is the real product description on new pages)
  let description = null;
  if (productDesc && productDesc.length > 40 &&
      !productDesc.startsWith('At Muuto, we aim') &&
      !productDesc.includes('take responsibility for our operations')) {
    description = productDesc.substring(0, 1000);
  } else {
    // DOM fallback
    description = await page.evaluate(() => {
      const selectors = [
        '.usp-spot__description',
        '[class*="product-description"]:not([class*="sustainability"])',
        '[class*="product-intro"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const t = el.textContent.trim();
          if (t.length > 40 && !t.startsWith('At Muuto, we aim')) return t.substring(0, 1000);
        }
      }
      return null;
    });
  }

  // ── Dimensions ──────────────────────────────────────────────────────────────
  // Parse from accordion content (spec tables are embedded in product description)
  const dimensions = parseDimensions(productInfo);

  // ── Materials ───────────────────────────────────────────────────────────────
  const materials = materialInfo ? materialInfo.substring(0, 600) : null;

  // ── Designer ────────────────────────────────────────────────────────────────
  const designer = await page.evaluate(() => {
    const allText = document.body.innerText;
    const match = allText.match(/Designer\s*\n\s*(.+?)(?:\n|$)/i);
    if (match) {
      const name = match[1].trim().split(/\s*\(/)[0].trim();
      return name.length < 100 ? name : null;
    }
    return null;
  });

  // ── PDF link ────────────────────────────────────────────────────────────────
  const pdfUrl = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    const factSheet = links.find(a => {
      const t = (a.textContent || '').toLowerCase();
      const h = (a.href || '').toLowerCase();
      return t.includes('fact sheet') || t.includes('product sheet') ||
             h.includes('fact-sheet') || h.includes('factsheet') || h.endsWith('.pdf');
    });
    if (factSheet) return factSheet.href;
    const ds = links.find(a => a.href && a.href.includes('digitalshowroom'));
    return ds ? ds.href : null;
  });

  return { imageUrl, description, dimensions, materials, designer, pdfUrl };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });

  const results = [];

  for (const url of PRODUCT_URLS) {
    const page = await context.newPage();
    try {
      const data = await scrapePage(page, url);
      results.push({ url, ...data });
      logger.info(`  image:  ${data.imageUrl ? 'YES → ' + data.imageUrl.substring(0, 70) : 'NO'}`);
      logger.info(`  dims:   ${data.dimensions || 'none'}`);
      logger.info(`  mats:   ${data.materials ? data.materials.substring(0, 60) + '...' : 'none'}`);
      logger.info(`  desc:   ${data.description ? data.description.substring(0, 60) + '...' : 'none'}`);
    } catch (err) {
      logger.error(`  FAILED: ${err.message}`);
      results.push({ url, error: err.message });
    } finally {
      await page.close();
    }
  }

  await browser.close();

  // ── Update DB ───────────────────────────────────────────────────────────────
  logger.info('\n========== UPDATING DB ==========');
  let updated = 0;
  let noChange = 0;

  for (const r of results) {
    if (r.error) { logger.warn(`Skipping ${r.url} (scrape failed)`); continue; }

    try {
      // Force-update all scraped fields (not just NULL ones — description may be wrong boilerplate)
      const sets = [];
      const vals = [];
      let idx = 1;

      if (r.imageUrl)   { sets.push(`image_url = $${idx++}`);   vals.push(r.imageUrl); }
      if (r.dimensions) { sets.push(`dimensions = $${idx++}`);  vals.push(r.dimensions); }
      if (r.materials)  { sets.push(`materials = $${idx++}`);   vals.push(r.materials); }
      if (r.description){ sets.push(`description = $${idx++}`); vals.push(r.description); }
      if (r.designer)   { sets.push(`designer = $${idx++}`);    vals.push(r.designer); }
      if (r.pdfUrl)     { sets.push(`pdf_url = $${idx++}`);     vals.push(r.pdfUrl); }

      if (sets.length === 0) {
        logger.warn(`Nothing to update for ${r.url}`);
        noChange++;
        continue;
      }

      vals.push(r.url);
      const { rowCount } = await pool.query(
        `UPDATE products SET ${sets.join(', ')} WHERE source_url = $${idx}`,
        vals
      );

      if (rowCount > 0) {
        updated++;
        const label = r.url.split('/product/')[1].replace(/\/$/, '');
        logger.info(`UPDATED: ${label}`);
      } else {
        noChange++;
        logger.warn(`No row matched source_url: ${r.url}`);
      }
    } catch (err) {
      logger.error(`DB update failed for ${r.url}: ${err.message}`);
    }
  }

  logger.info(`\nDone. Updated: ${updated}, No change: ${noChange}`);
  pool.end();
}

main().catch(err => {
  logger.error('Script failed:', err);
  pool.end();
  process.exit(1);
});
