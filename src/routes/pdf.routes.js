const { Router } = require('express');
const { z } = require('zod');
const asyncWrap = require('../middleware/async-wrap');
const { validate } = require('../middleware/validate');
const pdfService = require('../services/pdf.service');

const router = Router();

const extractPdfSchema = z.object({
  url: z.string().url('A valid URL is required'),
  productId: z.string().uuid().optional(),
});

router.post('/', validate(extractPdfSchema), asyncWrap(async (req, res) => {
  const { url, productId } = req.body;
  const result = await pdfService.processProductPdf(url, productId);
  res.json(result);
}));

module.exports = router;
