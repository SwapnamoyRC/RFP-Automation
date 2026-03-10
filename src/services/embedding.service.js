const openaiConfig = require('../config/openai');
const logger = require('../config/logger');
const ProductModel = require('../models/product.model');
const VariantModel = require('../models/variant.model');
const EmbeddingModel = require('../models/embedding.model');
const { pool } = require('../config/database');
const { chunkArray } = require('../utils/chunk');
const { truncate } = require('../utils/text');

function composeEmbeddingText(product, variants = []) {
  const parts = [
    `Brand: ${product.brand_name || ''}`,
    `Product: ${product.name}`,
    product.description ? `Description: ${product.description}` : null,
    product.category ? `Category: ${product.category}` : null,
    product.designer ? `Designer: ${product.designer}` : null,
    product.dimensions ? `Dimensions: ${product.dimensions}` : null,
    product.materials ? `Materials: ${product.materials}` : null,
    product.weight ? `Weight: ${product.weight}` : null,
    product.certifications ? `Certifications: ${product.certifications}` : null,
    variants.length > 0
      ? `Variants: ${variants.map(v => v.variant_name).filter(Boolean).join(', ')}`
      : null
  ].filter(Boolean);

  return parts.join('\n');
}

class EmbeddingService {
  async generateEmbedding(text) {
    const truncatedText = truncate(text, 32000);

    const response = await openaiConfig.openai.embeddings.create({
      model: openaiConfig.EMBEDDING_MODEL,
      input: truncatedText,
      dimensions: openaiConfig.EMBEDDING_DIMENSIONS
    });

    return response.data[0].embedding;
  }

  async generateBatch(texts) {
    const BATCH_SIZE = 100;
    const results = [];
    for (const chunk of chunkArray(texts, BATCH_SIZE)) {
      const truncated = chunk.map(t => truncate(t, 32000));
      const response = await openaiConfig.openai.embeddings.create({
        model: openaiConfig.EMBEDDING_MODEL,
        input: truncated,
        dimensions: openaiConfig.EMBEDDING_DIMENSIONS
      });
      results.push(...response.data.map(d => d.embedding));
    }
    return results;
  }

  async generateForProduct(productId) {
    const product = await ProductModel.findById(productId);
    if (!product) throw new Error(`Product not found: ${productId}`);

    const variants = await VariantModel.findByProductId(productId);

    // Embedding type 1: Product description
    const descText = composeEmbeddingText(product, variants);
    const descEmbedding = await this.generateEmbedding(descText);
    await EmbeddingModel.upsert(productId, 'product_description', descEmbedding, descText);
    logger.info(`Generated product_description embedding for: ${product.name}`);

    // Embedding type 2: PDF content
    if (product.pdf_text) {
      const pdfEmbedding = await this.generateEmbedding(product.pdf_text);
      await EmbeddingModel.upsert(productId, 'pdf_content', pdfEmbedding, product.pdf_text);
      logger.info(`Generated pdf_content embedding for: ${product.name}`);
    }

    // Embedding type 3: Full spec
    if (product.pdf_text) {
      const fullText = `${descText}\n\nSpec Sheet:\n${product.pdf_text}`;
      const fullEmbedding = await this.generateEmbedding(fullText);
      await EmbeddingModel.upsert(productId, 'full_spec', fullEmbedding, fullText);
      logger.info(`Generated full_spec embedding for: ${product.name}`);
    }
  }

  async generateForBrand(brandId) {
    const products = await ProductModel.findByBrand(brandId);
    logger.info(`Generating embeddings for ${products.length} products (brand ${brandId})`);

    for (const product of products) {
      try {
        await this.generateForProduct(product.id);
      } catch (err) {
        logger.error(`Embedding generation failed for product ${product.id}:`, err.message);
      }
    }

    logger.info(`Embedding generation complete for brand ${brandId}`);
  }

  /**
   * Generate image description + embedding for a single product.
   * Downloads the product image, describes it with vision AI, stores description and embedding.
   */
  async generateImageEmbedding(productId) {
    const product = await ProductModel.findById(productId);
    if (!product) throw new Error(`Product not found: ${productId}`);
    if (!product.image_url) {
      logger.warn(`[img-embed] No image_url for product ${product.name}, skipping`);
      return null;
    }

    const visionService = require('./vision.service');

    // Get AI description of the product image
    const imageDesc = await visionService.describeImageFromUrl(product.image_url);
    if (!imageDesc) {
      logger.warn(`[img-embed] No description generated for ${product.name}`);
      return null;
    }

    // Store image_description on the product
    await pool.query(
      `UPDATE products SET image_description = $1, updated_at = NOW() WHERE id = $2`,
      [imageDesc, productId]
    );

    // Generate embedding from the image description
    const embedding = await this.generateEmbedding(imageDesc);
    await EmbeddingModel.upsert(productId, 'image_description', embedding, imageDesc);

    logger.info(`[img-embed] Generated image embedding for: ${product.name}`);
    return imageDesc;
  }

