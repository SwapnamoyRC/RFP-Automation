const sessionService = require('../services/session.service');
const rfpParserService = require('../services/rfp-parser.service');
const visionService = require('../services/vision.service');
const { matchFromBase64, matchFromText, initSigLIPModel } = require('../services/matcher.service');
const pptxGenerator = require('../services/pptx-generator.service');
const logger = require('../config/logger');

// In-memory set of sessions that have been requested to stop
const stoppedSessions = new Set();

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

  // Check if parsing found warnings (format issues)
  const warnings = parsed.warnings || [];
  const hasParsingErrors = warnings.some(w => w.severity === 'error');

  // If no items were found, it's an error condition
  if (parsed.items.length === 0 && hasParsingErrors) {
    await sessionService.updateSession(id, { status: 'error' });
    return res.status(400).json({
      error: 'No products found in Excel file',
      details: warnings.map(w => ({ sheet: w.sheet, message: w.message, issues: w.issues })),
    });
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
    file_base64: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64Clean}`,
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
    warnings: warnings.length > 0 ? warnings : undefined,
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
    if (img.base64) imageDataByRow[img.row - 1] = { base64: img.base64, extension: img.extension };
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
    // Check if stop was requested
    if (stoppedSessions.has(sessionId)) {
      logger.info(`[session-process] Session ${sessionId} stop requested — halting at batch ${batchStart + 1}`);
      stoppedSessions.delete(sessionId);
      await sessionService.updateSession(sessionId, { status: 'reviewing', completed_at: new Date() });
      return;
    }

    const batchEnd = Math.min(batchStart + CONCURRENCY, parsed.items.length);
    const batch = [];

    for (let i = batchStart; i < batchEnd; i++) {
      batch.push(processOneItem(i, parsed.items[i], itemImageMap[i] || null, threshold, 2, imageWeight, sessionId));
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
    // Increased from 5s to 15s to ensure TPM window fully resets and prevent 429 errors
    if (batchEnd < parsed.items.length) {
      await new Promise(r => setTimeout(r, 15000));

      // Check again if stop was requested during the delay
      if (stoppedSessions.has(sessionId)) {
        logger.info(`[session-process] Session ${sessionId} stop requested during delay — halting`);
        stoppedSessions.delete(sessionId);
        await sessionService.updateSession(sessionId, { status: 'reviewing', completed_at: new Date() });
        return;
      }
    }
  }

  // Check if stop was requested before retry pass
  if (stoppedSessions.has(sessionId)) {
    logger.info(`[session-process] Session ${sessionId} stop requested before retry pass — halting`);
    stoppedSessions.delete(sessionId);
    await sessionService.updateSession(sessionId, { status: 'reviewing', completed_at: new Date() });
    return;
  }

  // Retry pass: re-process any items that failed (match_source = 'error')
  const { pool } = require('../config/database');
  const failedItems = await pool.query(
    `SELECT item_index FROM rfp_session_items WHERE session_id = $1 AND match_source = 'error' ORDER BY item_index`,
    [sessionId]
  );

  if (failedItems.rows.length > 0) {
    logger.info(`[session-process] Session ${sessionId}: retrying ${failedItems.rows.length} failed items after 30s cooldown`);
    await new Promise(r => setTimeout(r, 30000)); // 30s cooldown for rate limits to fully reset (TPM window)

    for (const row of failedItems.rows) {
      const idx = row.item_index;
      const item = parsed.items[idx];
      if (!item) continue;

      logger.info(`[session-process] Retrying item ${idx}: "${item.query}"`);
      const result = await processOneItem(idx, item, itemImageMap[idx] || null, threshold, 2, imageWeight, sessionId);

      // Only update if retry succeeded (not another error)
      if (result.match_source !== 'error') {
        await pool.query(`DELETE FROM rfp_session_items WHERE session_id = $1 AND item_index = $2`, [sessionId, idx]);
        await sessionService.saveSessionItem(sessionId, idx, result);
        logger.info(`[session-process] Retry succeeded for item ${idx}: "${item.query}"`);
      } else {
        logger.warn(`[session-process] Retry failed again for item ${idx}: "${item.query}"`);
      }

      // Increased delay between retries (from 3s to 8s) to ensure TPM resets
      await new Promise(r => setTimeout(r, 8000));
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
async function processOneItem(index, item, rfpImageData, threshold, retries = 2, imageWeight = 0.7, sessionId = null) {
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
      product_url: m.product.source_url || null,
      similarity: Math.min(m.score / 10, 0.99),
      match_source: 'hybrid_pipeline',
      explanation: m.explanation || null,
      specs: {
        materials: m.product.materials || null,
        dimensions: m.product.dimensions || null,
        category: m.product.category || null,
      },
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
        source_url: topMatch.product.source_url || null,
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
      const waitSec = retries === 2 ? 45 : 90; // 45s first retry, 90s second (ensures full TPM window reset)
      logger.warn(`[session-process] Item ${index + 1} rate limited, retrying in ${waitSec}s (${retries} retries left)`);

      // Wait with periodic stop flag checks (every 5 seconds)
      const waitMs = waitSec * 1000;
      const checkInterval = 5000;
      let elapsed = 0;
      while (elapsed < waitMs) {
        // Check if stop was requested during wait
        if (sessionId && stoppedSessions.has(sessionId)) {
          logger.info(`[session-process] Stop requested during retry wait for item ${index + 1}`);
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

        const nextCheck = Math.min(checkInterval, waitMs - elapsed);
        await new Promise(r => setTimeout(r, nextCheck));
        elapsed += nextCheck;
      }

      return processOneItem(index, item, rfpImageData, threshold, retries - 1, imageWeight, sessionId);
    }

    logger.error(`[session-process] Item ${index + 1} pipeline failed: ${err.message}`);
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
  const { productUrl, productName, productBrand, category, description, dimensions, materials, productImageUrl, note } = req.body;

  logger.info(`[override-controller] Request body:`, JSON.stringify(req.body));
  logger.info(`[override-controller] Extracted: url=${productUrl ? 'yes' : 'no'}, name=${productName ? 'yes' : 'no'}, brand=${productBrand ? 'yes' : 'no'}, category=${category ? 'yes' : 'no'}, description=${description ? 'yes' : 'no'}, dimensions=${dimensions ? 'yes' : 'no'}, materials=${materials ? 'yes' : 'no'}, imageUrl=${productImageUrl ? 'yes' : 'no'}, note=${note ? 'yes' : 'no'}`);

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
      override_product_image_url = $4,
      override_note = $5,
      is_overridden = TRUE,
      review_status = 'approved'
    WHERE id = $6 AND session_id = $7`,
    [productUrl, productName || null, productBrand || null, productImageUrl || null, note || null, itemId, id]
  );

  // Save the overridden product to the catalog with embeddings
  // Skip if product was selected from the existing catalog (already stored there)
  const isFromCatalog = note && note.includes('Selected from catalog');
  if (productName && productBrand && productUrl && !isFromCatalog) {
    logger.info(`[override] Starting catalog save for: ${productName} (${productBrand})`);
    try {
      const productId = await sessionService.saveOverriddenProductToCatalog(
        productName,
        productBrand,
        productUrl,
        productImageUrl || null,
        {
          category: category || null,
          description: description || null,
          dimensions: dimensions || null,
          materials: materials || null,
        }
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
    override_product_image_url: productImageUrl || null,
    ...counts,
  });
}

