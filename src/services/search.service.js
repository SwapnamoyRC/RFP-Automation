const logger = require('../config/logger');
const { pool } = require('../config/database');
const EmbeddingModel = require('../models/embedding.model');
const VariantModel = require('../models/variant.model');
const embeddingService = require('./embedding.service');
const openaiConfig = require('../config/openai');

class SearchService {
  /**
   * Expand a short RFP query into a richer search query using GPT-4o.
   * Adds synonyms, alternative names, and descriptive terms to improve recall.
   */
  async expandQuery(query) {
    try {
      const response = await openaiConfig.openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.3,
        max_tokens: 300,
        messages: [
          {
            role: 'system',
            content: `You are a furniture product search expert. Given an RFP line item description, expand it into a richer search query that includes:
- Alternative names for the furniture type (e.g., "side table" → "accent table, occasional table, lamp table, end table")
- Shape and form descriptors if implied (e.g., "mushroom" → "round top, narrow base, pedestal")
- Material variations if mentioned
- Common use contexts (e.g., "lounge", "reception", "breakout area")
- Style descriptors if apparent (e.g., "Scandinavian", "minimalist", "modern")

Rules:
- Output ONLY the expanded query text, no explanations or labels
- Keep it under 100 words
- Do NOT invent specific brand or product names
- Preserve any specific dimensions, SKUs, or codes from the original`
          },
          {
            role: 'user',
            content: query
          }
        ]
      });