  /**
   * Generate image embeddings for all products of a brand that have image URLs.
   */
  async generateImageEmbeddingsForBrand(brandId) {
    const products = await ProductModel.findByBrand(brandId);
    const withImages = products.filter(p => p.image_url);
    logger.info(`[img-embed] Processing ${withImages.length}/${products.length} products with images (brand ${brandId})`);

    let success = 0, failed = 0;
    for (const product of withImages) {
      try {
        await this.generateImageEmbedding(product.id);
        success++;
      } catch (err) {
        failed++;
        logger.error(`[img-embed] Failed for ${product.name}: ${err.message}`);
      }
    }

    logger.info(`[img-embed] Brand ${brandId} complete: ${success} success, ${failed} failed`);
    return { total: withImages.length, success, failed };
  }

  /**
   * Generate product_name embeddings for ALL products.
   * These give much higher similarity for name-to-name matching (RFP query vs product name).
   */
  async generateAllNameEmbeddings() {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, b.name AS brand_name FROM products p
       JOIN brands b ON b.id = p.brand_id
       LEFT JOIN product_embeddings pe ON p.id = pe.product_id AND pe.embedding_type = 'product_name'
       WHERE pe.id IS NULL
       ORDER BY p.name`
    );
    logger.info(`[name-embed] Processing ${rows.length} products without product_name embeddings`);

    // Use batch embedding for speed (100 at a time)
    const BATCH_SIZE = 100;
    let success = 0, failed = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const texts = batch.map(p => `${p.brand_name} ${p.name}`);
      try {
        const embeddings = await this.generateBatch(texts);
        for (let j = 0; j < batch.length; j++) {
          await EmbeddingModel.upsert(batch[j].id, 'product_name', embeddings[j], texts[j]);
          success++;
        }
        logger.info(`[name-embed] Batch ${Math.floor(i/BATCH_SIZE)+1}: ${batch.length} done (${success}/${rows.length})`);
      } catch (err) {
        failed += batch.length;
        logger.error(`[name-embed] Batch failed: ${err.message}`);
        if (err.message && (err.message.includes('429') || err.message.includes('rate'))) {
          logger.info(`[name-embed] Rate limited, waiting 30s...`);
          await new Promise(r => setTimeout(r, 30000));
        }
      }
    }

    logger.info(`[name-embed] Done: ${success} success, ${failed} failed out of ${rows.length}`);
    return { total: rows.length, success, failed };
  }

  /**
   * Generate image embeddings for ALL products across all brands.
   */
  async generateAllImageEmbeddings() {
    // Only process products that DON'T already have image_description embeddings
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.image_url FROM products p
       LEFT JOIN product_embeddings pe ON p.id = pe.product_id AND pe.embedding_type = 'image_description'
       WHERE p.image_url IS NOT NULL AND p.image_url != '' AND pe.id IS NULL
       ORDER BY p.name`
    );
    logger.info(`[img-embed] Processing ${rows.length} remaining products with images`);

    let success = 0, failed = 0;
    for (let i = 0; i < rows.length; i++) {
      try {
        logger.info(`[img-embed] ${i + 1}/${rows.length}: ${rows[i].name}`);
        await this.generateImageEmbedding(rows[i].id);
        success++;
        // Small delay to avoid rate limits
        if (i > 0 && i % 10 === 0) {
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (err) {
        failed++;
        logger.error(`[img-embed] Failed for ${rows[i].name}: ${err.message}`);
        // If rate limited, wait longer and retry once
        if (err.message && (err.message.includes('429') || err.message.includes('rate'))) {
          logger.info(`[img-embed] Rate limited, waiting 30s...`);
          await new Promise(r => setTimeout(r, 30000));
          try {
            await this.generateImageEmbedding(rows[i].id);
            success++;
            failed--;
          } catch (retryErr) {
            logger.error(`[img-embed] Retry also failed for ${rows[i].name}: ${retryErr.message}`);
          }
        }
      }
    }

    logger.info(`[img-embed] All done: ${success} success, ${failed} failed out of ${rows.length}`);
    return { total: rows.length, success, failed };
  }
}

module.exports = new EmbeddingService();
