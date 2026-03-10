const { Router } = require('express');
const Joi = require('joi');
const asyncWrap = require('../middleware/async-wrap');
const validate = require('../middleware/validate');
const { search } = require('../controllers/search.controller');

const router = Router();

const searchSchema = Joi.object({
  query: Joi.string().min(2).required(),
  brand: Joi.string().valid('hay', 'muuto', 'naughtone').optional(),
  category: Joi.string().optional(),
  limit: Joi.number().integer().min(1).max(100).default(10),
  threshold: Joi.number().min(0).max(1).default(0.5),
  embeddingType: Joi.string().valid('product_description', 'pdf_content', 'full_spec').default('product_description')
});

router.post('/', validate(searchSchema), asyncWrap(search));

module.exports = router;
