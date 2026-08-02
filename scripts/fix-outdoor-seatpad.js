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

async function main() {
  const url = 'https://www.muuto.com/product/Linear-Steel-Lounge-Chair-Seat-Pad/';
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
  const page = await ctx.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
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
        const t = s.querySelector('.accordion__trigger');
        if (t && labels.includes(t.textContent.trim()))
          return s.querySelector('.accordion__content')?.textContent?.trim() || null;
      }
      return null;
    };
    return { isEmpty, productInfo: get(['Product description', 'Product information']), materialInfo: get(['Product Material', 'Material information']) };
  });

  await browser.close();

  if (data.isEmpty) { logger.warn('BLANK page'); await pool.end(); return; }

  const dims = parseDimensions(data.productInfo);
  logger.info(`dims: ${dims || 'none on page'}`);

  const { rows } = await pool.query(
    `SELECT p.id FROM products p JOIN brands b ON b.id=p.brand_id WHERE b.slug='muuto' AND p.name='Linear Steel Chair/Lounge Chair Seat Pad'`
  );
  if (!rows.length) { logger.warn('Not found in DB'); await pool.end(); return; }

  await pool.query(
    `UPDATE products SET source_url=$1, dimensions=COALESCE($2,dimensions), materials=COALESCE($3,materials), updated_at=NOW() WHERE id=$4`,
    [url, dims, data.materialInfo?.substring(0, 500) || null, rows[0].id]
  );
  logger.info('✓ Updated');
  await pool.end();
}

main().catch(err => { logger.error('Fatal:', err); pool.end(); process.exit(1); });
