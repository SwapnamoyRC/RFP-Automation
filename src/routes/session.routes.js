const express = require('express');
const { z } = require('zod');
const sessionController = require('../controllers/session.controller');
const { validate, validateQuery, validateParams } = require('../middleware/validate');

const router = express.Router();

// Shared param schemas
const sessionIdParams = z.object({ id: z.coerce.number().int().positive('Invalid session ID') });
const itemParams = z.object({
  id: z.coerce.number().int().positive('Invalid session ID'),
  itemId: z.coerce.number().int().positive('Invalid item ID'),
});

// Query schemas
const listSessionsQuery = z.object({
  status: z.enum(['processing', 'reviewing', 'completed', 'error']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// Body schemas
const updateSessionBody = z.object({
  client_name: z.string().max(255).optional(),
  threshold: z.coerce.number().min(0.1).max(0.95).optional(),
  status: z.enum(['processing', 'reviewing', 'completed', 'error']).optional(),
  file_name: z.string().max(255).optional(),
  file_base64: z.string().optional(),
  pptx_drive_url: z.string().url().optional(),
}).strict();

const processSessionBody = z.object({
  fileBase64: z.string().optional(),
  fileName: z.string().max(255).optional(),
  threshold: z.coerce.number().min(0.1).max(0.95).optional(),
  imageWeight: z.coerce.number().min(0).max(1).optional(),
});

const reviewItemBody = z.object({
  status: z.enum(['approved', 'rejected'], { message: 'status must be "approved" or "rejected"' }),
  telegram_message_id: z.string().optional(),
});

const selectAlternativeBody = z.object({
  alternativeIndex: z.coerce.number().int().min(1).max(5, 'alternativeIndex must be between 1 and 5'),
});

const overrideItemBody = z.object({
  productUrl: z.string().url('productUrl must be a valid URL'),
  productName: z.string().max(255).optional(),
  productBrand: z.string().max(255).optional(),
  productImageUrl: z.string().url('productImageUrl must be a valid URL').optional(),
  note: z.string().max(1000).optional(),
});

const generateBody = z.object({
  clientName: z.string().max(255).optional(),
});

// Session management
router.get('/', validateQuery(listSessionsQuery), sessionController.listSessions);
router.post('/', sessionController.createSession);
router.get('/active', sessionController.getActiveSession);
router.get('/:id', validateParams(sessionIdParams), sessionController.getSessionById);
router.patch('/:id', validateParams(sessionIdParams), validate(updateSessionBody), sessionController.updateSession);

// Process RFP for a session
router.post('/:id/process', validateParams(sessionIdParams), validate(processSessionBody), sessionController.processSession);

// Processing progress
router.get('/:id/progress', validateParams(sessionIdParams), sessionController.getProgress);

// Items
router.get('/:id/items', validateParams(sessionIdParams), sessionController.getSessionItems);
router.get('/:id/items/pending', validateParams(sessionIdParams), sessionController.getNextPendingItem);
router.post('/:id/items/:itemId/review', validateParams(itemParams), validate(reviewItemBody), sessionController.reviewItem);
router.post('/:id/items/:itemId/select-alternative', validateParams(itemParams), validate(selectAlternativeBody), sessionController.selectAlternative);

// Manual override for an item
router.post('/:id/items/:itemId/override', validateParams(itemParams), validate(overrideItemBody), sessionController.overrideItem);

// Generate PPT from approved items
router.post('/:id/generate', validateParams(sessionIdParams), validate(generateBody), sessionController.generateFromSession);

module.exports = router;
