require('dotenv').config();
const { chromium } = require('playwright');
const { pool } = require('../src/config/database');
const logger = require('../src/config/logger');

const DELETE_NAMES = [
  '70/70 Outdoor Table',
  'Base Round Table With Castors',
  'Base Table With Castors',
  'Linear System Power Starter Kit',
];

const POWER_KIT_URL = 'https://www.muuto.com/product/Power-Kit--PWKITA/PWKITAEU01/';

function parseDimensions(text) {
  if (!text) return null;
  const patterns = [
    /(?:width|height|depth|length|diameter|weight)\s*[:=]\s*[\d.,]+\s*(?:cm|mm|kg)/gi,
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
      `SELECT p.id FROM products p JOIN brands b ON b.id=p.brand_id WHERE b.slug='muuto' AND p.name=$1`,
      [name]
    );
    for (const r of rows) {
      await pool.query(`DELETE FROM product_siglip_images WHERE product_id=$1`, [r.id]);
      await pool.query(`DELETE FROM products WHERE id=$1`, [r.id]);
    }
    logger.info(`  ✓ Deleted: ${name}`);
  }

  // 2. Update Power Extension Kit with correct URL and scrape
  logger.info(`\nUpdating Power Extension Kit → ${POWER_KIT_URL}`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
  const page = await ctx.newPage();

  await page.goto(POWER_KIT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
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
    const get = (labels) => {
      for (const s of document.querySelectorAll('.accordion')) {
        const t = s.querySelector('.accordion__trigger');
        if (t && labels.includes(t.textContent.trim()))
          return s.querySelector('.accordion__content')?.textContent?.trim() || null;
      }
      return null;
    };
    return {
      isEmpty: (document.body?.innerText || '').trim().length < 100,
      productInfo: get(['Product description', 'Product information']),
      materialInfo: get(['Product Material', 'Material information']),
    };
  });

  if (data.isEmpty) {
    logger.warn('  Power Kit page still blank');
  } else {
    const dims = parseDimensions(data.productInfo);
    logger.info(`  dims: ${dims || 'none on page'}`);
    const { rows } = await pool.query(
      `SELECT p.id FROM products p JOIN brands b ON b.id=p.brand_id WHERE b.slug='muuto' AND p.name='Power Extension Kit'`
    );
    if (rows.length) {
      await pool.query(
        `UPDATE products SET source_url=$1, dimensions=COALESCE($2,dimensions), materials=COALESCE($3,materials), updated_at=NOW() WHERE id=$4`,
        [POWER_KIT_URL, dims, data.materialInfo?.substring(0,500)||null, rows[0].id]
      );
      logger.info('  ✓ Updated source_url');
    }
  }

  await page.close(); await ctx.close(); await browser.close();

  // 3. Final tally
  const { rows: rem } = await pool.query(`
    SELECT p.name FROM products p JOIN brands b ON b.id=p.brand_id
    WHERE b.slug='muuto' AND p.category='tables' AND (p.dimensions IS NULL OR p.dimensions='')
    ORDER BY p.name
  `);
  logger.info(`\nTables still without dims (${rem.length}):`);
  rem.forEach(r => logger.info(`  - ${r.name}`));

  await pool.end();
}

main().catch(err => { logger.error('Fatal:', err); pool.end(); process.exit(1); });
