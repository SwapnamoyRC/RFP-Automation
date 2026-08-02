require('dotenv').config();
const { chromium } = require('playwright');
const { pool } = require('../src/config/database');
const siglipService = require('../src/services/siglip-embedding.service');
const logger = require('../src/config/logger');

// Update existing DB entries with new URLs + fresh scrape
const TARGETS = [
  { dbName: 'Attach Coat Hook',       url: 'https://www.muuto.com/product/Attach-Coat-Hook/' },
  { dbName: 'Dots Metal',             url: 'https://www.muuto.com/product/Dots-Metal/' },
  { dbName: 'Corky Glasses Set of 4', url: 'https://www.muuto.com/product/Corky-Glasses/', nameIlike: true },
];

function parseDimensions(text) {
  if (!text) return null;
  const patterns = [
    /(?:seat\s+height|seat\s+depth|width|height|depth|length|diameter|weight)\s*[:=]\s*[\d.,]+\s*(?:cm|mm|kg)/gi,
    /\d+[\s]*[xX×][\s]*\d+[\s]*(?:[xX×][\s]*\d+)?\s*(?:cm|mm)/g,
  ];
  const seen = new Set();
  const matches = [];
  for (const p of patterns) {
    const found = text.match(p);
    if (found) for (const m of found) {
      const key = m.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!seen.has(key)) { seen.add(key); matches.push(m.trim()); }
    }
  }
  return matches.length > 0 ? matches.join('; ') : null;
}

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? require('https') : require('http');
    lib.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
  });
}

async function scrapePage(page, url) {
  const occtooUrls = [];
  page.on('request', req => {
    const u = req.url();
    if (u.includes('occtoo-media.com') && !u.toLowerCase().includes('stregtegn')) occtooUrls.push(u.split('?')[0]);
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const LABELS = ['Product description', 'Product information', 'Product Material', 'Material information'];
    document.querySelectorAll('button.accordion__trigger').forEach(btn => {
      if (LABELS.includes(btn.textContent.trim())) btn.click();
    });
  });
  await page.waitForTimeout(2000);
  const data = await page.evaluate(() => {
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
  return { ...data, imageUrl: occtooUrls.length ? occtooUrls[0] : null };
}

async function main() {
  const { rows: brandRows } = await pool.query(`SELECT id FROM brands WHERE slug='muuto' LIMIT 1`);
  const brandId = brandRows[0].id;

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  });

  for (const target of TARGETS) {
    logger.info(`\n${target.dbName} → ${target.url}`);
    const page = await ctx.newPage();
    try {
      const data = await scrapePage(page, target.url);
      if (data.isEmpty) { logger.warn(`  BLANK PAGE`); continue; }

      const dimensions = parseDimensions(data.productInfo);
      const materials  = data.materialInfo?.substring(0, 500) || null;
      const description = data.productInfo?.length > 40 ? data.productInfo.substring(0, 1000) : null;

      logger.info(`  dims:  ${dimensions || 'none'}`);
      logger.info(`  image: ${data.imageUrl ? data.imageUrl.split('/').pop() : 'none'}`);

      // Lookup existing product
      const lookup = target.nameIlike
        ? await pool.query(`SELECT p.id, p.image_url FROM products p JOIN brands b ON b.id=p.brand_id WHERE b.slug='muuto' AND p.name ILIKE $1`, [target.dbName])
        : await pool.query(`SELECT p.id, p.image_url FROM products p JOIN brands b ON b.id=p.brand_id WHERE b.slug='muuto' AND p.name=$1`, [target.dbName]);

      if (!lookup.rows.length) { logger.warn(`  Not found in DB`); continue; }
      const { id, image_url: existingImage } = lookup.rows[0];

      const newImage = data.imageUrl || existingImage;
      await pool.query(
        `UPDATE products SET
           source_url=$1,
           dimensions=COALESCE($2, dimensions),
           materials=COALESCE($3, materials),
           description=COALESCE(NULLIF(description,''), $4),
           image_url=$5,
           updated_at=NOW()
         WHERE id=$6`,
        [target.url, dimensions, materials, description, newImage, id]
      );
      logger.info(`  ✓ DB updated`);

      // SigLIP — regenerate if we got a new image
      if (data.imageUrl) {
        try {
          await pool.query(`DELETE FROM product_siglip_images WHERE product_id=$1`, [id]);
          const buf = await downloadImage(data.imageUrl);
          const emb = await siglipService.getImageEmbeddingFromBuffer(buf);
          await pool.query(
            `INSERT INTO product_siglip_images (product_id, image_url, image_type, siglip_embedding)
             VALUES ($1,$2,'product',$3::vector) ON CONFLICT DO NOTHING`,
            [id, data.imageUrl, `[${emb.join(',')}]`]
          );
          logger.info(`  ✓ SigLIP generated`);
        } catch (e) { logger.warn(`  SigLIP failed: ${e.message}`); }
      }
    } catch (err) {
      logger.warn(`  FAILED: ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await ctx.close();
  await browser.close();
  await pool.end();
  logger.info('\nDone.');
}

main().catch(err => { logger.error('Fatal:', err); pool.end(); process.exit(1); });
