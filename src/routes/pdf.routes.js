const { Router } = require('express');
const Joi = require('joi');
const asyncWrap = require('../middleware/async-wrap');
const validate = require('../middleware/validate');
const pdfService = require('../services/pdf.service');

const router = Router();

const extractPdfSchema = Joi.object({
  url: Joi.string().uri().required(),
  productId: Joi.string().uuid().optional()
});

router.post('/', validate(extractPdfSchema), asyncWrap(async (req, res) => {
  const { url, productId } = req.body;
  const result = await pdfService.processProductPdf(url, productId);
  res.json(result);
}));

module.exports = router;
