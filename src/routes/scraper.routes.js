const { Router } = require('express');
const Joi = require('joi');
const asyncWrap = require('../middleware/async-wrap');
const validate = require('../middleware/validate');
const { startScrape, getScrapeStatus, getScrapeLogs } = require('../controllers/scraper.controller');

const router = Router();

const scrapeSchema = Joi.object({
  brand: Joi.string().valid('hay', 'muuto', 'naughtone', 'all').required(),
  category: Joi.string().optional(),
  generateEmbeddings: Joi.boolean().default(true)
});

router.post('/', validate(scrapeSchema), asyncWrap(startScrape));
router.get('/status/:jobId', asyncWrap(getScrapeStatus));
router.get('/logs', asyncWrap(getScrapeLogs));

module.exports = router;
