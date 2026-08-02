require('dotenv').config();
const { chromium } = require('playwright');
const https = require('https');
const { pool } = require('../src/config/database');
const siglipService = require('../src/services/siglip-embedding.service');
const { toSql } = require('pgvector/pg');
const logger = require('../src/config/logger');

const MISSING = [
  { name: 'Settle Sofa w. Single Armrest 2-Seater', url: 'https://www.muuto.com/product/Settle-Sofa-w.-Single-Armrest-2-Seater/', category: 'sofas' },
  { name: 'Settle Sofa Corner Section',              url: 'https://www.muuto.com/product/Settle-Sofa-Corner-Section/',              category: 'sofas' },
  { name: 'Settle Sofa Corner Configurations',       url: 'https://www.muuto.com/product/Settle-Sofa-Corner-Configurations/',       category: 'sofas' },
  { name: 'Settle Sofa 3-Seater Configurations',     url: 'https://www.muuto.com/product/Settle-Sofa-3-Seater-Configurations/',     category: 'sofas' },
  { name: 'Rest Lounge Chair',                       url: 'https://www.muuto.com/product/Rest-Lounge-Chair/',                       category: 'sofas' },
  { name: 'Rest Sofa 3-Seater',                      url: 'https://www.muuto.com/product/Rest-Sofa-3-Seater/',                      category: 'sofas' },
  { name: 'Relevo Quattro Rug',                      url: 'https://www.muuto.com/product/Relevo-Quattro-Rug/',                      category: 'accessories' },
  { name: 'Top Pendant Cluster',                     url: 'https://www.muuto.com/product/Top-Pendant-Cluster/',                     category: 'lighting' },
  { name: 'E27 Pendant Cluster',                     url: 'https://www.muuto.com/product/E27-Pendant-Cluster/',                     category: 'lighting' },
  { name: 'Coltre Modular Sofa 2-Seater Configurations', url: 'https://www.muuto.com/product/Coltre-Modular-Sofa-2-Seater-Configurations/', category: 'sofas' },
  { name: 'Coltre Modular Sofa 3-Seater Configurations', url: 'https://www.muuto.com/product/Coltre-Modular-Sofa-3-Seater-Configurations/', category: 'sofas' },
  { name: 'Coltre Modular Sofa 4-Seater Configurations', url: 'https://www.muuto.com/product/Coltre-Modular-Sofa-4-Seater-Configurations/', category: 'sofas' },
  { name: 'Coltre Modular Sofa 6-Seater Configurations', url: 'https://www.muuto.com/product/Coltre-Modular-Sofa-6-Seater-Configurations/', category: 'sofas' },
  { name: 'Coltre Modular Sofa 7-Seater Configurations', url: 'https://www.muuto.com/product/Coltre-Modular-Sofa-7-Seater-Configurations/', category: 'sofas' },
  { name: 'Coltre Modular Sofa 8-Seater Configurations', url: 'https://www.muuto.com/product/Coltre-Modular-Sofa-8-Seater-Configurations/', category: 'sofas' },
  { name: 'Coltre Modular Sofa Armrest Cushion',         url: 'https://www.muuto.com/product/Coltre-Modular-Sofa-Armrest-Cushion/',         category: 'sofas' },
  { name: 'Coltre Modular Sofa Corner Configurations',   url: 'https://www.muuto.com/product/Coltre-Modular-Sofa-Corner-Configurations/',   category: 'sofas' },
  { name: 'Brink Chair A-Base',                     url: 'https://www.muuto.com/product/Brink-Chair-A-Base/',                      category: 'chairs' },
];

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  return await page.evaluate((pageUrl) => {
    // Name
    const nameEl = document.querySelector('.product-line__product-name, .product-configurator__name');
    let name = nameEl ? nameEl.textContent.trim() : null;
    if (!name) {
      const title = document.title;
      name = title.includes('|') ? title.split('|')[0].trim() : null;
    }

    // Variant subtitle
    const variantEl = document.querySelector('.product-line__variant-name, .product-configurator__variant, .product-configurator__variant-name, [class*="variant-name"]');
    const variant = variantEl ? variantEl.textContent.trim() : null;

    // Open accordions
    const click = (labels) => {
      document.querySelectorAll('button.accordion__trigger').forEach(btn => {
        if (labels.includes(btn.textContent.trim())) btn.click();
      });
    };
    click(['Product information', 'Product description']);
    click(['Material information', 'Product Material']);

    // Read accordion content
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

    const productInfo = getAccordion(['Product information', 'Product description']);
    const materialInfo = getAccordion(['Material information', 'Product Material']);

    // Image - prefer occtoo-media CDN, fallback to azurefd/digitalassets
    const imgs = Array.from(document.querySelectorAll('img[src]'));
    const slug = (pageUrl.match(/\/product\/(.+?)\/?$/) || [])[1]?.toLowerCase() || '';
    let imageUrl = null;
    const occtooSlug = imgs.filter(i => i.src.includes('occtoo-media.com') && i.src.toLowerCase().includes(slug) && i.naturalWidth >= 500).sort((a,b)=>b.naturalWidth-a.naturalWidth);
    if (occtooSlug.length) imageUrl = occtooSlug[0].src;
    if (!imageUrl) {
      const occtooAny = imgs.filter(i => i.src.includes('occtoo-media.com') && i.naturalWidth >= 1000).sort((a,b)=>b.naturalWidth-a.naturalWidth);
      if (occtooAny.length) imageUrl = occtooAny[0].src;
    }
    if (!imageUrl) {
      const old = imgs.find(i => i.src.includes('digitalassets') && !i.src.includes('logo') && i.naturalWidth > 100);
      if (old) imageUrl = old.src;
    }

    return { name, variant, productInfo, materialInfo, imageUrl };
  }, url);
}