/**
 * GET /api/sessions/:id/items/:itemId/product-images
 * Returns all available images for the matched product (from product_images table)
 */
async function getProductImages(req, res) {
  const { id, itemId } = req.params;
  const { pool: db } = require('../config/database');

  const itemResult = await db.query(
    `SELECT product_name, product_brand, product_image_url, override_product_image_url,
            override_product_url, is_overridden, alternatives
     FROM rfp_session_items WHERE id = $1 AND session_id = $2`,
    [itemId, id]
  );
  if (!itemResult.rows[0]) return res.status(404).json({ error: 'Item not found' });

  const {
    product_name, product_brand, product_image_url,
    override_product_image_url, override_product_url, is_overridden,
  } = itemResult.rows[0];

  const altIndex = req.query.altIndex ? parseInt(req.query.altIndex) : null;
  // productId is the catalog products.id passed from the frontend when overriding from catalog search
  const productId = req.query.productId || null;
  const isOverrideLookup = is_overridden && !altIndex;

  let images = [];

  if (isOverrideLookup) {
    // Strategy 0 — direct product_id lookup (catalog product ID stored in override note)
    if (productId) {
      const r = await db.query(
        `SELECT DISTINCT image_url FROM product_siglip_images WHERE product_id = $1 LIMIT 30`,
        [productId]
      );
      images = r.rows.map(row => row.image_url).filter(Boolean);
    }

    // Strategy 1 — look up via source_url match in products table
    if (images.length === 0 && override_product_url) {
      const r = await db.query(
        `SELECT DISTINCT psi.image_url
         FROM product_siglip_images psi
         WHERE psi.product_id = (SELECT id FROM products WHERE source_url = $1 LIMIT 1)
         LIMIT 30`,
        [override_product_url]
      );
      images = r.rows.map(row => row.image_url).filter(Boolean);
    }

    // Strategy 2 — look up via the stored override image URL → find its product_id in siglip
    if (images.length === 0 && override_product_image_url) {
      const r = await db.query(
        `SELECT DISTINCT psi.image_url
         FROM product_siglip_images psi
         WHERE psi.product_id = (
           SELECT product_id FROM product_siglip_images WHERE image_url = $1 LIMIT 1
         )
         LIMIT 30`,
        [override_product_image_url]
      );
      images = r.rows.map(row => row.image_url).filter(Boolean);
    }

    // Strategy 3 — exact product name + brand match in siglip (no fuzzy family lookup to
    // avoid pulling in unrelated products from the same brand)
    if (images.length === 0) {
      const lookupName = req.query.name || product_name;
      const lookupBrand = req.query.brand || product_brand;
      const r = await db.query(
        `SELECT DISTINCT psi.image_url
         FROM product_siglip_images psi
         JOIN products p ON psi.product_id = p.id
         JOIN brands b ON p.brand_id = b.id
         WHERE LOWER(p.name) = LOWER($1) AND LOWER(b.name) ILIKE LOWER($2)
         LIMIT 30`,
        [lookupName, lookupBrand]
      );
      images = r.rows.map(row => row.image_url).filter(Boolean);
    }

    // Last resort — if still nothing, show the override's own primary image so picker isn't empty
    if (images.length === 0 && override_product_image_url) {
      images = [override_product_image_url];
    }
  } else {
    // Regular (non-override) items and alternatives: fuzzy family + exact siglip
    const lookupName = req.query.name || product_name;
    const lookupBrand = req.query.brand || product_brand;

    const imgResult = await db.query(
      `SELECT DISTINCT pi.image_url
       FROM product_images pi
       WHERE (
         pi.family_id IN (
           SELECT pf.id FROM product_families pf
           JOIN brands b ON pf.brand_id = b.id
           WHERE LOWER(b.name) ILIKE LOWER($2)
             AND (
               LOWER($1) ILIKE LOWER(pf.name) || ' %' OR LOWER($1) = LOWER(pf.name)
               OR LOWER(pf.name) ILIKE LOWER($1) || ' %' OR LOWER(pf.name) = LOWER($1)
             )
         )
         OR pi.variant_id IN (
           SELECT pv.id FROM product_variants_v2 pv
           JOIN brands b ON pv.brand_id = b.id
           WHERE LOWER(b.name) ILIKE LOWER($2)
             AND (
               LOWER($1) ILIKE LOWER(pv.name) || ' %' OR LOWER($1) = LOWER(pv.name)
               OR LOWER(pv.name) ILIKE LOWER($1) || ' %' OR LOWER(pv.name) = LOWER($1)
             )
         )
       )
       LIMIT 30`,
      [lookupName, lookupBrand]
    );

    const siglipResult = await db.query(
      `SELECT DISTINCT psi.image_url
       FROM product_siglip_images psi
       JOIN products p ON psi.product_id = p.id
       JOIN brands b ON p.brand_id = b.id
       WHERE LOWER(p.name) = LOWER($1) AND LOWER(b.name) ILIKE LOWER($2)
       LIMIT 30`,
      [lookupName, lookupBrand]
    );

    images = [
      ...imgResult.rows.map(r => r.image_url),
      ...siglipResult.rows.map(r => r.image_url),
    ].filter(Boolean);

    // Prepend matched product's primary image for non-override items only
    if (product_image_url && !images.includes(product_image_url)) {
      images = [product_image_url, ...images];
    }
  }

  // For alternative lookups, report the alt's own selected_image_url if present
  let selectedImageUrl = override_product_image_url || product_image_url || null;
  if (altIndex !== null) {
    const alts = typeof itemResult.rows[0].alternatives === 'string'
      ? JSON.parse(itemResult.rows[0].alternatives || '[]')
      : (itemResult.rows[0].alternatives || []);
    const alt = alts[altIndex - 1];
    selectedImageUrl = alt?.selected_image_url || alt?.product_image_url || null;
  } else if (isOverrideLookup) {
    // Only report override_product_image_url as selected if it's actually in the returned images
    selectedImageUrl = images.includes(override_product_image_url)
      ? override_product_image_url
      : (images[0] || null);
  }

  res.json({ images, selected_image_url: selectedImageUrl });
}

