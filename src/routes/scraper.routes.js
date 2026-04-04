const { Router } = require('express');
const { z } = require('zod');
const asyncWrap = require('../middleware/async-wrap');
const { validate } = require('../middleware/validate');
const { startScrape, getScrapeStatus, getScrapeLogs } = require('../controllers/scraper.controller');

const router = Router();

const scrapeSchema = z.object({
  brand: z.enum(['hay', 'muuto', 'naughtone', 'all'], { message: 'brand must be hay, muuto, naughtone, or all' }),
  category: z.string().optional(),
  generateEmbeddings: z.boolean().default(true),
});

router.post('/', validate(scrapeSchema), asyncWrap(startScrape));
router.get('/status/:jobId', asyncWrap(getScrapeStatus));
router.get('/logs', asyncWrap(getScrapeLogs));

module.exports = router;