async function main() {
  const { rows: brandRows } = await pool.query(`SELECT id FROM brands WHERE slug='muuto' LIMIT 1`);
  const brandId = brandRows[0].id;

  const browser = await chromium.launch({ headless: true });
  let added = 0, failed = [];

  for (const product of MISSING) {
    logger.info(`\nScraping: ${product.name}`);
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' });
    const page = await ctx.newPage();

    try {
      const data = await scrapePage(page, product.url);

      // Wait for accordions to open then re-read
      await page.waitForTimeout(1500);
      const data2 = await page.evaluate(() => {
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
          productInfo: getAccordion(['Product information', 'Product description']),
          materialInfo: getAccordion(['Material information', 'Product Material']),
        };
      });

      const productInfo = data2.productInfo || data.productInfo;
      const materialInfo = data2.materialInfo || data.materialInfo;
      const imageUrl = data.imageUrl;

      // Parse dimensions from product info
      let dimensions = null;
      if (productInfo) {
        const matches = [];
        const patterns = [
          /(?:width|height|depth|length|diameter|W|H|D|L|Ø)\s*[:=]\s*[\d.,]+\s*(?:cm|mm)/gi,
          /\d+[\s]*[xX×][\s]*\d+(?:[\s]*[xX×][\s]*\d+)?\s*(?:cm|mm)?/g
        ];
        for (const p of patterns) {
          const found = productInfo.match(p);
          if (found) matches.push(...found);
        }
        if (matches.length) dimensions = matches.join('; ');
      }

      const description = productInfo && productInfo.length > 40 && !productInfo.startsWith('At Muuto, we aim')
        ? productInfo.substring(0, 1000) : null;
      const materials = materialInfo ? materialInfo.substring(0, 500) : null;
      const slug = slugify(product.name);

      // Insert product
      const { rows: existing } = await pool.query(
        `SELECT id FROM products WHERE source_url=$1 OR (name=$2 AND brand_id=$3)`,
        [product.url, product.name, brandId]
      );
      if (existing.length > 0) {
        logger.info(`  Already exists — skipping`);
        continue;
      }

      const { rows: inserted } = await pool.query(
        `INSERT INTO products (brand_id, name, slug, description, dimensions, materials, image_url, source_url, category)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [brandId, product.name, slug, description, dimensions, materials, imageUrl, product.url, product.category]
      );
      const productId = inserted[0].id;
      logger.info(`  Inserted: ${product.name} (${product.category})`);
      logger.info(`  image_url: ${imageUrl ? imageUrl.substring(0,80) : 'none'}`);
      logger.info(`  dimensions: ${dimensions || 'none'}`);

      // Generate SigLIP embedding if image available
      if (imageUrl) {
        try {
          const buf = await downloadImage(imageUrl);
          const emb = await siglipService.getImageEmbeddingFromBuffer(buf);
          await pool.query(
            `INSERT INTO product_siglip_images (product_id, image_url, image_type, siglip_embedding)
             VALUES ($1,$2,'product',$3::vector) ON CONFLICT DO NOTHING`,
            [productId, imageUrl, `[${emb.join(',')}]`]
          );
          logger.info(`  SigLIP embedding generated`);
        } catch (e) { logger.warn(`  SigLIP failed: ${e.message}`); }
      }

      added++;
    } catch (err) {
      logger.warn(`  FAILED: ${err.message}`);
      failed.push(product.name);
    } finally {
      await page.close();
      await ctx.close();
    }
  }

  await browser.close();
  logger.info(`\n=== Done: ${added} added, ${failed.length} failed ===`);
  if (failed.length) logger.info(`Failed: ${failed.join(', ')}`);
  await pool.end();
}

main().catch(err => { logger.error('Fatal:', err); pool.end(); process.exit(1); });
