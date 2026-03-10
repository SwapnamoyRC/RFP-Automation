const sessionService = require('../services/session.service');
const rfpParserService = require('../services/rfp-parser.service');
const searchService = require('../services/search.service');
const visionService = require('../services/vision.service');
const pptxGenerator = require('../services/pptx-generator.service');
const logger = require('../config/logger');

/**
 * POST /api/sessions
 * Create a new RFP session
 * Body: { chatId, userId }
 */
async function createSession(req, res) {
  const { chatId, userId } = req.body;
  if (!chatId) return res.status(400).json({ error: 'chatId is required' });

  const session = await sessionService.createSession(chatId, userId);
  res.json(session);
}

/**
 * GET /api/sessions/active/:chatId
 * Get active session for a chat
 */
async function getActiveSession(req, res) {
  const session = await sessionService.getActiveSession(req.params.chatId);
  res.json(session || { error: 'No active session' });
}

/**
 * GET /api/sessions/:id
 * Get session by ID
 */
async function getSessionById(req, res) {
  const session = await sessionService.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  // Don't return file_base64 in GET (too large)
  const { file_base64, ...rest } = session;
  res.json(rest);
}

/**
 * PATCH /api/sessions/:id
 * Update session (client name, threshold, etc.)
 * Body: { client_name, threshold, status, file_name }
 */
async function updateSession(req, res) {
  const { id } = req.params;
  const allowed = ['client_name', 'threshold', 'status', 'file_name', 'file_base64', 'pptx_drive_url'];
  const fields = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) fields[key] = req.body[key];
  }
  await sessionService.updateSession(id, fields);
  const session = await sessionService.getSession(id);
  res.json(session);
}

/**
 * POST /api/sessions/:id/process
 * Process the uploaded RFP file for a session (extract images, match products)
 * Body: { fileBase64, fileName }
 */
async function processSession(req, res) {
  const { id } = req.params;
  let { fileBase64, fileName } = req.body;

  const session = await sessionService.getSession(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  // Use file from request body, or fall back to file stored in session
  if (!fileBase64 && session.file_base64) {
    fileBase64 = session.file_base64;
  }
  if (!fileName) {
    fileName = session.file_name || 'upload.xlsx';
  }
  if (!fileBase64) {
    return res.status(400).json({ error: 'No file data available. Upload the file again.' });
  }

  const threshold = session.threshold || 0.55;
  const base64Clean = fileBase64.includes(',') ? fileBase64.split(',').pop() : fileBase64;
  const fileBuffer = Buffer.from(base64Clean, 'base64');

  await sessionService.updateSession(id, { status: 'processing', file_name: fileName });

  // Step 1: Parse text
  let parsed;
  try {
    parsed = rfpParserService.parse(fileBuffer, fileName || 'upload.xlsx');
    logger.info(`[session-process] Session ${id}: parsed ${parsed.items.length} items`);
  } catch (err) {
    await sessionService.updateSession(id, { status: 'error' });
    return res.status(400).json({ error: 'Failed to parse Excel', detail: err.message });
  }

  // Step 2: Extract and describe images
  let imageDescriptions = [];
  try {
    imageDescriptions = await visionService.processExcelImages(fileBuffer);
    logger.info(`[session-process] Session ${id}: ${imageDescriptions.length} images described`);
  } catch (err) {
    logger.error(`[session-process] Image extraction failed: ${err.message}`);
  }

  const imageByRow = {};
  const imageDataByRow = {};
  for (const img of imageDescriptions) {
    if (img.description) imageByRow[img.row] = img.description;
    if (img.base64) imageDataByRow[img.row] = { base64: img.base64, extension: img.extension };
  }

  // Step 3: Search for each item
  const results = [];
  for (let i = 0; i < parsed.items.length; i++) {
    const item = parsed.items[i];
    const dr = item._dataRow;
    const imgDesc = imageByRow[dr] || null;
    const rfpImageData = imageDataByRow[dr] || null;

    try {
      const candidates = [];

      // Text search
      const textQuery = item.query.replace(/^[\w\s]+([-\u2013\u2014])\s+/i, '').trim() || item.query;
      const textSearch = await searchService.search(textQuery, {
        brand: item.brand, limit: 3, threshold: 0.1, embeddingType: 'product_description'
      });
      if (textSearch.results[0]) {
        candidates.push({ search: textSearch, best: textSearch.results[0], source: 'text' });
      }

      if (imgDesc) {
        // Image search
        const imgSearch = await searchService.search(imgDesc, {
          limit: 3, threshold: 0.1, embeddingType: 'product_description'
        });
        if (imgSearch.results[0]) {
          candidates.push({ search: imgSearch, best: imgSearch.results[0], source: 'image' });
        }

        // Combined search
        const cleanType = item.query.replace(/\d+\s*mm/gi, '').replace(/\(.*?\)/g, '').replace(/[xX\u00d7]\s*\d+/g, '').trim();
        const combinedSearch = await searchService.search(`${cleanType} furniture. ${imgDesc}`, {
          limit: 3, threshold: 0.1, embeddingType: 'product_description'
        });
        if (combinedSearch.results[0]) {
          candidates.push({ search: combinedSearch, best: combinedSearch.results[0], source: 'combined' });
        }
      }

      // Smart selection (same logic as rfp.controller)
      let bestResult;
      const imageCandidate = candidates.find(c => c.source === 'image');
      const combinedCandidate = candidates.find(c => c.source === 'combined');
      const textCandidate = candidates.find(c => c.source === 'text');

      if (imgDesc && (imageCandidate || combinedCandidate)) {
        const imgBest = imageCandidate?.best;
        const combBest = combinedCandidate?.best;
        const txtBest = textCandidate?.best;

        if (imgBest && txtBest && imgBest.product.name === txtBest.product.name) {
          bestResult = imgBest.similarity >= txtBest.similarity ? imageCandidate : textCandidate;
        } else if (combBest && txtBest && combBest.product.name === txtBest.product.name) {
          bestResult = combBest.similarity >= txtBest.similarity ? combinedCandidate : textCandidate;
        } else {
          const visualBest = (imgBest && combBest)
            ? (combBest.similarity > imgBest.similarity ? combinedCandidate : imageCandidate)
            : (imageCandidate || combinedCandidate);
          bestResult = visualBest;
        }
      } else {
        candidates.sort((a, b) => b.best.similarity - a.best.similarity);
        bestResult = candidates[0] || null;
      }

      const best = bestResult?.best || null;

      // Build RFP image base64 for storage
      let rfpImageBase64 = null;
      if (rfpImageData) {
        const mime = rfpImageData.extension === 'jpg' ? 'jpeg' : rfpImageData.extension;
        rfpImageBase64 = `data:image/${mime};base64,${rfpImageData.base64}`;
      }

      results.push({
        rfp_line: item.rfp_line,
        query: item.query,
        description: item.description,
        quantity: item.quantity,
        location: item.location,
        image_description: imgDesc,
        match_source: bestResult?.source || 'none',
        confidence: best ? best.similarity : 0,
        matched: best ? best.similarity >= threshold : false,
        product: best ? best.product : null,
        rfp_image_base64: rfpImageBase64
      });
    } catch (err) {
      logger.error(`[session-process] Item ${i} search failed: ${err.message}`);
      results.push({
        rfp_line: item.rfp_line,
        query: item.query,
        description: item.description,
        quantity: item.quantity,
        location: item.location,
        image_description: imgDesc,
        match_source: 'error',
        confidence: 0,
        matched: false,
        product: null,
        rfp_image_base64: null
      });
    }
  }

  // Save all items to DB
  await sessionService.saveSessionItems(id, results);

  res.json({
    session_id: id,
    total_items: results.length,
    matched: results.filter(r => r.matched).length,
    needs_review: results.filter(r => !r.matched).length,
    items: results.map((r, idx) => ({
      item_id: idx,
      rfp_line: r.rfp_line,
      query: r.query,
      location: r.location,
      quantity: r.quantity,
      confidence: r.confidence,
      matched: r.matched,
      match_source: r.match_source,
      product_name: r.product?.name,
      product_brand: r.product?.brand,
      product_image_url: r.product?.image_url
    }))
  });
}

/**
 * GET /api/sessions/:id/items
 * Get all items for a session
 */
async function getSessionItems(req, res) {
  const items = await sessionService.getSessionItems(req.params.id);
  res.json(items);
}

/**
 * GET /api/sessions/:id/items/pending
 * Get next pending item for review
 */
async function getNextPendingItem(req, res) {
  const items = await sessionService.getPendingItems(req.params.id);
  res.json(items[0] || { done: true, message: 'All items reviewed' });
}

/**
 * POST /api/sessions/:id/items/:itemId/review
 * Approve or reject an item
 * Body: { status: 'approved' | 'rejected', telegram_message_id }
 */
async function reviewItem(req, res) {
  const { id, itemId } = req.params;
  const { status, telegram_message_id } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be "approved" or "rejected"' });
  }

  // Save telegram message ID if provided
  if (telegram_message_id) {
    const { pool: db } = require('../config/database');
    await db.query(
      `UPDATE rfp_session_items SET telegram_message_id = $1 WHERE id = $2`,
      [telegram_message_id, itemId]
    );
  }

  const counts = await sessionService.reviewItem(id, itemId, status);
  res.json({
    item_id: itemId,
    review_status: status,
    ...counts,
    all_reviewed: counts.pending === 0
  });
}

