const { Router } = require('express');
const asyncWrap = require('../middleware/async-wrap');
const { getProducts, getProductById, getProductPdf } = require('../controllers/products.controller');
const embeddingService = require('../services/embedding.service');

const router = Router();

router.get('/', asyncWrap(getProducts));
router.get('/:id', asyncWrap(getProductById));
router.get('/:id/pdf', asyncWrap(getProductPdf));

// Generate image embeddings for all products (or a specific brand)
router.post('/generate-image-embeddings', asyncWrap(async (req, res) => {
  const { brandId } = req.body;
  res.json({ message: 'Image embedding generation started', status: 'processing' });

  // Run in background (don't block the response)
  setImmediate(async () => {
    try {
      if (brandId) {
        await embeddingService.generateImageEmbeddingsForBrand(brandId);
      } else {
        await embeddingService.generateAllImageEmbeddings();
      }
    } catch (err) {
      console.error('[img-embed] Background generation failed:', err.message);
    }
  });
}));

// Generate image embedding for a single product
router.post('/:id/generate-image-embedding', asyncWrap(async (req, res) => {
  const description = await embeddingService.generateImageEmbedding(req.params.id);
  res.json({ success: true, image_description: description });
}));

module.exports = router;
