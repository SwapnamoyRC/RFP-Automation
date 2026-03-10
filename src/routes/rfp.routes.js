const express = require('express');
const multer = require('multer');
const rfpController = require('../controllers/rfp.controller');

const router = express.Router();

// Store file in memory (Excel files are small)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'application/octet-stream'
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.xlsx?$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are accepted'));
    }
  }
});

// POST /api/rfp/parse — Parse only, return line items
router.post('/parse', upload.single('file'), rfpController.parseRFP);

// POST /api/rfp/process — Parse + search products for each line item
router.post('/process', upload.single('file'), rfpController.processRFP);

// POST /api/rfp/process-base64 — Same as /process but accepts base64 JSON body (for n8n)
router.post('/process-base64', rfpController.processRFPBase64);

// POST /api/rfp/process-images-base64 — Extract images from Excel, describe via Vision API, search (for n8n)
router.post('/process-images-base64', rfpController.processRFPImagesBase64);

// POST /api/rfp/generate-pptx — Generate PowerPoint from slide content
router.post('/generate-pptx', rfpController.generatePptx);

module.exports = router;
