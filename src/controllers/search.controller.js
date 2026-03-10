const searchService = require('../services/search.service');

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

module.exports = { search };