      const expanded = response.choices[0]?.message?.content?.trim();
      if (expanded) {
        logger.info(`[query-expand] "${query}" → "${expanded}"`);
        return expanded;
      }
      return query;
    } catch (err) {
      logger.warn(`[query-expand] Failed, using original query: ${err.message}`);
      return query;
    }
  }
  /**
   * Unified search across both legacy products and new product families.
   * Searches family_description + image_description embeddings in product_family_embeddings,
   * and falls back to legacy product_embeddings if needed.
   */
  async search(queryText, options = {}) {
    const {
      brand = null,
      category = null,
      limit = 10,
      threshold = 0.3,
      includeImageEmbeddings = true,
      includeLegacy = true
    } = options;

    logger.info(`[search] Query: "${queryText}" (brand=${brand}, category=${category}, limit=${limit})`);

    const queryEmbedding = await embeddingService.generateEmbedding(queryText);

    // ----------------------------------------------------------------
    // 1. Search product_family_embeddings (new schema)
    // ----------------------------------------------------------------
    const familyTextMap = new Map(); // family_id → text similarity
    const familyImageMap = new Map(); // family_id → image similarity
    const familySearchOptMap = new Map(); // family_id → search_optimized similarity
    const familyDataMap = new Map(); // family_id → row data

    // Fetch more candidates per channel than the final limit to improve merge quality
    const channelLimit = Math.max(limit * 2, 20);

    // Search family_description embeddings
    try {
      const familyTextRows = await EmbeddingModel.searchFamilies(queryEmbedding, {
        embeddingType: 'family_description', brand, category, limit: channelLimit
      });
      for (const row of familyTextRows) {
        const similarity = parseFloat(row.similarity);
        if (similarity < threshold) continue;
        familyTextMap.set(row.id, similarity);
        familyDataMap.set(row.id, row);
      }
    } catch (err) {
      logger.warn(`[search] Family text search failed: ${err.message}`);
    }

    // Search search_optimized embeddings (natural-language descriptions)
    try {
      const searchOptRows = await EmbeddingModel.searchFamilies(queryEmbedding, {
        embeddingType: 'search_optimized', brand, category, limit: channelLimit
      });
      for (const row of searchOptRows) {
        const similarity = parseFloat(row.similarity);
        if (similarity < threshold) continue;
        familySearchOptMap.set(row.id, similarity);
        if (!familyDataMap.has(row.id)) familyDataMap.set(row.id, row);
      }
    } catch (err) {
      logger.warn(`[search] Search-optimized search failed: ${err.message}`);
    }

    // Search image_description embeddings
    if (includeImageEmbeddings) {
      try {
        const familyImageRows = await EmbeddingModel.searchFamilies(queryEmbedding, {
          embeddingType: 'image_description', brand, category, limit: channelLimit
        });
        for (const row of familyImageRows) {
          const similarity = parseFloat(row.similarity);
          if (similarity < threshold) continue;
          familyImageMap.set(row.id, similarity);
          if (!familyDataMap.has(row.id)) familyDataMap.set(row.id, row);
        }
      } catch (err) {
        logger.warn(`[search] Family image search failed: ${err.message}`);
      }
    }

    // Compute combined score across all channels
    const familyMap = new Map();
    for (const [id, row] of familyDataMap) {
      const textSim = familyTextMap.get(id) || 0;
      const imageSim = familyImageMap.get(id) || 0;
      const searchOptSim = familySearchOptMap.get(id) || 0;
      let combined, matchSource;

      // Count how many channels matched
      const channels = [textSim, imageSim, searchOptSim].filter(s => s > 0).length;

      if (channels >= 2) {
        // Multi-channel match: weighted average + boost
        // search_optimized gets highest weight (designed for RFP matching)
        const weights = { searchOpt: 0.45, image: 0.35, text: 0.20 };
        const weightedSum =
          (searchOptSim > 0 ? searchOptSim * weights.searchOpt : 0) +
          (imageSim > 0 ? imageSim * weights.image : 0) +
          (textSim > 0 ? textSim * weights.text : 0);
        const totalWeight =
          (searchOptSim > 0 ? weights.searchOpt : 0) +
          (imageSim > 0 ? weights.image : 0) +
          (textSim > 0 ? weights.text : 0);
        combined = (weightedSum / totalWeight) * (1 + 0.05 * channels); // 10-15% multi-channel boost
        matchSource = channels === 3 ? 'all_channels' : 'multi_channel';
      } else if (searchOptSim > 0) {
        combined = searchOptSim; // search_optimized alone is strong, no penalty
        matchSource = 'search_optimized';
      } else if (imageSim > 0) {
        combined = imageSim * 0.90;
        matchSource = 'image_description';
      } else {
        combined = textSim * 0.90;
        matchSource = 'family_description';
      }

      familyMap.set(id, { ...row, similarity: combined, matchSource });
    }

    // Build family results with variants, specs, images, resources
    const familyResults = [];
    const sortedFamilies = Array.from(familyMap.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    for (const row of sortedFamilies) {
      const familyData = await this._loadFamilyDetails(row.id);
      familyResults.push({
        type: 'family',
        family: {
          id: row.id,
          brand: row.brand_name,
          name: row.name,
          slug: row.slug,
          description: row.description,
          category: row.category,
          source_url: row.source_url,
          ...familyData
        },
        similarity: parseFloat(row.similarity.toFixed(4)),
        matchSource: row.matchSource
      });
    }

    // ----------------------------------------------------------------
    // 2. Search legacy product_embeddings (old schema) if enabled
    // ----------------------------------------------------------------
    const legacyResults = [];
    if (includeLegacy) {
      try {
        const legacyMap = new Map();

        const textRows = await EmbeddingModel.searchSimilar(queryEmbedding, {
          embeddingType: 'product_description', brand, category, limit
        });
        for (const row of textRows) {
          const similarity = parseFloat(row.similarity);
          if (similarity < threshold) continue;
          legacyMap.set(row.id, { ...row, similarity, matchSource: 'text' });
        }

        if (includeImageEmbeddings) {
          try {
            const imgRows = await EmbeddingModel.searchSimilar(queryEmbedding, {
              embeddingType: 'image_description', brand, category, limit
            });
            for (const row of imgRows) {
              const similarity = parseFloat(row.similarity);
              if (similarity < threshold) continue;
              const existing = legacyMap.get(row.id);
              if (!existing || similarity > existing.similarity) {
                legacyMap.set(row.id, { ...row, similarity, matchSource: 'image_embedding' });
              }
            }
          } catch (err) { /* ignore */ }
        }

        try {
          const nameRows = await EmbeddingModel.searchSimilar(queryEmbedding, {
            embeddingType: 'product_name', brand, category, limit
          });
          for (const row of nameRows) {
            const similarity = parseFloat(row.similarity);
            if (similarity < threshold) continue;
            const existing = legacyMap.get(row.id);
            if (!existing || similarity > existing.similarity) {
              legacyMap.set(row.id, { ...row, similarity, matchSource: 'product_name' });
            }
          }
        } catch (err) { /* ignore */ }

        const sortedLegacy = Array.from(legacyMap.values())
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, limit);

        for (const row of sortedLegacy) {
          const variants = await VariantModel.findByProductId(row.id);
          legacyResults.push({
            type: 'product',
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
            matchSource: row.matchSource
          });
        }
      } catch (err) {
        logger.warn(`[search] Legacy search failed: ${err.message}`);
      }
    }

    // ----------------------------------------------------------------
    // 3. Merge and deduplicate: family results take priority
    // ----------------------------------------------------------------
    const allResults = [...familyResults, ...legacyResults]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    logger.info(`[search] Returned ${allResults.length} results (${familyResults.length} families, ${legacyResults.length} legacy) above threshold ${threshold}`);

    return {
      results: allResults,
      query: queryText,
      totalResults: allResults.length
    };
  }

  /**
   * Load full details for a product family: variants, specs, images, resources.
   */
  async _loadFamilyDetails(familyId) {
    const [variantsResult, specsResult, imagesResult, resourcesResult] = await Promise.all([
      pool.query(
        `SELECT id, name, slug, sku, source_url, is_primary, metadata
         FROM product_variants_v2 WHERE family_id = $1
         ORDER BY is_primary DESC, name`,
        [familyId]
      ),
      pool.query(
        `SELECT spec_category, spec_name, spec_value, unit
         FROM technical_specs WHERE family_id = $1
         ORDER BY spec_category, spec_name`,
        [familyId]
      ),
      pool.query(
        `SELECT image_url, product_id_tag, file_size, image_type
         FROM product_images WHERE family_id = $1
         ORDER BY sort_order, created_at
         LIMIT 5`,
        [familyId]
      ),
      pool.query(
        `SELECT resource_type, title, url, file_size
         FROM product_resources WHERE family_id = $1
         ORDER BY resource_type, title`,
        [familyId]
      )
    ]);

    // Group specs by category
    const specs = {};
    for (const row of specsResult.rows) {
      if (!specs[row.spec_category]) specs[row.spec_category] = [];
      specs[row.spec_category].push({
        name: row.spec_name,
        value: row.spec_value,
        unit: row.unit
      });
    }

    return {
      variants: variantsResult.rows.map(v => ({
        id: v.id,
        name: v.name,
        slug: v.slug,
        sku: v.sku,
        is_primary: v.is_primary,
        source_url: v.source_url
      })),
      specs,
      images: imagesResult.rows.map(i => ({
        url: i.image_url,
        product_id: i.product_id_tag,
        file_size: i.file_size,
        type: i.image_type
      })),
      resources: resourcesResult.rows.map(r => ({
        type: r.resource_type,
        title: r.title,
        url: r.url,
        file_size: r.file_size
      }))
    };
  }
}

module.exports = new SearchService();
