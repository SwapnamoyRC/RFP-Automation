const { pool } = require('../config/database');
const openaiConfig = require('../config/openai');
const logger = require('../config/logger');

/**
 * Hybrid vector search: SigLIP image embeddings + text embeddings
 * merged with Reciprocal Rank Fusion (RRF).
 *
 * @param {number[]|null} imageEmbedding  - SigLIP 768-dim vector, or null for text-only
 * @param {string}        textDescription - natural-language query for text search
 * @param {number}        topK            - number of results to return
 * @param {number}        imageWeight     - 0.0–1.0, fraction given to image ranking (default 0.7)
 *
 * Image search uses product_siglip_images (multi-angle) with fallback to products.siglip_embedding.
 * Text search uses existing product_embeddings (text-embedding-3-large, 3072-dim).
 */
async function searchSimilarProducts(imageEmbedding, textDescription, topK = 100, imageWeight = 0.7) {
  // Fetch ALL products — with ~560 products this is fast and ensures no product
  // that ranks high in one modality is missed due to truncation
  const fetchK = 600;

  // 1. Image-based search using SigLIP embeddings (skip if no image embedding)
  let imageResults = { rows: [] };
  if (imageEmbedding) {
    const imgEmbStr = `[${imageEmbedding.join(',')}]`;
    imageResults = await pool.query(
      `WITH best_multi AS (
        SELECT DISTINCT ON (pi.product_id)
          pi.product_id AS id,
          p.name, p.description, p.category,
          b.name AS brand_name,
          pi.image_url AS best_match_image_url,
          p.image_url, p.image_description,
          p.materials, p.dimensions,
          1 - (pi.siglip_embedding <=> $1::vector) AS similarity
        FROM product_siglip_images pi
        JOIN products p ON p.id = pi.product_id
        LEFT JOIN brands b ON b.id = p.brand_id
        WHERE pi.siglip_embedding IS NOT NULL
        ORDER BY pi.product_id, pi.siglip_embedding <=> $1::vector
      ),
      single AS (
        SELECT
          p.id, p.name, p.description, p.category,
          b.name AS brand_name,
          p.image_url AS best_match_image_url,
          p.image_url, p.image_description,
          p.materials, p.dimensions,
          1 - (p.siglip_embedding <=> $1::vector) AS similarity
        FROM products p
        LEFT JOIN brands b ON b.id = p.brand_id
        WHERE p.siglip_embedding IS NOT NULL
          AND p.id NOT IN (SELECT id FROM best_multi)
      ),
      combined AS (
        SELECT * FROM best_multi
        UNION ALL
        SELECT * FROM single
      )
      SELECT * FROM combined ORDER BY similarity DESC LIMIT $2`,
      [imgEmbStr, fetchK]
    );
  }

  // 2. Text-based search using existing text-embedding-3-large embeddings
  let textResults = [];
  if (textDescription && textDescription.trim().length > 5) {
    try {
      const embResponse = await openaiConfig.openai.embeddings.create({
        model: 'text-embedding-3-large',
        input: textDescription.substring(0, 8000),
      });
      const textEmb = embResponse.data[0].embedding;
      const textEmbStr = `[${textEmb.join(',')}]`;

      // Search: get best similarity per product across all embedding types
      const textResult = await pool.query(
        `SELECT
          p.id, p.name, p.description, p.category, p.image_url, p.image_description,
          p.materials, p.dimensions, b.name AS brand_name,
          MAX(1 - (pe.embedding <=> $1::vector)) AS similarity
        FROM product_embeddings pe
        JOIN products p ON p.id = pe.product_id
        LEFT JOIN brands b ON b.id = p.brand_id
        WHERE pe.embedding_type IN ('product_description', 'image_description')
        GROUP BY p.id, p.name, p.description, p.category, p.image_url, p.image_description,
                 p.materials, p.dimensions, b.name
        ORDER BY MIN(pe.embedding <=> $1::vector)
        LIMIT $2`,
        [textEmbStr, fetchK]
      );

      textResults = textResult.rows;
    } catch (err) {
      logger.warn(`[hybrid-search] Text search failed, using image-only: ${err.message}`);
    }
  }

  // 3. Merge results using Reciprocal Rank Fusion (RRF)
  // When no image embedding, text gets full weight regardless of imageWeight setting
  const hasImageResults = imageResults.rows.length > 0;
  const clampedImageWeight = Math.min(Math.max(imageWeight, 0), 1);
  const IMAGE_WEIGHT = hasImageResults ? clampedImageWeight : 0;
  const TEXT_WEIGHT = hasImageResults ? (1 - clampedImageWeight) : 1.0;
  logger.info(`[hybrid-search] Weights — image: ${(IMAGE_WEIGHT * 100).toFixed(0)}%, text: ${(TEXT_WEIGHT * 100).toFixed(0)}%`);
  const RRF_K = 60;

  const scoreMap = new Map();

  for (let i = 0; i < imageResults.rows.length; i++) {
    const row = imageResults.rows[i];
    scoreMap.set(row.id, {
      product: row,
      imageRank: i + 1,
      textRank: 9999,
      imageScore: parseFloat(row.similarity),
      textScore: 0,
    });
  }

  for (let i = 0; i < textResults.length; i++) {
    const row = textResults[i];
    const existing = scoreMap.get(row.id);
    if (existing) {
      existing.textRank = i + 1;
      existing.textScore = parseFloat(row.similarity);
    } else {
      scoreMap.set(row.id, {
        product: row,
        imageRank: 9999,
        textRank: i + 1,
        imageScore: 0,
        textScore: parseFloat(row.similarity),
      });
    }
  }

  const merged = Array.from(scoreMap.values())
    .map((entry) => {
      const rrfScore =
        IMAGE_WEIGHT * (1 / (RRF_K + entry.imageRank)) +
        TEXT_WEIGHT * (1 / (RRF_K + entry.textRank));
      return {
        ...entry.product,
        similarity: rrfScore,
        imageSimilarity: entry.imageScore,
        _debugImageRank: entry.imageRank,
        _debugTextRank: entry.textRank,
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  logger.info(`[hybrid-search] Image results: ${imageResults.rows.length}, Text results: ${textResults.length}, Merged: ${merged.length}`);

  // Debug: log top 10 merged results
  logger.info('[hybrid-search] Top 10 merged (RRF):');
  for (let i = 0; i < Math.min(10, merged.length); i++) {
    const m = merged[i];
    logger.info(`  #${i + 1} ${m.name} [imgRank=${m._debugImageRank}, txtRank=${m._debugTextRank}] rrf=${m.similarity.toFixed(6)}`);
  }

  return merged.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    brand_name: row.brand_name || null,
    image_url: row.image_url,
    best_match_image_url: row.best_match_image_url || row.image_url,
    image_description: row.image_description,
    materials: row.materials,
    dimensions: row.dimensions,
    similarity: row.similarity,
    imageSimilarity: row.imageSimilarity || 0,
  }));
}

module.exports = { searchSimilarProducts };
