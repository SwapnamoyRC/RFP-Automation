const express = require('express');
const { z } = require('zod');
const catalogController = require('../controllers/catalog.controller');
const { validate, validateQuery, validateParams } = require('../middleware/validate');

const router = express.Router();

const submitProductBody = z.object({
  productUrl: z.string().url('productUrl must be a valid URL'),
  productName: z.string().max(255).optional(),
  brand: z.string().max(100).optional(),
  category: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  dimensions: z.string().max(500).optional(),
  materials: z.string().max(500).optional(),
  imageUrl: z.preprocess(v => (!v || v === '' ? undefined : v), z.string().url('Image URL must be a valid URL').optional()),
  notes: z.string().max(2000).optional(),
});

const listSubmissionsQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'imported']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const updateSubmissionBody = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'imported'], { message: 'Invalid status' }),
  notes: z.string().max(2000).optional(),
});

const submissionIdParams = z.object({
  id: z.coerce.number().int().positive('Invalid submission ID'),
});

router.post('/submit', validate(submitProductBody), catalogController.submitProduct);
router.get('/submissions', validateQuery(listSubmissionsQuery), catalogController.listSubmissions);
router.patch('/submissions/:id', validateParams(submissionIdParams), validate(updateSubmissionBody), catalogController.updateSubmission);
router.delete('/submissions/:id', validateParams(submissionIdParams), catalogController.deleteSubmission);
router.post('/submissions/:id/import', validateParams(submissionIdParams), catalogController.importSubmission);

module.exports = router;
