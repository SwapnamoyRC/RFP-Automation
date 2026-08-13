/**
 * Scrape dimensions + materials for new HAY products by:
 *  1. Visiting each product's source_url
 *  2. Finding variant sub-page links from the page
 *  3. Visiting the first variant page
 *  4. Extracting SIZE / SHELL / FRAME / SEAT / COVER / COLOR etc.
 *  5. Storing SIZE → dimensions, other fields → materials
 *
 * Usage:
 *   node scripts/scrape-hay-dimensions.js          # dry run
 *   node scripts/scrape-hay-dimensions.js --execute
 */
require('dotenv').config();
const { chromium } = require('playwright');
const { pool } = require('../src/config/database');

const EXECUTE   = process.argv.includes('--execute');
const PAGE_WAIT = 3500;

// Labels we want to capture (case-insensitive)
const MATERIAL_LABELS = ['shell','frame','seat','back','cover','upholstery','base','legs','tabletop','top','armrest','cushion','fabric','color','colour','finish','leg'];

async function getVariantUrls(page, productUrl) {
  // Look for <a> tags whose href starts with the product URL path (i.e. variant sub-pages)
  const variants = await page.evaluate((base) => {
    const links = [...document.querySelectorAll('a[href]')];
    const baseSlug = base.split('/').pop(); // e.g. "pack-chair-10"
    return links
      .map(a => a.href)
      .filter(href =>
        href.includes(baseSlug + '-') &&   // variant URL extends the slug
        !href.includes('#') &&
        !href.includes('?')
      );
  }, productUrl);

  // Deduplicate and return
  return [...new Set(variants)];
}

async function scrapeVariantSpecs(page, variantUrl) {
  await page.goto(variantUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(PAGE_WAIT);

  return await page.evaluate((materialLabels) => {
    const result = { size: null, materials: {} };

    // HAY renders specs as label + value pairs in the DOM.
    // Look for text nodes that match known labels, then grab their sibling/parent text.

    // Strategy 1: find elements whose text is a known label, get the next sibling text
    const allElements = [...document.querySelectorAll('p, dt, span, div, h3, h4, strong, label')];

    for (const el of allElements) {
      const text = (el.innerText || el.textContent || '').trim();
      const upper = text.toUpperCase();

      if (upper === 'SIZE:' || upper === 'SIZE') {
        // Next sibling or next element
        const next = el.nextElementSibling || el.parentElement?.nextElementSibling;
        if (next) result.size = next.innerText?.trim() || next.textContent?.trim();
      }

      for (const label of materialLabels) {
        if (upper === label.toUpperCase() + ':' || upper === label.toUpperCase()) {
          const next = el.nextElementSibling || el.parentElement?.nextElementSibling;
          if (next) {
            const val = next.innerText?.trim() || next.textContent?.trim();
            if (val && val.length < 100) result.materials[label] = val;
          }
        }
      }
    }

    // Strategy 2: scan full page text for "LABEL:\nVALUE" patterns
    if (!result.size) {
      const bodyText = document.body.innerText;
      const sizeMatch = bodyText.match(/SIZE[:\s]+([HWLDØhwldø\s\d.,x×\/]+(?:cm)?)/i);
      if (sizeMatch) result.size = sizeMatch[1].trim().replace(/\n+/g, ' ');
    }

    // Strategy 3: look for a definition list (dl > dt/dd)
    const dts = [...document.querySelectorAll('dt')];
    for (const dt of dts) {
      const label = (dt.innerText || '').trim().toUpperCase().replace(':', '');
      const dd = dt.nextElementSibling;
      if (!dd) continue;
      const val = (dd.innerText || '').trim();
      if (label === 'SIZE') result.size = val;
      else if (materialLabels.includes(label.toLowerCase())) result.materials[label.toLowerCase()] = val;
    }

    return result;
  }, MATERIAL_LABELS);
}

async function main() {
  console.log(`=== HAY Dimensions Scraper ===`);
  console.log(EXECUTE ? '  EXECUTE mode\n' : '  DRY run\n');

  // Get new products without dimensions
  const { rows: products } = await pool.query(`
    SELECT pr.id, pr.name, pr.source_url, pr.dimensions, pr.materials
    FROM products pr
    JOIN brands br ON br.id = pr.brand_id
    WHERE br.slug = 'hay'
      AND pr.created_at > NOW() - INTERVAL '3 hours'
      AND (pr.dimensions IS NULL OR pr.dimensions = '')
    ORDER BY pr.name
  `);

  console.log(`${products.length} products to scrape for dimensions\n`);

  const browser = await chromium.launch({ headless: true });
  let found = 0, empty = 0;

  for (let i = 0; i < products.length; i++) {
    const prod = products[i];
    console.log(`\n[${i + 1}/${products.length}] ${prod.name}`);
    console.log(`  ${prod.source_url}`);

    const ctx  = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
    const page = await ctx.newPage();

    try {
      // Step 1: load main product page and find variant URLs
      await page.goto(prod.source_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(PAGE_WAIT);

      const variantUrls = await getVariantUrls(page, prod.source_url);
      console.log(`  Found ${variantUrls.length} variant URL(s)`);

      let specs = { size: null, materials: {} };

      if (variantUrls.length === 0) {
        // No sub-variant pages — try scraping specs from the main product page directly
        console.log('  No variant URLs — trying main page directly...');
        specs = await scrapeVariantSpecs(page, prod.source_url);
      } else {
        // Step 2: visit first variant page and scrape specs
        const firstVariant = variantUrls[0];
        console.log(`  → ${firstVariant.split('/').pop()}`);
        specs = await scrapeVariantSpecs(page, firstVariant);

        if (!specs.size && Object.keys(specs.materials).length === 0 && variantUrls[1]) {
          console.log(`  Trying second variant...`);
          const specs2 = await scrapeVariantSpecs(page, variantUrls[1]);
          if (specs2.size) { specs.size = specs2.size; specs.materials = specs2.materials; }
        }
      }

      console.log(`  SIZE: ${specs.size || 'not found'}`);
      console.log(`  Materials: ${JSON.stringify(specs.materials)}`);

      const dimensions = specs.size || null;
      const matParts = Object.entries(specs.materials)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`);
      const materials = matParts.length > 0 ? matParts.join(', ') : null;

      console.log(`  → dimensions: ${dimensions || 'none'}`);
      console.log(`  → materials:  ${materials || 'none'}`);

      if (EXECUTE && (dimensions || materials)) {
        await pool.query(
          `UPDATE products SET
            dimensions = COALESCE($1, dimensions),
            materials  = COALESCE($2, materials),
            updated_at = NOW()
           WHERE id = $3`,
          [dimensions, materials, prod.id]
        );
        console.log(`  ✓ saved`);
        found++;
      } else if (dimensions || materials) {
        console.log(`  [DRY] would save`);
        found++;
      } else {
        empty++;
      }

    } catch (err) {
      console.log(`  ✗ ERROR: ${err.message}`);
      empty++;
    } finally {
      await page.close();
      await ctx.close();
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  await browser.close();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Scraped: ${found} with data | ${empty} with nothing`);
  if (!EXECUTE && found > 0) console.log(`Run with --execute to save`);

  await pool.end();
}

main().catch(e => { console.error(e.message); pool.end(); });
