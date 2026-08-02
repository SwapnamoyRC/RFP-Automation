require('dotenv').config();
const { chromium } = require('playwright');
const { pool } = require('../src/config/database');
const logger = require('../src/config/logger');

const DELETE_NAMES = [
  'Avail Coat Hook',
  'Cable Management Solution',
  'Chair Hanger',
  'Color Card',
  'Mini Stacked Storage System Wall Mount',
  'Stacked Storage System Acoustic Panel - Aqua Mélange - Medium',
];

const UPDATE_TARGETS = [
  { name: 'Cover and Visu Chair Transport Trolley',           url: 'https://www.muuto.com/product/Transport-Trolley--COVTRO/COVTRO01/' },
  { name: 'Midst Power Units',                                url: 'https://www.muuto.com/product/Power-Units--PWCENCFG/PWCENCFGUS01V1/' },
  { name: 'Mini Stacked Storage System Shelving - Configuration 8', url: 'https://www.muuto.com/product/Mini-Stacked-Storage-System--MSTMBBLR/MSTMBBLR03/' },
];

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

async function main() {
  // 1. Delete discontinued products
  logger.info('Deleting discontinued products...');
  for (const name of DELETE_NAMES) {
    const { rows } = await pool.query(
      `SELECT p.id FROM products p JOIN brands b ON b.id=p.brand_id WHERE b.slug='muuto' AND p.name=$1`, [name]
    );
    for (const r of rows) {
      await pool.query(`DELETE FROM product_siglip_images WHERE product_id=$1`, [r.id]);
      await pool.query(`DELETE FROM products WHERE id=$1`, [r.id]);
    }
    logger.info(`  ✓ Deleted: ${name}`);
  }

  // 2. Update and scrape the 3 with correct URLs
  logger.info('\nUpdating 3 products with new URLs...');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });

  for (const t of UPDATE_TARGETS) {
    logger.info(`\n${t.name}`);
    const page = await ctx.newPage();
    try {
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      await page.evaluate(() => {
        ['Product description', 'Product information', 'Product Material', 'Material information'].forEach(label => {
          document.querySelectorAll('button.accordion__trigger').forEach(btn => {
            if (btn.textContent.trim() === label) btn.click();
          });
        });
      });
      await page.waitForTimeout(2000);

      const data = await page.evaluate(() => {
        const isEmpty = (document.body?.innerText || '').trim().length < 100;
        const get = (labels) => {
          for (const s of document.querySelectorAll('.accordion')) {
            const tr = s.querySelector('.accordion__trigger');
            if (tr && labels.includes(tr.textContent.trim()))
              return s.querySelector('.accordion__content')?.textContent?.trim() || null;
          }
          return null;
        };
        return { isEmpty, productInfo: get(['Product description', 'Product information']), materialInfo: get(['Product Material', 'Material information']) };
      });

      if (data.isEmpty) { logger.warn('  Still blank'); continue; }

      const dims = parseDimensions(data.productInfo);
      logger.info(`  dims: ${dims || 'none on page'}`);

      const { rows } = await pool.query(
        `SELECT p.id FROM products p JOIN brands b ON b.id=p.brand_id WHERE b.slug='muuto' AND p.name=$1`, [t.name]
      );
      if (!rows.length) { logger.warn('  Not found in DB'); continue; }

      await pool.query(
        `UPDATE products SET source_url=$1, dimensions=COALESCE($2,dimensions), materials=COALESCE($3,materials), updated_at=NOW() WHERE id=$4`,
        [t.url, dims, data.materialInfo?.substring(0, 500) || null, rows[0].id]
      );
      logger.info('  ✓ Updated');
    } catch (err) {
      logger.warn(`  FAILED: ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await ctx.close();
  await browser.close();

  // 3. Final tally
  const { rows: rem } = await pool.query(`
    SELECT p.name FROM products p JOIN brands b ON b.id=p.brand_id
    WHERE b.slug='muuto' AND (p.category IS NULL OR p.category='')
      AND (p.dimensions IS NULL OR p.dimensions='')
    ORDER BY p.name
  `);
  logger.info(`\nUncategorized still without dims (${rem.length}):`);
  rem.forEach(r => logger.info(`  - ${r.name}`));

  await pool.end();
}

main().catch(err => { logger.error('Fatal:', err); pool.end(); process.exit(1); });
