const logger = require('../../config/logger');
const { pool } = require('../../config/database');
const BrandModel = require('../../models/brand.model');
const ProductModel = require('../../models/product.model');
const VariantModel = require('../../models/variant.model');
const ScrapeLogModel = require('../../models/scrape-log.model');
const embeddingService = require('../embedding.service');
const pdfService = require('../pdf.service');
const { createScraper } = require('./scraper.factory');

class ScraperManager {
  constructor() {
    this.activeJobs = new Map();
  }

  async startScrape(brandSlug, options = {}) {
    const brand = await BrandModel.findBySlug(brandSlug);
    if (!brand) throw new Error(`Brand not found: ${brandSlug}`);

    const log = await ScrapeLogModel.create({
      brand_id: brand.id,
      triggered_by: options.triggeredBy || 'manual'
    });
    const jobId = log.id;

    this.activeJobs.set(jobId, {
      brand: brandSlug,
      status: 'running',
      progress: { found: 0, processed: 0, errors: 0 }
    });

    // Run in background
    this._executeScrape(jobId, brand, options).catch(err => {
      logger.error(`Scrape job ${jobId} failed:`, err);
    });

    return { jobId, status: 'started', message: `Scraping ${brand.name} products...` };
  }

  async _executeScrape(jobId, brand, options) {
    const scraper = createScraper(brand, options);
    const job = this.activeJobs.get(jobId);

    try {
      const { products, errors } = await scraper.scrapeAll();
      job.progress.found = products.length;

      // Warm up DB pool after long scraping phase (connections may have timed out)
      await pool.query('SELECT 1');
      logger.info(`[${brand.name}] Database connection verified, saving ${products.length} products...`);

      let newCount = 0;
      let updatedCount = 0;

      for (const productData of products) {
        try {
          const result = await ProductModel.upsert(brand.id, productData);
          const productId = result.id;

          if (result.is_new) newCount++;
          else updatedCount++;

          // Upsert variants
          if (productData.variants && productData.variants.length > 0) {
            await VariantModel.upsertBatch(productId, productData.variants);
          }

          // Process PDF if available
          if (productData.pdf_url) {
            try {
              await pdfService.processProductPdf(productData.pdf_url, productId);
            } catch (pdfErr) {
              logger.warn(`PDF processing failed for ${productData.name}: ${pdfErr.message}`);
            }
          }

          job.progress.processed++;
        } catch (err) {
          logger.error(`Error saving product ${productData.name}: ${err.message} [code=${err.code}, detail=${err.detail}]`);
          // Retry once after a short delay (handles transient connection issues)
          try {
            await new Promise(r => setTimeout(r, 1000));
            const result = await ProductModel.upsert(brand.id, productData);
            const productId = result.id;
            if (result.is_new) newCount++;
            else updatedCount++;
            if (productData.variants && productData.variants.length > 0) {
              await VariantModel.upsertBatch(productId, productData.variants);
            }
            if (productData.pdf_url) {
              try {
                await pdfService.processProductPdf(productData.pdf_url, productId);
              } catch (pdfErr) {
                logger.warn(`PDF processing failed for ${productData.name}: ${pdfErr.message}`);
              }
            }
            job.progress.processed++;
            logger.info(`Retry succeeded for ${productData.name}`);
          } catch (retryErr) {
            logger.error(`Retry also failed for ${productData.name}: ${retryErr.message} [code=${retryErr.code}]`);
            job.progress.errors++;
          }
        }
      }

      // Generate embeddings
      if (options.generateEmbeddings !== false) {
        logger.info(`[${brand.name}] Generating embeddings...`);
        await embeddingService.generateForBrand(brand.id);
      }

      job.status = 'completed';
      await ScrapeLogModel.complete(jobId, {
        products_found: products.length,
        products_new: newCount,
        products_updated: updatedCount
      });

      logger.info(`[${brand.name}] Scrape job ${jobId} completed: ${products.length} found, ${newCount} new, ${updatedCount} updated`);
    } catch (err) {
      job.status = 'failed';
      await ScrapeLogModel.fail(jobId, err);
      throw err;
    }
  }

  async startScrapeAndWait(brandSlug, options = {}) {
    const brand = await BrandModel.findBySlug(brandSlug);
    if (!brand) throw new Error(`Brand not found: ${brandSlug}`);

    const log = await ScrapeLogModel.create({
      brand_id: brand.id,
      triggered_by: options.triggeredBy || 'manual'
    });

    const scraper = createScraper(brand, options);
    const { products } = await scraper.scrapeAll();

    // Warm up DB pool after long scraping phase
    await pool.query('SELECT 1');
    logger.info(`[${brand.name}] Database connection verified, saving ${products.length} products...`);

    let newCount = 0;
    let updatedCount = 0;

    for (const productData of products) {
      try {
        const result = await ProductModel.upsert(brand.id, productData);
        if (result.is_new) newCount++;
        else updatedCount++;

        if (productData.variants && productData.variants.length > 0) {
          await VariantModel.upsertBatch(result.id, productData.variants);
        }

        if (productData.pdf_url) {
          try {
            await pdfService.processProductPdf(productData.pdf_url, result.id);
          } catch (pdfErr) {
            logger.warn(`PDF processing failed for ${productData.name}: ${pdfErr.message}`);
          }
        }
      } catch (err) {
        logger.error(`Error saving product ${productData.name}: ${err.message} [code=${err.code}]`);
        // Retry once
        try {
          await new Promise(r => setTimeout(r, 1000));
          const result = await ProductModel.upsert(brand.id, productData);
          if (result.is_new) newCount++;
          else updatedCount++;
          if (productData.variants && productData.variants.length > 0) {
            await VariantModel.upsertBatch(result.id, productData.variants);
          }
          if (productData.pdf_url) {
            try {
              await pdfService.processProductPdf(productData.pdf_url, result.id);
            } catch (pdfErr) {
              logger.warn(`PDF processing failed for ${productData.name}: ${pdfErr.message}`);
            }
          }
          logger.info(`Retry succeeded for ${productData.name}`);
        } catch (retryErr) {
          logger.error(`Retry also failed for ${productData.name}: ${retryErr.message} [code=${retryErr.code}]`);
        }
      }
    }

    if (options.generateEmbeddings !== false) {
      await embeddingService.generateForBrand(brand.id);
    }

    await ScrapeLogModel.complete(log.id, {
      products_found: products.length,
      products_new: newCount,
      products_updated: updatedCount
    });

    return { products_found: products.length, products_new: newCount, products_updated: updatedCount };
  }

  getJobStatus(jobId) {
    return this.activeJobs.get(jobId) || null;
  }
}

module.exports = new ScraperManager();