/**
 * POST /api/sessions/:id/generate
 * Generate PPT from approved items
 * Body: { clientName }
 */
async function generateFromSession(req, res) {
  const { id } = req.params;
  const session = await sessionService.getSession(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const clientName = req.body.clientName || session.client_name || 'Client';
  const approvedItems = await sessionService.getApprovedItemsForPPT(id);

  if (approvedItems.length === 0) {
    return res.status(400).json({ error: 'No approved items to generate PPT from' });
  }

  // Build slides array compatible with pptx-generator
  const slides = approvedItems.map(item => ({
    slide_title: `${item.query} - Recommended Solution`,
    recommendation: `Based on the RFP requirement for "${item.query}", we recommend the ${item.product_name} by ${item.product_brand}. This product matches the specifications with ${(item.confidence * 100).toFixed(0)}% confidence.`,
    specs: Object.entries(item.product_specs || {}).map(([k, v]) => `${k}: ${v}`),
    product_name: item.product_name,
    brand: item.product_brand,
    confidence: item.confidence,
    quantity: item.quantity,
    location: item.location,
    image_url: item.product_image_url,
    rfp_image_url: item.rfp_image_base64
  }));

  try {
    const pptxBuffer = await pptxGenerator.generatePptx({ clientName, slides });

    await sessionService.updateSession(id, { status: 'completed' });

    const fileName = `RFP_Response_${clientName.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.pptx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': pptxBuffer.length
    });
    res.send(pptxBuffer);
  } catch (err) {
    logger.error(`[session] PPT generation failed for session ${id}: ${err.message}`);
    res.status(500).json({ error: 'Failed to generate PPT', detail: err.message });
  }
}

module.exports = {
  createSession,
  getActiveSession,
  getSessionById,
  updateSession,
  processSession,
  getSessionItems,
  getNextPendingItem,
  reviewItem,
  generateFromSession
};
