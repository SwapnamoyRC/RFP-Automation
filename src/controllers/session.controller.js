const sessionService = require('../services/session.service');
const rfpParserService = require('../services/rfp-parser.service');
const visionService = require('../services/vision.service');
const { matchFromBase64, matchFromText, initSigLIPModel } = require('../services/matcher.service');
const pptxGenerator = require('../services/pptx-generator.service');
const logger = require('../config/logger');

/**
 * GET /api/sessions
 * List sessions for the authenticated user
 * Query: ?status=completed&limit=50
 */
async function listSessions(req, res) {
  const { status, limit } = req.query;
  const sessions = await sessionService.listSessions({
    userId: req.user.id,
    status: status || undefined,
    limit: limit ? parseInt(limit) : 50,
  });
  res.json(sessions);
}

/**
 * POST /api/sessions
 * Create a new RFP session for the authenticated user
 * Body: { clientName } (optional)
 */
async function createSession(req, res) {
  const session = await sessionService.createSession(req.user.id);
  res.json(session);
}

/**
 * GET /api/sessions/active
 * Get active session for the authenticated user
 */
async function getActiveSession(req, res) {
  const session = await sessionService.getActiveSession(req.user.id);
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
 * Starts background processing of the uploaded RFP file.
 * Returns immediately with session info. Frontend polls GET /api/sessions/:id/progress.
 * Body: { fileBase64, fileName }
 */
async function processSession(req, res) {
  const { id } = req.params;
  let { fileBase64, fileName } = req.body;

  const session = await sessionService.getSession(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (!fileBase64 && session.file_base64) fileBase64 = session.file_base64;
  if (!fileName) fileName = session.file_name || 'upload.xlsx';
  if (!fileBase64) return res.status(400).json({ error: 'No file data available. Upload the file again.' });

  const base64Clean = fileBase64.includes(',') ? fileBase64.split(',').pop() : fileBase64;
  const fileBuffer = Buffer.from(base64Clean, 'base64');

  // Parse Excel synchronously (fast) to validate before starting background work
  let parsed;
  try {
    parsed = rfpParserService.parse(fileBuffer, fileName);
    logger.info(`[session-process] Session ${id}: parsed ${parsed.items.length} items`);
  } catch (err) {
    await sessionService.updateSession(id, { status: 'error' });
    return res.status(400).json({ error: 'Failed to parse Excel', detail: err.message });
  }

  // Accept threshold + image/text weight from request body
  const threshold = req.body.threshold
    ? Math.min(Math.max(parseFloat(req.body.threshold), 0.1), 0.95)
    : (session.threshold || 0.55);

  const imageWeight = req.body.imageWeight !== undefined
    ? Math.min(Math.max(parseFloat(req.body.imageWeight), 0), 1)
    : (session.image_weight !== undefined ? session.image_weight : 0.7);

  // Update session and return immediately
  await sessionService.updateSession(id, {
    status: 'processing',
    file_name: fileName,
    total_items: parsed.items.length,
    threshold,
    image_weight: imageWeight,
    started_at: new Date(),
  });

  res.json({
    session_id: id,
    status: 'processing',
    total_items: parsed.items.length,
    message: 'Processing started. Poll GET /api/sessions/:id/progress for updates.',
  });

  // ── Background processing (runs after response is sent) ──
  processInBackground(id, fileBuffer, parsed, threshold, imageWeight).catch(err => {
    logger.error(`[session-process] Background processing failed for session ${id}: ${err.message}`);
    sessionService.updateSession(id, { status: 'error' }).catch(() => {});
  });
}

/**
 * Background processor: runs the full matcher pipeline with parallel batches.
 * Saves each item to DB as it completes so the review page can show partial results.
 */
async function processInBackground(sessionId, fileBuffer, parsed, threshold, imageWeight = 0.7) {
  // Process 1 item at a time to stay within OpenAI 200K TPM rate limit.
  // Each item's Step 2 (rerank with 15 images) + Step 3 (verify) uses ~50-80K tokens.
  // With concurrency=2, two items hit ~160K tokens simultaneously, dangerously close to 200K.
  // Sequential processing with a small gap is more reliable and avoids costly retries.
  const CONCURRENCY = 1;

  // Extract images
  let extractedImages = [];
  try {
    extractedImages = await visionService.extractImagesFromExcel(fileBuffer);
    logger.info(`[session-process] Session ${sessionId}: ${extractedImages.length} images extracted`);
  } catch (err) {
    logger.error(`[session-process] Image extraction failed: ${err.message}`);
  }

  const imageDataByRow = {};
  for (const img of extractedImages) {
    if (img.base64) imageDataByRow[img.row] = { base64: img.base64, extension: img.extension };
  }

  // Build image-to-item mapping (exact match + nearest unmatched fallback)
  const sortedImageRows = Object.keys(imageDataByRow).map(Number).sort((a, b) => a - b);
  const itemImageMap = {};

  for (let i = 0; i < parsed.items.length; i++) {
    if (imageDataByRow[parsed.items[i]._dataRow]) {
      itemImageMap[i] = imageDataByRow[parsed.items[i]._dataRow];
    }
  }

  const assignedImageRows = new Set(Object.values(itemImageMap).map(img => {
    for (const [r, data] of Object.entries(imageDataByRow)) { if (data === img) return Number(r); }
    return -1;
  }));
  for (const imgRow of sortedImageRows.filter(r => !assignedImageRows.has(r))) {
    let bestItem = -1, bestDist = Infinity;
    for (let i = 0; i < parsed.items.length; i++) {
      if (itemImageMap[i]) continue;
      const dist = Math.abs(imgRow - parsed.items[i]._dataRow);
      if (dist < bestDist) { bestDist = dist; bestItem = i; }
    }
    if (bestItem >= 0) {
      itemImageMap[bestItem] = imageDataByRow[imgRow];
      logger.info(`[session-process] Image row ${imgRow} -> item ${bestItem} ("${parsed.items[bestItem].query.substring(0, 30)}")`);
    }
  }

  // Pre-load SigLIP model once
  await initSigLIPModel();

  // Process items in parallel batches of CONCURRENCY
  for (let batchStart = 0; batchStart < parsed.items.length; batchStart += CONCURRENCY) {
    const batchEnd = Math.min(batchStart + CONCURRENCY, parsed.items.length);
    const batch = [];

    for (let i = batchStart; i < batchEnd; i++) {
      batch.push(processOneItem(i, parsed.items[i], itemImageMap[i] || null, threshold, 2, imageWeight));
    }

    const batchResults = await Promise.all(batch);

    // Save each completed item to DB immediately
    for (let j = 0; j < batchResults.length; j++) {
      const itemIndex = batchStart + j;
      try {
        await sessionService.saveSessionItem(sessionId, itemIndex, batchResults[j]);
      } catch (err) {
        logger.error(`[session-process] Failed to save item ${itemIndex}: ${err.message}`);
      }
    }

    logger.info(`[session-process] Session ${sessionId}: batch ${batchStart + 1}-${batchEnd} of ${parsed.items.length} done`);

    // Pause between items to let OpenAI rate limit window reset (200K TPM)
    if (batchEnd < parsed.items.length) {
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Retry pass: re-process any items that failed (match_source = 'error')
  const { pool } = require('../config/database');
  const failedItems = await pool.query(
    `SELECT item_index FROM rfp_session_items WHERE session_id = $1 AND match_source = 'error' ORDER BY item_index`,
    [sessionId]
  );

  if (failedItems.rows.length > 0) {
    logger.info(`[session-process] Session ${sessionId}: retrying ${failedItems.rows.length} failed items after 10s cooldown`);
    await new Promise(r => setTimeout(r, 10000)); // 10s cooldown for rate limits to reset

    for (const row of failedItems.rows) {
      const idx = row.item_index;
      const item = parsed.items[idx];
      if (!item) continue;

      logger.info(`[session-process] Retrying item ${idx}: "${item.query}"`);
      const result = await processOneItem(idx, item, itemImageMap[idx] || null, threshold, 2, imageWeight);

      // Only update if retry succeeded (not another error)
      if (result.match_source !== 'error') {
        await pool.query(`DELETE FROM rfp_session_items WHERE session_id = $1 AND item_index = $2`, [sessionId, idx]);
        await sessionService.saveSessionItem(sessionId, idx, result);
        logger.info(`[session-process] Retry succeeded for item ${idx}: "${item.query}"`);
      } else {
        logger.warn(`[session-process] Retry failed again for item ${idx}: "${item.query}"`);
      }

      // Small delay between retries
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Mark session as ready for review, record completion time
  const completedAt = new Date();
  const sessionRow = await sessionService.getSession(sessionId);
  const startedAt = sessionRow?.started_at ? new Date(sessionRow.started_at) : null;
  const processingTimeMs = startedAt ? completedAt - startedAt : null;

  await sessionService.updateSession(sessionId, {
    status: 'reviewing',
    completed_at: completedAt,
    ...(processingTimeMs !== null && { processing_time_ms: processingTimeMs }),
  });
  logger.info(`[session-process] Session ${sessionId}: all ${parsed.items.length} items processed in ${processingTimeMs ? Math.round(processingTimeMs / 1000) + 's' : 'unknown time'}`);
}

/**
 * Process a single RFP item through the matcher pipeline.
 */
async function processOneItem(index, item, rfpImageData, threshold, retries = 2, imageWeight = 0.7) {
  logger.info(`[session-process] Item ${index + 1}: "${item.query}" (image: ${rfpImageData ? 'yes' : 'no'})`);

  try {
    let matchResult;

    const matchOptions = { imageWeight };
    if (rfpImageData) {
      const mimeType = `image/${rfpImageData.extension === 'jpg' ? 'jpeg' : rfpImageData.extension}`;
      matchResult = await matchFromBase64(rfpImageData.base64, mimeType, item.query, matchOptions);
    } else {
      const searchText = [item.query, item.description].filter(Boolean).join('. ');
      matchResult = await matchFromText(searchText, matchOptions);
    }

    const topMatch = matchResult.topMatches[0] || null;

    const alternatives = matchResult.topMatches.slice(0, 5).map((m, idx) => ({
      rank: idx + 1,
      product_name: m.product.name,
      product_brand: m.product.brand_name || null,
      product_image_url: m.product.best_match_image_url || m.product.image_url,
      similarity: Math.min(m.score / 10, 0.99),
      match_source: 'hybrid_pipeline',
      explanation: m.explanation || null,
    }));

    let rfpImageBase64 = null;
    if (rfpImageData) {
      const mime = rfpImageData.extension === 'jpg' ? 'jpeg' : rfpImageData.extension;
      rfpImageBase64 = `data:image/${mime};base64,${rfpImageData.base64}`;
    }

    const confidence = topMatch ? Math.min(topMatch.score / 10, 0.99) : 0;

    return {
      rfp_line: item.rfp_line,
      query: item.query,
      description: item.description,
      quantity: item.quantity,
      location: item.location,
      image_description: matchResult.rfpItem.aiDescription || null,
      match_source: rfpImageData ? 'hybrid_pipeline' : 'text_only',
      confidence,
      matched: confidence >= threshold,
      match_explanation: topMatch?.explanation || null,
      matched_points: topMatch?.matched_points || [],
      mismatched_points: topMatch?.mismatched_points || [],
      product: topMatch ? {
        name: topMatch.product.name,
        brand: topMatch.product.brand_name || null,
        image_url: topMatch.product.best_match_image_url || topMatch.product.image_url,
        specs: {
          materials: topMatch.product.materials,
          dimensions: topMatch.product.dimensions,
          category: topMatch.product.category,
        },
      } : null,
      alternatives,
      rfp_image_base64: rfpImageBase64,
    };
  } catch (err) {
    // Retry on rate limit errors (429)
    const isRateLimit = err.status === 429 || err.message?.includes('429') || err.message?.includes('Rate limit');
    if (isRateLimit && retries > 0) {
      const waitSec = retries === 2 ? 15 : 30; // 15s first retry, 30s second
      logger.warn(`[session-process] Item ${index} rate limited, retrying in ${waitSec}s (${retries} retries left)`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
      return processOneItem(index, item, rfpImageData, threshold, retries - 1, imageWeight);
    }

    logger.error(`[session-process] Item ${index} pipeline failed: ${err.message}`);
    return {
      rfp_line: item.rfp_line,
      query: item.query,
      description: item.description,
      quantity: item.quantity,
      location: item.location,
      image_description: null,
      match_source: 'error',
      confidence: 0,
      matched: false,
      product: null,
      alternatives: [],
      rfp_image_base64: null,
    };
  }
}

/**
 * GET /api/sessions/:id/progress
 * Returns processing progress for a session.
 */
async function getProgress(req, res) {
  const progress = await sessionService.getProgress(req.params.id);
  if (!progress) return res.status(404).json({ error: 'Session not found' });
  res.json(progress);
}

/**
 * POST /api/sessions/:id/items/:itemId/override
 * Manually override a match with a correct product link.
 * Body: { productUrl, productName, productBrand, productImageUrl (optional), note }
 *
 * When an override is submitted:
 * 1. Saves the override details to the session item
 * 2. Automatically approves the item
 * 3. Saves the product to the catalog with text + SigLIP embeddings (if image URL provided)
 */
async function overrideItem(req, res) {
  const { id, itemId } = req.params;
  const { productUrl, productName, productBrand, productImageUrl, note } = req.body;

  logger.info(`[override-controller] Request body:`, JSON.stringify(req.body));
  logger.info(`[override-controller] Extracted: url=${productUrl ? 'yes' : 'no'}, name=${productName ? 'yes' : 'no'}, brand=${productBrand ? 'yes' : 'no'}, imageUrl=${productImageUrl ? 'yes' : 'no'}, note=${note ? 'yes' : 'no'}`);

  const { pool: db } = require('../config/database');

  const itemResult = await db.query(
    `SELECT id FROM rfp_session_items WHERE id = $1 AND session_id = $2`,
    [itemId, id]
  );
  if (!itemResult.rows[0]) {
    return res.status(404).json({ error: 'Item not found' });
  }

  await db.query(
    `UPDATE rfp_session_items SET
      override_product_url = $1,
      override_product_name = $2,
      override_product_brand = $3,
      override_note = $4,
      is_overridden = TRUE,
      review_status = 'approved'
    WHERE id = $5 AND session_id = $6`,
    [productUrl, productName || null, productBrand || null, note || null, itemId, id]
  );

  // Save the overridden product to the catalog with embeddings
  if (productName && productBrand && productUrl) {
    logger.info(`[override] Starting catalog save for: ${productName} (${productBrand})`);
    try {
      const productId = await sessionService.saveOverriddenProductToCatalog(
        productName,
        productBrand,
        productUrl,
        productImageUrl || null
      );
      if (productId) {
        logger.info(`[override] ✅ Product successfully saved: id=${productId}, session=${id}, item=${itemId}`);
      } else {
        logger.warn(`[override] ❌ Product save returned null (check logs above for details), session=${id}, item=${itemId}`);
      }
    } catch (err) {
      logger.error(`[override] ❌ Exception during product save: ${err.message}`, err);
    }
  } else {
    logger.warn(`[override] Skipping catalog save - missing required fields`, { productName, productBrand, productUrl });
  }

  // Update session counts
  const counts = await sessionService.reviewItem(id, itemId, 'approved');

  res.json({
    item_id: itemId,
    is_overridden: true,
    override_product_url: productUrl,
    override_product_name: productName,
    override_product_brand: productBrand,
    ...counts,
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

  // Build slides array — simplified (no AI recommendation paragraph)
  const slides = approvedItems.map(item => {
    const specs = Object.entries(item.product_specs || {})
      .filter(([, v]) => v)
      .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)}: ${String(v).trim()}`);

    return {
      slide_title: item.query,
      rfp_description: item.description || item.query,
      product_name: item.product_name,
      brand: item.product_brand,
      confidence: item.confidence,
      quantity: item.quantity,
      location: item.location,
      specs,
      image_url: item.product_image_url,
      rfp_image_url: item.rfp_image_base64,
      is_overridden: item.is_overridden || false,
    };
  });

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

/**
 * POST /api/sessions/:id/items/:itemId/select-alternative
 * Select an alternative match for an item
 * Body: { alternativeIndex } (1-based rank from alternatives array)
 */
async function selectAlternative(req, res) {
  const { id, itemId } = req.params;
  const { alternativeIndex } = req.body;

  const { pool: db } = require('../config/database');

  // Get the item and its alternatives
  const itemResult = await db.query(
    `SELECT * FROM rfp_session_items WHERE id = $1 AND session_id = $2`,
    [itemId, id]
  );
  if (!itemResult.rows[0]) {
    return res.status(404).json({ error: 'Item not found' });
  }

  const item = itemResult.rows[0];
  const alternatives = typeof item.alternatives === 'string'
    ? JSON.parse(item.alternatives || '[]')
    : (item.alternatives || []);
  const selected = alternatives[alternativeIndex - 1];

  if (!selected) {
    return res.status(400).json({ error: 'Alternative not found at that index' });
  }

  // Update the item's primary match to the selected alternative
  await db.query(
    `UPDATE rfp_session_items SET
      product_name = $1,
      product_brand = $2,
      product_image_url = $3,
      confidence = $4,
      match_source = $5,
      match_explanation = $6,
      selected_alternative = $7
    WHERE id = $8 AND session_id = $9`,
    [
      selected.product_name,
      selected.product_brand,
      selected.product_image_url,
      selected.similarity,
      selected.match_source,
      selected.explanation || null,
      alternativeIndex,
      itemId,
      id
    ]
  );

  res.json({
    item_id: itemId,
    selected_alternative: alternativeIndex,
    product_name: selected.product_name,
    product_brand: selected.product_brand,
    confidence: selected.similarity
  });
}

module.exports = {
  listSessions,
  createSession,
  getActiveSession,
  getSessionById,
  updateSession,
  processSession,
  getProgress,
  getSessionItems,
  getNextPendingItem,
  reviewItem,
  selectAlternative,
  generateFromSession,
  overrideItem,
};
