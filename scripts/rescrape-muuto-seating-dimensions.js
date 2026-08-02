require('dotenv').config();
const { chromium } = require('playwright');
const { pool } = require('../src/config/database');
const logger = require('../src/config/logger');

function parseDimensions(text) {
  if (!text) return null;
  const patterns = [
    /(?:seat\s+height|seat\s+depth|seat\s+width|back\s+height|arm\s+height|width|height|depth|length|diameter|W|H|D|L|Ø)\s*[:=]\s*[\d.,]+\s*(?:cm|mm)/gi,
    /\d+[\s]*[xX×][\s]*\d+[\s]*(?:[xX×][\s]*\d+)?\s*(?:cm|mm)/g
  ];
  const seen = new Set();
  const matches = [];
  for (const pattern of patterns) {
    const found = text.match(pattern);
    if (found) {
      for (const m of found) {
        const key = m.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!seen.has(key)) { seen.add(key); matches.push(m.trim()); }
      }
    }
  }
  return matches.length > 0 ? matches.join('; ') : null;
}

async function scrapeProduct(page, sourceUrl) {
  await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Click all relevant accordions
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
        if (trigger && labels.includes(trigger.textContent.trim())) {
          const content = section.querySelector('.accordion__content');
          return content ? content.textContent.trim() : null;
        }
      }
      return null;
    };
    return {
      productInfo: getAccordion(['Product description', 'Product information']),
      materialInfo: getAccordion(['Product Material', 'Material information']),
    };
  });
}

async function main() {
  // Get all seating products with no dimensions
  const { rows: products } = await pool.query(
    `SELECT p.id, p.name, p.source_url, p.dimensions, p.materials
     FROM products p
     JOIN brands b ON b.id=p.brand_id
     WHERE b.slug='muuto'
       AND p.category='seating'
       AND (p.dimensions IS NULL OR p.dimensions = '')
     ORDER BY p.name`
  );

  logger.info(`Found ${products.length} seating products with no dimensions`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
  });

  let updated = 0, noDim = [], failed = [];

  for (const product of products) {
    logger.info(`\n[${products.indexOf(product) + 1}/${products.length}] ${product.name}`);
    const page = await ctx.newPage();

    try {
      const data = await scrapeProduct(page, product.source_url);
      const dimensions = parseDimensions(data.productInfo);
      const materials = data.materialInfo ? data.materialInfo.substring(0, 500) : product.materials;

      if (dimensions) {
        await pool.query(
          `UPDATE products SET dimensions=$1, materials=COALESCE($2, materials), updated_at=NOW() WHERE id=$3`,
          [dimensions, materials, product.id]
        );
        logger.info(`  ✓ dimensions: ${dimensions}`);
        updated++;
      } else {
        logger.warn(`  ✗ no dimensions found in accordion text`);
        if (data.productInfo) logger.warn(`    accordion content: ${data.productInfo.substring(0, 200)}`);
        noDim.push({ name: product.name, url: product.source_url, content: data.productInfo?.substring(0, 300) });
      }

      // Update materials even if no dimensions
      if (!dimensions && materials && !product.materials) {
        await pool.query(`UPDATE products SET materials=$1, updated_at=NOW() WHERE id=$2`, [materials, product.id]);
      }
    } catch (err) {
      logger.warn(`  ✗ FAILED: ${err.message}`);
      failed.push(product.name);
    } finally {
      await page.close();
    }
  }

  await ctx.close();
  await browser.close();

  logger.info(`\n=== SEATING RESCRAPE DONE ===`);
  logger.info(`Updated: ${updated}/${products.length}`);

  if (noDim.length) {
    logger.info(`\nNo dimension data found for ${noDim.length} products:`);
    noDim.forEach(p => {
      logger.info(`  - ${p.name}`);
      if (p.content) logger.info(`    preview: ${p.content.substring(0, 120)}`);
    });
  }

  if (failed.length) {
    logger.info(`\nFailed to scrape: ${failed.length}`);
    failed.forEach(n => logger.info(`  - ${n}`));
  }

  await pool.end();
}

main().catch(err => { logger.error('Fatal:', err); pool.end(); process.exit(1); });
