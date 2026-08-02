/**
 * Targeted one-off scraper for specific new product pages:
 *   - https://www.muuto.com/products/news/
 *   - https://www.hay.com/products/furniture/new
 *   - https://www.naughtone.com/products/lotti/
 *   - https://www.naughtone.com/products/pullman-modular/
 *
 * Usage:  node scripts/scrape-new-products.js
 */
require('dotenv').config();

const { runMigrations } = require('../src/db/migrate');
const { seed } = require('../src/db/seed');
const { pool } = require('../src/config/database');
const BrandModel = require('../src/models/brand.model');
const ProductModel = require('../src/models/product.model');
const VariantModel = require('../src/models/variant.model');
const embeddingService = require('../src/services/embedding.service');
const pdfService = require('../src/services/pdf.service');
const logger = require('../src/config/logger');

const MuutoScraper   = require('../src/services/scraper/muuto.scraper');
const HayScraper     = require('../src/services/scraper/hay.scraper');
const NaughtoneScraper = require('../src/services/scraper/naughtone.scraper');

// ── Targeted subclasses ────────────────────────────────────────────────────────

/** Muuto: only scan /products/news/ */
class MuutoNewsScraper extends MuutoScraper {
  getTopCategoryUrls() {
    return ['/products/news/'];
  }
}

/** HAY: only scan /products/furniture/new */
class HayNewScraper extends HayScraper {
  getCategoryPages() {
    return [
      { path: '/products/furniture/new', category: 'other' },
    ];
  }
}

/** NaughtOne: directly target Lotti and Pullman Modular product pages */
class NaughtoneTargetedScraper extends NaughtoneScraper {
  async getProductListUrls() {
    this._categoryMap = {};
    const urls = [
      `${this.brand.base_url}/products/lotti/`,
      `${this.brand.base_url}/products/pullman-modular/`,
    ];
    // Both are soft-seating / sofas family
    urls.forEach(url => { this._categoryMap[url] = 'soft-seating'; });
    logger.info(`[NaughtOne-targeted] Using ${urls.length} specific product URLs`);
    return urls;
  }
}

// ── Save helper (shared logic from scraper.manager) ────────────────────────────

async function saveProducts(brand, products) {
  let newCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  for (const productData of products) {
    try {
      const result = await ProductModel.upsert(brand.id, productData);
      if (result.is_new) {
        newCount++;
        logger.info(`  [NEW]     ${productData.name}`);
      } else {
        updatedCount++;
        logger.info(`  [UPDATE]  ${productData.name}`);
      }

      if (productData.variants?.length > 0) {
        await VariantModel.upsertBatch(result.id, productData.variants);
      }

      if (productData.pdf_url) {
        try {
          await pdfService.processProductPdf(productData.pdf_url, result.id);
        } catch (pdfErr) {
          logger.warn(`  PDF failed for ${productData.name}: ${pdfErr.message}`);
        }
      }
    } catch (err) {
      logger.error(`  Error saving ${productData.name}: ${err.message}`);
      // Retry once
      try {
        await new Promise(r => setTimeout(r, 1000));
        const result = await ProductModel.upsert(brand.id, productData);
        if (result.is_new) newCount++; else updatedCount++;
        if (productData.variants?.length > 0) {
          await VariantModel.upsertBatch(result.id, productData.variants);
        }
        logger.info(`  Retry ok: ${productData.name}`);
      } catch (retryErr) {
        logger.error(`  Retry failed: ${productData.name}: ${retryErr.message}`);
        errorCount++;
      }
    }
  }

  return { newCount, updatedCount, errorCount };
}

// ── Per-brand scrape tasks ─────────────────────────────────────────────────────

async function runMuutoNews(brand) {
  logger.info('\n========== MUUTO — /products/news/ ==========');
  const scraper = new MuutoNewsScraper(brand);
  const { products, errors } = await scraper.scrapeAll();
  logger.info(`Muuto news: ${products.length} products scraped, ${errors.length} errors`);

  await pool.query('SELECT 1');
  const counts = await saveProducts(brand, products);

  logger.info(`Muuto news saved — new: ${counts.newCount}, updated: ${counts.updatedCount}, errors: ${counts.errorCount}`);
  return counts;
}

async function runHayNew(brand) {
  logger.info('\n========== HAY — /products/furniture/new ==========');
  const scraper = new HayNewScraper(brand);
  const { products, errors } = await scraper.scrapeAll();
  logger.info(`HAY new: ${products.length} products scraped, ${errors.length} errors`);

  await pool.query('SELECT 1');
  const counts = await saveProducts(brand, products);

  logger.info(`HAY new saved — new: ${counts.newCount}, updated: ${counts.updatedCount}, errors: ${counts.errorCount}`);
  return counts;
}

async function runNaughtoneTargeted(brand) {
  logger.info('\n========== NAUGHTONE — Lotti + Pullman Modular ==========');
  const scraper = new NaughtoneTargetedScraper(brand);
  const { products, errors } = await scraper.scrapeAll();
  logger.info(`NaughtOne targeted: ${products.length} products scraped, ${errors.length} errors`);

  await pool.query('SELECT 1');
  const counts = await saveProducts(brand, products);

  logger.info(`NaughtOne saved — new: ${counts.newCount}, updated: ${counts.updatedCount}, errors: ${counts.errorCount}`);
  return counts;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  logger.info('Running DB migrations & seed...');
  await runMigrations();
  await seed();

  const [muutoBrand, hayBrand, naughtoneBrand] = await Promise.all([
    BrandModel.findBySlug('muuto'),
    BrandModel.findBySlug('hay'),
    BrandModel.findBySlug('naughtone'),
  ]);

  if (!muutoBrand)     logger.warn('Muuto brand not found in DB — skipping');
  if (!hayBrand)       logger.warn('HAY brand not found in DB — skipping');
  if (!naughtoneBrand) logger.warn('NaughtOne brand not found in DB — skipping');

  const summary = {};

  // Run sequentially to avoid overwhelming the machines / rate limits
  if (muutoBrand) {
    try {
      summary.muuto = await runMuutoNews(muutoBrand);
    } catch (err) {
      logger.error('Muuto failed:', err.message);
      summary.muuto = { error: err.message };
    }
  }

  if (hayBrand) {
    try {
      summary.hay = await runHayNew(hayBrand);
    } catch (err) {
      logger.error('HAY failed:', err.message);
      summary.hay = { error: err.message };
    }
  }

  if (naughtoneBrand) {
    try {
      summary.naughtone = await runNaughtoneTargeted(naughtoneBrand);
    } catch (err) {
      logger.error('NaughtOne failed:', err.message);
      summary.naughtone = { error: err.message };
    }
  }

  // Generate embeddings for all three brands (text + SigLIP)
  logger.info('\n========== GENERATING EMBEDDINGS ==========');
  for (const [slug, brand] of [['muuto', muutoBrand], ['hay', hayBrand], ['naughtone', naughtoneBrand]]) {
    if (!brand) continue;
    try {
      logger.info(`Generating embeddings for ${slug}...`);
      await embeddingService.generateForBrand(brand.id);
      logger.info(`Embeddings done for ${slug}`);
    } catch (err) {
      logger.error(`Embedding failed for ${slug}:`, err.message);
    }
  }

  logger.info('\n========== COMPLETE ==========');
  logger.info('Summary:', JSON.stringify(summary, null, 2));
  process.exit(0);
}

main().catch(err => {
  logger.error('Script failed:', err);
  process.exit(1);
});