/**
 * PATCH /api/sessions/:id/items/:itemId/select-image
 * Save a chosen product image for PPT without triggering full override
 * Body: { imageUrl }
 */
async function selectProductImage(req, res) {
  const { id, itemId } = req.params;
  const { imageUrl } = req.body;
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' });

  const { pool: db } = require('../config/database');
  await db.query(
    `UPDATE rfp_session_items SET override_product_image_url = $1 WHERE id = $2 AND session_id = $3`,
    [imageUrl, itemId, id]
  );

  res.json({ item_id: itemId, selected_image_url: imageUrl });
}

/**
 * PATCH /api/sessions/:id/items/:itemId/alternatives/:altIndex/select-image
 * Save a chosen image for a specific approved alternative (stored inside the alternatives JSONB)
 * Body: { imageUrl }
 */
async function selectAlternativeImage(req, res) {
  const { id, itemId, altIndex } = req.params;
  const { imageUrl } = req.body;
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' });

  const idx = parseInt(altIndex); // 1-based
  if (isNaN(idx) || idx < 1) return res.status(400).json({ error: 'Invalid altIndex' });

  const { pool: db } = require('../config/database');
  const result = await db.query(
    `SELECT alternatives FROM rfp_session_items WHERE id = $1 AND session_id = $2`,
    [itemId, id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Item not found' });

  const alts = typeof result.rows[0].alternatives === 'string'
    ? JSON.parse(result.rows[0].alternatives || '[]')
    : (result.rows[0].alternatives || []);

  if (!alts[idx - 1]) return res.status(400).json({ error: 'Alternative not found at that index' });
  alts[idx - 1].selected_image_url = imageUrl;

  await db.query(
    `UPDATE rfp_session_items SET alternatives = $1 WHERE id = $2 AND session_id = $3`,
    [JSON.stringify(alts), itemId, id]
  );

  res.json({ item_id: itemId, alt_index: idx, selected_image_url: imageUrl });
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

  // Bulk-lookup source_url AND specs from products table for all products
  const { pool } = require('../config/database');
  const productLookupMap = {};
  const catalogIdLookupMap = {};
  const allProductPairs = new Set();
  const allCatalogIds = new Set();

  for (const item of approvedItems) {
    for (const product of (item.products || [])) {
      if (product.product_name && product.product_brand) {
        allProductPairs.add(`${product.product_name}|||${product.product_brand}`);
      }
      // Collect catalog product IDs from override notes
      if (product.override_note) {
        const m = product.override_note.match(/Product ID:\s*([\w-]+)/);
        if (m) allCatalogIds.add(m[1]);
      }
    }
  }

  for (const pair of allProductPairs) {
    const [name, brand] = pair.split('|||');
    const { rows } = await pool.query(
      `SELECT p.source_url, p.materials, p.dimensions, p.category, p.description,
              p.designer, p.name, b.name AS brand_name
       FROM products p
       JOIN brands b ON p.brand_id = b.id
       WHERE LOWER(p.name) = LOWER($1) AND LOWER(b.name) = LOWER($2)
       ORDER BY (p.description IS NOT NULL AND p.description != '') DESC
       LIMIT 1`,
      [name, brand]
    );
    if (rows[0]) productLookupMap[pair] = rows[0];
  }

  // Direct UUID lookup for override products (more reliable than name+brand)
  for (const catalogId of allCatalogIds) {
    const { rows } = await pool.query(
      `SELECT p.source_url, p.materials, p.dimensions, p.category, p.description,
              p.designer, p.name, b.name AS brand_name
       FROM products p
       JOIN brands b ON p.brand_id = b.id
       WHERE p.id = $1`,
      [catalogId]
    );
    if (rows[0]) catalogIdLookupMap[catalogId] = rows[0];
  }

  // Returns false for raw scraped tabular data (e.g. "MATERIAL | 63.13\n...")
  const isCleanSpecValue = (val) => {
    const s = String(val).trim();
    if (!s) return false;
    // Reject values that look like percentage/material tables (pipe + number)
    if (/\|\s*\d+\.?\d*/.test(s)) return false;
    if (s.includes('\n') && s.includes('|')) return false;
    return true;
  };

  // Build slides array — each item has multiple approved products
  const slides = approvedItems.map(item => {
    // Process all products for this item
    const products = (item.products || []).map(product => {
      const lookupKey = `${product.product_name}|||${product.product_brand}`;
      // For override products, prefer direct UUID lookup (avoids name+brand ambiguity)
      let dbProduct = productLookupMap[lookupKey] || {};
      if (product.override_note) {
        const m = product.override_note.match(/Product ID:\s*([\w-]+)/);
        if (m && catalogIdLookupMap[m[1]]) dbProduct = catalogIdLookupMap[m[1]];
      }
      const sourceUrl = product.product_url || dbProduct.source_url || null;

      // Build specs: prefer stored product_specs, fall back to DB fields
      let specs = Object.entries(product.product_specs || {})
        .filter(([, v]) => v && isCleanSpecValue(v))
        .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)}: ${String(v).trim()}`);

      if (specs.length === 0 && dbProduct) {
        if (dbProduct.materials && isCleanSpecValue(dbProduct.materials)) specs.push(`Materials: ${dbProduct.materials}`);
        if (dbProduct.dimensions && isCleanSpecValue(dbProduct.dimensions)) specs.push(`Dimensions: ${dbProduct.dimensions}`);
        if (dbProduct.category) specs.push(`Category: ${dbProduct.category}`);
        if (dbProduct.description) specs.push(`Description: ${dbProduct.description}`);
      }

      // Full clean DB details for slide notes (all fields, tabular data filtered)
      const dbDetails = {};
      if (dbProduct.category) dbDetails.category = dbProduct.category;
      if (dbProduct.materials && isCleanSpecValue(dbProduct.materials)) dbDetails.materials = dbProduct.materials;
      if (dbProduct.dimensions) dbDetails.dimensions = dbProduct.dimensions;
      if (dbProduct.designer) dbDetails.designer = dbProduct.designer;
      if (dbProduct.description) dbDetails.description = dbProduct.description;

      return {
        product_name: product.product_name,
        brand: product.product_brand,
        confidence: product.confidence,
        image_url: product.product_image_url,
        source_url: sourceUrl,
        specs,
        dbDetails,
      };
    });

    // Build key specs from primary product specs
    const primarySpecs = Object.entries(item.primary_specs || {})
      .filter(([, v]) => v && isCleanSpecValue(v))
      .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)}: ${String(v).trim()}`);

    return {
      slide_title: item.query,
      rfp_description: item.description || item.query,
      quantity: item.quantity,
      location: item.location,
      rfp_image_url: item.rfp_image_base64,
      is_overridden: item.is_overridden || false,
      key_specs: primarySpecs,
      products,
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

  // Update the item's primary match to the selected alternative.
  // Clear override_product_image_url so the old picked image doesn't carry over to the new product.
  await db.query(
    `UPDATE rfp_session_items SET
      product_name = $1,
      product_brand = $2,
      product_image_url = $3,
      confidence = $4,
      match_source = $5,
      match_explanation = $6,
      selected_alternative = $7,
      override_product_image_url = NULL
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

/**
 * POST /api/sessions/:id/items/:itemId/approve-alternatives
 * Approve multiple alternatives for an RFP item (all will be included in PPT)
 * Body: { alternativeIndices: [1, 2, 3] } (1-based indices)
 */
async function approveMultipleAlternatives(req, res) {
  const { id, itemId } = req.params;
  const { alternativeIndices } = req.body;

  if (!Array.isArray(alternativeIndices) || alternativeIndices.length === 0) {
    return res.status(400).json({ error: 'alternativeIndices must be a non-empty array' });
  }

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

  // Validate all indices exist
  for (const idx of alternativeIndices) {
    if (!alternatives[idx - 1]) {
      return res.status(400).json({ error: `Alternative not found at index ${idx}` });
    }
  }

  // Store approved alternative indices (1-based)
  await db.query(
    `UPDATE rfp_session_items
     SET approved_alternative_indices = $1, review_status = 'approved'
     WHERE id = $2 AND session_id = $3`,
    [JSON.stringify(alternativeIndices), itemId, id]
  );

  // Return approved items
  const approved = alternativeIndices.map(idx => alternatives[idx - 1]);

  res.json({
    item_id: itemId,
    approved_count: alternativeIndices.length,
    approved_alternatives: approved,
    approved_indices: alternativeIndices
  });
}

/**
 * POST /api/sessions/:id/stop
 * Stop the background processing for a session
 */
async function stopSession(req, res) {
  const { id } = req.params;

  // Add to stopped set so background loop will check and exit
  stoppedSessions.add(id);

  // Update session status to reviewing (processing will stop)
  await sessionService.updateSession(id, { status: 'reviewing' });

  logger.info(`[stop] Stop requested for session ${id}`);
  res.json({ stopped: true, sessionId: id });
}

/**
 * POST /api/sessions/:id/items/:itemId/retry
 * Retry processing a single failed item
 */
async function retryItem(req, res) {
  const { id, itemId } = req.params;

  // Verify item exists and actually failed
  const { pool } = require('../config/database');
  const itemResult = await pool.query(
    `SELECT item_index FROM rfp_session_items WHERE id = $1 AND session_id = $2 AND match_source = 'error'`,
    [itemId, id]
  );

  if (!itemResult.rows[0]) {
    return res.status(400).json({ error: 'Item not found or not failed' });
  }

  const itemIndex = itemResult.rows[0].item_index;
  const session = await sessionService.getSession(id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const threshold = session.threshold || 7;
  const imageWeight = session.image_weight || 0.7;

  try {
    // Re-parse the Excel to rebuild item data and image
    // file_base64 is stored as data URI or raw base64
    let fileBase64 = session.file_base64;
    if (fileBase64.startsWith('data:')) {
      // Strip data URI prefix if present
      fileBase64 = fileBase64.split(',')[1];
    }
    const fileBuffer = Buffer.from(fileBase64, 'base64');
    const parsed = await rfpParserService.parse(fileBuffer, 'session.xlsx');

    if (!parsed.items[itemIndex]) {
      return res.status(400).json({ error: 'Item index not found in parsed data' });
    }

    const itemData = parsed.items[itemIndex];

    // Extract images from the Excel file
    let rfpImageData = null;
    try {
      const extractedImages = await visionService.extractImagesFromExcel(fileBuffer);
      for (const img of extractedImages) {
        if (img.row - 1 === itemData._dataRow && img.base64) {
          rfpImageData = { base64: img.base64, extension: img.extension };
          break;
        }
      }
    } catch (imgErr) {
      logger.warn(`[retry] Image extraction failed for item ${itemIndex}: ${imgErr.message}`);
    }

    // Pre-load SigLIP model if not already loaded
    await initSigLIPModel();

    // Re-process the item
    const result = await processOneItem(itemIndex, itemData, rfpImageData, threshold, 2, imageWeight, id);

    // Delete old failed entry and save new result
    await pool.query(
      `DELETE FROM rfp_session_items WHERE session_id = $1 AND item_index = $2`,
      [id, itemIndex]
    );
    await sessionService.saveSessionItem(id, itemIndex, result);

    logger.info(`[retry] Retry succeeded for session ${id}, item ${itemIndex}`);
    res.json({ success: true, itemId, processed: true });
  } catch (err) {
    logger.error(`[retry] Retry failed for session ${id}, item ${itemIndex}: ${err.message}`);
    res.status(500).json({ error: 'Retry processing failed', details: err.message });
  }
}

/**
 * POST /api/sessions/:id/resume
 * Resume processing for unprocessed items in a stopped session
 */
async function resumeSession(req, res) {
  const { id } = req.params;
  const { pool } = require('../config/database');

  // Get session
  const session = await sessionService.getSession(id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Can only resume if session is in 'reviewing' status (was stopped)
  if (session.status !== 'reviewing') {
    return res.status(400).json({ error: 'Can only resume stopped sessions (status: reviewing)' });
  }

  // Check if there are unprocessed items
  const processedCount = await pool.query(
    `SELECT COUNT(*)::int as count FROM rfp_session_items WHERE session_id = $1`,
    [id]
  );
  const processed = processedCount.rows[0].count;
  const total = session.total_items || 0;

  if (processed >= total) {
    return res.status(400).json({ error: 'All items already processed' });
  }

  try {
    // Clear the stop flag in case this session was previously stopped
    stoppedSessions.delete(id);

    // Re-parse Excel and extract images
    let fileBase64 = session.file_base64;
    if (fileBase64.startsWith('data:')) {
      fileBase64 = fileBase64.split(',')[1];
    }
    const fileBuffer = Buffer.from(fileBase64, 'base64');
    const parsed = await rfpParserService.parse(fileBuffer, 'session.xlsx');

    logger.info(`[resume] Session ${id}: parsed ${parsed.items.length} items, ${processed} already processed`);

    // Extract images
    let extractedImages = [];
    try {
      extractedImages = await visionService.extractImagesFromExcel(fileBuffer);
    } catch (err) {
      logger.error(`[resume] Image extraction failed: ${err.message}`);
    }

    const imageDataByRow = {};
    for (const img of extractedImages) {
      if (img.base64) imageDataByRow[img.row - 1] = { base64: img.base64, extension: img.extension };
    }

    // Build image-to-item mapping
    const itemImageMap = {};
    for (let i = 0; i < parsed.items.length; i++) {
      if (imageDataByRow[parsed.items[i]._dataRow]) {
        itemImageMap[i] = imageDataByRow[parsed.items[i]._dataRow];
      }
    }

    // Find which item indices are already processed
    const existingIndices = await pool.query(
      `SELECT item_index FROM rfp_session_items WHERE session_id = $1`,
      [id]
    );
    const processedIndices = new Set(existingIndices.rows.map(r => r.item_index));

    // Identify unprocessed items
    const unprocessedIndices = [];
    for (let i = 0; i < parsed.items.length; i++) {
      if (!processedIndices.has(i)) {
        unprocessedIndices.push(i);
      }
    }

    if (unprocessedIndices.length === 0) {
      return res.status(400).json({ error: 'No unprocessed items to resume' });
    }

    logger.info(`[resume] Session ${id}: resuming with ${unprocessedIndices.length} unprocessed items`);

    // Update session status back to processing
    await sessionService.updateSession(id, { status: 'processing' });

    // Fire background processing for unprocessed items only
    resumeProcessingInBackground(
      id,
      parsed,
      itemImageMap,
      unprocessedIndices,
      session.threshold || 7,
      session.image_weight || 0.7
    ).catch(err => {
      logger.error(`[resume] Background processing error: ${err.message}`);
      sessionService.updateSession(id, { status: 'reviewing', completed_at: new Date() }).catch(() => {});
    });

    res.json({ resumed: true, sessionId: id, unprocessedCount: unprocessedIndices.length });
  } catch (err) {
    logger.error(`[resume] Resume failed for session ${id}: ${err.message}`);
    res.status(500).json({ error: 'Resume processing failed', details: err.message });
  }
}

/**
 * Background processor for resumed items (processes only unprocessed item indices)
 */
async function resumeProcessingInBackground(sessionId, parsed, itemImageMap, unprocessedIndices, threshold, imageWeight = 0.7) {
  const CONCURRENCY = 1;

  // Pre-load SigLIP model once
  await initSigLIPModel();

  // Process unprocessed items in batches
  for (let batchIdx = 0; batchIdx < unprocessedIndices.length; batchIdx += CONCURRENCY) {
    // Check if stop was requested
    if (stoppedSessions.has(sessionId)) {
      logger.info(`[resume-process] Session ${sessionId} stop requested — halting at item ${batchIdx}`);
      stoppedSessions.delete(sessionId);
      await sessionService.updateSession(sessionId, { status: 'reviewing', completed_at: new Date() });
      return;
    }

    const batchEnd = Math.min(batchIdx + CONCURRENCY, unprocessedIndices.length);
    const batch = [];

    for (let i = batchIdx; i < batchEnd; i++) {
      const itemIndex = unprocessedIndices[i];
      batch.push(processOneItem(itemIndex, parsed.items[itemIndex], itemImageMap[itemIndex] || null, threshold, 2, imageWeight, sessionId));
    }

    const batchResults = await Promise.all(batch);

    // Check if stop was requested during item processing
    if (stoppedSessions.has(sessionId)) {
      logger.info(`[resume-process] Session ${sessionId} stop requested after batch processing — halting`);
      stoppedSessions.delete(sessionId);
      await sessionService.updateSession(sessionId, { status: 'reviewing', completed_at: new Date() });
      return;
    }

    // Save each completed item to DB
    for (let j = 0; j < batchResults.length; j++) {
      const itemIndex = unprocessedIndices[batchIdx + j];
      try {
        await sessionService.saveSessionItem(sessionId, itemIndex, batchResults[j]);
      } catch (err) {
        logger.error(`[resume-process] Failed to save item ${itemIndex}: ${err.message}`);
      }
    }

    logger.info(`[resume-process] Session ${sessionId}: processed items ${batchIdx + 1}-${batchEnd} of ${unprocessedIndices.length}`);

    // Pause between batches
    if (batchEnd < unprocessedIndices.length) {
      await new Promise(r => setTimeout(r, 15000));

      // Check again if stop was requested during the delay
      if (stoppedSessions.has(sessionId)) {
        logger.info(`[resume-process] Session ${sessionId} stop requested during delay — halting`);
        stoppedSessions.delete(sessionId);
        await sessionService.updateSession(sessionId, { status: 'reviewing', completed_at: new Date() });
        return;
      }
    }
  }

  // Mark session as ready for review
  const completedAt = new Date();
  const sessionRow = await sessionService.getSession(sessionId);
  const startedAt = sessionRow?.started_at ? new Date(sessionRow.started_at) : null;
  const processingTimeMs = startedAt ? completedAt - startedAt : null;

  await sessionService.updateSession(sessionId, {
    status: 'reviewing',
    completed_at: completedAt,
    ...(processingTimeMs !== null && { processing_time_ms: processingTimeMs }),
  });
  logger.info(`[resume-process] Session ${sessionId}: resumed processing complete (${unprocessedIndices.length} items)`);
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
  approveMultipleAlternatives,
  generateFromSession,
  overrideItem,
  getProductImages,
  selectProductImage,
  selectAlternativeImage,
  stopSession,
  retryItem,
  resumeSession,
};
