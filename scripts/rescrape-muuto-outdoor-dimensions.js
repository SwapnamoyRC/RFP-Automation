require('dotenv').config();
const { chromium } = require('playwright');
const { pool } = require('../src/config/database');
const logger = require('../src/config/logger');

function parseDimensions(text) {
  if (!text) return null;
  const patterns = [
    /(?:cord\s+length|seat\s+height|seat\s+depth|width|height|depth|length|diameter|weight)\s*[:=]\s*[\d.,]+\s*(?:cm|mm|kg)/gi,
    /\d+[\s]*[xX×][\s]*\d+[\s]*(?:[xX×][\s]*\d+)?\s*(?:cm|mm)/g,
  ];
  const seen = new Set(); const matches = [];
  for (const p of patterns) {
    const found = text.match(p);
    if (found) for (const m of found) {
      const key = m.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!seen.has(key)) { seen.add(key); matches.push(m.trim()); }
    }
  }
  return matches.length > 0 ? matches.join('; ') : null;
}

async function scrapePage(page, sourceUrl) {
  await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const LABELS = ['Product description', 'Product information', 'Product Material', 'Material information'];
    document.querySelectorAll('button.accordion__trigger').forEach(btn => {
      if (LABELS.includes(btn.textContent.trim())) btn.click();
    });
  });
  await page.waitForTimeout(2000);
  return await page.evaluate(() => {
    const getAccordion = (labels) => {
      for (const section of document.querySelectorAll('.accordion')) {
        const trigger = section.querySelector('.accordion__trigger');
        if (trigger && labels.includes(trigger.textContent.trim()))
          return section.querySelector('.accordion__content')?.textContent?.trim() || null;
      }
      return null;
    };
    return {
      productInfo: getAccordion(['Product description', 'Product information']),
      materialInfo: getAccordion(['Product Material', 'Material information']),
      isEmpty: (document.body?.innerText || '').trim().length < 100,
    };
  });
}

async function main() {
  const { rows: products } = await pool.query(`
    SELECT p.id, p.name, p.source_url FROM products p
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'muuto' AND p.category = 'outdoor'
      AND (p.dimensions IS NULL OR p.dimensions = '')
    ORDER BY p.name
  `);

  logger.info(`Scraping ${products.length} outdoor products missing dims...\n`);
  products.forEach(p => logger.info(`  - ${p.name}  →  ${p.source_url}`));
  logger.info('');

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  });

  let updated = 0, blank = 0, noDims = 0;
  const blankPages = [], noDimsProducts = [];

  for (const product of products) {
    logger.info(`${product.name}`);
    const page = await ctx.newPage();
    try {
      const data = await scrapePage(page, product.source_url);

      if (data.isEmpty) {
        logger.warn(`  → BLANK PAGE`);
        blankPages.push({ name: product.name, url: product.source_url });
        blank++;
        continue;
      }

      const dimensions = parseDimensions(data.productInfo);
      const materials = data.materialInfo?.substring(0, 500) || null;

      if (!dimensions) {
        logger.info(`  → no dimensions found on page`);
        noDimsProducts.push(product.name);
        noDims++;
      } else {
        await pool.query(
          `UPDATE products SET dimensions=$1, materials=COALESCE($2, materials), updated_at=NOW() WHERE id=$3`,
          [dimensions, materials, product.id]
        );
        logger.info(`  ✓ ${dimensions}`);
        updated++;
      }
    } catch (err) {
      logger.warn(`  FAILED: ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await ctx.close();
  await browser.close();

  logger.info(`\n=== Results ===`);
  logger.info(`Updated:         ${updated}`);
  logger.info(`Blank pages:     ${blank}`);
  logger.info(`No dims on site: ${noDims}`);

  if (blankPages.length) {
    logger.info(`\nBlank pages (need new URLs or deletion):`);
    blankPages.forEach(p => logger.info(`  - ${p.name}\n    ${p.url}`));
  }
  if (noDimsProducts.length) {
    logger.info(`\nNo dims on Muuto site:`);
    noDimsProducts.forEach(n => logger.info(`  - ${n}`));
  }

  await pool.end();
}

main().catch(err => { logger.error('Fatal:', err); pool.end(); process.exit(1); });
