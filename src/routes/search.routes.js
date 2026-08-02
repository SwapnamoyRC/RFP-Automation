const { Router } = require('express');
const { z } = require('zod');
const asyncWrap = require('../middleware/async-wrap');
const { validate } = require('../middleware/validate');
const { search, visualSearch } = require('../controllers/search.controller');

const router = Router();

const searchSchema = z.object({
  query: z.string().min(2, 'Query must be at least 2 characters'),
  brand: z.enum(['hay', 'muuto', 'naughtone']).optional(),
  category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  threshold: z.coerce.number().min(0).max(1).default(0.5),
  embeddingType: z.enum(['product_description', 'pdf_content', 'full_spec']).default('product_description'),
});

const visualSearchSchema = z.object({
  image_base64: z.string().optional(),
  mime_type: z.string().optional(),
  query: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

router.post('/', validate(searchSchema), asyncWrap(search));
router.post('/visual', validate(visualSearchSchema), asyncWrap(visualSearch));

module.exports = router;
