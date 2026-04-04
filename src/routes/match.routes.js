const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const asyncWrap = require('../middleware/async-wrap');
const { matchFromFile } = require('../services/matcher.service');

const router = express.Router();

const upload = multer({
  dest: path.join(process.cwd(), 'uploads'),
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

router.post('/', upload.single('image'), asyncWrap(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image uploaded. Send a file with field name 'image'." });
  }

  const description = (req.body?.description) || 'Furniture item';
  const imagePath = req.file.path;

  console.log(`\n[match] API request: ${req.file.originalname} -- "${description}"`);

  try {
    const result = await matchFromFile(imagePath, description);

    res.json({
      success: true,
      rfpItem: {
        description,
        aiDescription: result.rfpItem.aiDescription,
        originalName: req.file.originalname,
      },
      pipeline: result.pipeline,
      matches: result.topMatches.map((m, i) => ({
        rank: i + 1,
        productId: m.product.id,
        productName: m.product.name,
        description: m.product.description,
        category: m.product.category,
        score: m.score,
        explanation: m.explanation,
        imageUrl: m.product.image_url,
        bestMatchImageUrl: m.product.best_match_image_url,
      })),
    });
  } finally {
    // Clean up uploaded temp file after processing
    try { fs.unlinkSync(imagePath); } catch { /* ignore cleanup errors */ }
  }
}));

module.exports = router;
