const { Router } = require('express');
const Joi = require('joi');
const asyncWrap = require('../middleware/async-wrap');
const validate = require('../middleware/validate');
const { startSync, getSyncStatus } = require('../controllers/sync.controller');

const router = Router();

const syncSchema = Joi.object({
  brands: Joi.array().items(Joi.string().valid('hay', 'muuto', 'naughtone')).optional(),
  forceRefresh: Joi.boolean().default(false),
  triggeredBy: Joi.string().optional()
});

router.post('/', validate(syncSchema), asyncWrap(startSync));
router.get('/status/:syncId', asyncWrap(getSyncStatus));

module.exports = router;
