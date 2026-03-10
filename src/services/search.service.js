const logger = require('../config/logger');
const EmbeddingModel = require('../models/embedding.model');
const VariantModel = require('../models/variant.model');
const embeddingService = require('./embedding.service');

class SearchService {
  async search(queryText, options = {}) {
    const {
      brand = null,
      category = null,
      limit = 10,
      threshold = 0.5,
      embeddingType = 'product_description',
      includeImageEmbeddings = true
    } = options;

    logger.info(`Searching for: "${queryText}" (brand=${brand}, category=${category}, includeImage=${includeImageEmbeddings})`);

    // Generate embedding for the search query
    const queryEmbedding = await embeddingService.generateEmbedding(queryText);

    // Search text embeddings
    const rows = await EmbeddingModel.searchSimilar(queryEmbedding, {
      embeddingType, brand, category, limit
    });

    // Also search image_description embeddings for better coverage
    let imageRows = [];
    if (includeImageEmbeddings) {
      try {
        imageRows = await EmbeddingModel.searchSimilar(queryEmbedding, {
          embeddingType: 'image_description', brand, category, limit
        });
      } catch (err) {
        logger.warn(`[search] Image embedding search failed: ${err.message}`);
      }
    }

    // Also search product_name embeddings (short name vs short name = much higher similarity)
    let nameRows = [];
    try {
      nameRows = await EmbeddingModel.searchSimilar(queryEmbedding, {
        embeddingType: 'product_name', brand, category, limit
      });
    } catch (err) {
      logger.warn(`[search] Product name embedding search failed: ${err.message}`);
    }

    // Merge results: keep the best similarity per product
    const productMap = new Map();

    for (const row of rows) {
      const similarity = parseFloat(row.similarity);
      if (similarity < threshold) continue;
      productMap.set(row.id, { ...row, similarity, matchSource: 'text' });
    }

    for (const row of imageRows) {
      const similarity = parseFloat(row.similarity);
      if (similarity < threshold) continue;
      const existing = productMap.get(row.id);
      if (!existing || similarity > existing.similarity) {
        productMap.set(row.id, { ...row, similarity, matchSource: 'image_embedding' });
      }
    }

    for (const row of nameRows) {
      const similarity = parseFloat(row.similarity);
      if (similarity < threshold) continue;
      const existing = productMap.get(row.id);
      if (!existing || similarity > existing.similarity) {
        productMap.set(row.id, { ...row, similarity, matchSource: 'product_name' });
      }
    }

    // Sort by similarity and attach variants
    const merged = Array.from(productMap.values()).sort((a, b) => b.similarity - a.similarity).slice(0, limit);

    const results = [];
    for (const row of merged) {
      const variants = await VariantModel.findByProductId(row.id);
      results.push({
        product: {
          id: row.id,
          brand: row.brand_name,
          name: row.name,
          description: row.description,
          dimensions: row.dimensions,
          materials: row.materials,
          pdf_url: row.pdf_url,
          image_url: row.image_url,
          source_url: row.source_url,
          category: row.category,
          designer: row.designer,
          weight: row.weight,
          variants: variants.map(v => ({
            sku: v.sku,
            name: v.variant_name,
            color: v.color,
            material: v.material,
            dimensions: v.dimensions
          }))
        },
        similarity: parseFloat(row.similarity.toFixed(4)),
        matchedOn: row.embedding_type,
        matchSource: row.matchSource || 'text'
      });
    }

    logger.info(`Search returned ${results.length} results above threshold ${threshold}`);

    return {
      results,
      query: queryText,
      totalResults: results.length
    };
  }
}

module.exports = new SearchService();
