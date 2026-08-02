const searchService = require('../services/search.service');
const { matchFromBase64, matchFromText } = require('../services/matcher.service');

async function search(req, res) {
  const { query, brand, category, limit, threshold, embeddingType } = req.body;

  const results = await searchService.search(query, {
    brand,
    category,
    limit,
    threshold,
    embeddingType
  });

  res.json(results);
}

async function visualSearch(req, res) {
  const { image_base64, mime_type, query, limit = 12 } = req.body;

  if (!image_base64 && !query) {
    return res.status(400).json({ error: 'Provide image_base64 or query' });
  }

  let result;
  if (image_base64) {
    const base64Clean = image_base64.replace(/^data:[^;]+;base64,/, '');
    const mimeType = mime_type || 'image/jpeg';
    result = await matchFromBase64(base64Clean, mimeType, query || '', { topK: limit });
  } else {
    result = await matchFromText(query, { topK: limit });
  }

  const products = (result.topMatches || []).map(m => ({
    id: m.product.id,
    name: m.product.name,
    brand_name: m.product.brand_name,
    category: m.product.category,
    description: m.product.description,
    image_url: m.product.image_url || m.product.best_match_image_url,
    dimensions: m.product.dimensions,
    materials: m.product.materials,
    score: m.score,
    explanation: m.explanation,
    similarity: m.product.similarity,
    image_similarity: m.product.imageSimilarity,
  }));

  res.json({
    products,
    meta: {
      query: result.rfpItem?.aiDescription || query || '',
      pipeline: result.pipeline,
    },
  });
}

module.exports = { search, visualSearch };
