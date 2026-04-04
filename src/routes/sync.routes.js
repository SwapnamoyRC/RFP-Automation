const { Router } = require('express');
const { z } = require('zod');
const asyncWrap = require('../middleware/async-wrap');
const { validate } = require('../middleware/validate');
const { startSync, getSyncStatus } = require('../controllers/sync.controller');

const router = Router();

const syncSchema = z.object({
  brands: z.array(z.enum(['hay', 'muuto', 'naughtone'])).optional(),
  forceRefresh: z.boolean().default(false),
  triggeredBy: z.string().optional(),
});

router.post('/', validate(syncSchema), asyncWrap(startSync));
router.get('/status/:syncId', asyncWrap(getSyncStatus));

module.exports = router;
