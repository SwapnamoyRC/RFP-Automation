const XLSX = require('xlsx');
const rfpParserService = require('../services/rfp-parser.service');
const searchService = require('../services/search.service');
const pptxGenerator = require('../services/pptx-generator.service');
const visionService = require('../services/vision.service');
const logger = require('../config/logger');

/**
 * Rescale raw cosine similarity to a more intuitive confidence percentage.
 * Raw text-embedding-3-small scores are compressed: 65-85% for exact matches.
 * This maps them to a ~75-99% range that better reflects actual match quality.
 *
 * Calibration: floor=0.40 (random noise), ceiling=0.85 (perfect name match)
 */
function rescaleConfidence(rawSimilarity) {
  const floor = 0.40;
  const ceiling = 0.85;
  const normalized = (rawSimilarity - floor) / (ceiling - floor);
  const clamped = Math.max(0, Math.min(1, normalized));
  const curved = Math.pow(clamped, 0.8);
  return Math.round(curved * 100) / 100;
}

/**
 * POST /api/rfp/parse
 * Upload an Excel RFP file, parse it, return extracted line items.
 */
async function parseRFP(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Send an Excel file as "file" field.' });
  }

  const result = rfpParserService.parse(req.file.buffer, req.file.originalname);
  res.json(result);
}

/**
 * POST /api/rfp/process
 * Upload an Excel RFP file, parse it, search products for each line item,
 * and return matched results ready for slide generation.
 */
async function processRFP(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Send an Excel file as "file" field.' });
  }

  const threshold = parseFloat(req.body.threshold) || 0.4;
  const limit = parseInt(req.body.limit) || 3;

  // Step 1: Parse the RFP
  const parsed = rfpParserService.parse(req.file.buffer, req.file.originalname);
  logger.info(`Processing ${parsed.items.length} RFP line items`);

  // Step 2: Search for each item
  const results = [];
  for (const item of parsed.items) {
    try {
      const searchResult = await searchService.search(item.query, {
        brand: item.brand,
        // Don't filter by category — parser categories often don't match DB categories,
        // and vector similarity already handles finding the right product type.
        limit,
        threshold,
        embeddingType: 'product_description'
      });

      const best = searchResult.results[0] || null;
      results.push({
        rfp_line: item.rfp_line,
        query: item.query,
        description: item.description,
        quantity: item.quantity,
        location: item.location,
        notes: item.notes,
        matched: !!best,
        confidence: best ? best.similarity : 0,
        matchedOn: best ? best.matchedOn : null,
        product: best ? best.product : null,
        alternatives: searchResult.results.slice(1, 3).map(r => ({
          name: r.product.name,
          brand: r.product.brand,
          similarity: r.similarity
        }))
      });
    } catch (err) {
      logger.error(`Search failed for line ${item.rfp_line}: ${err.message}`);
      results.push({
        rfp_line: item.rfp_line,
        query: item.query,
        description: item.description,
        quantity: item.quantity,
        location: item.location,
        notes: item.notes,
        matched: false,
        confidence: 0,
        product: null,
        alternatives: [],
        error: err.message
      });
    }
  }

  const highConfidence = results.filter(r => r.confidence >= 0.55);
  const lowConfidence = results.filter(r => r.confidence < 0.55);

  res.json({
    meta: parsed.meta,
    summary: {
      total: results.length,
      matched: highConfidence.length,
      needsReview: lowConfidence.length
    },
    results,
    highConfidence,
    lowConfidence
  });
}

/**
 * POST /api/rfp/process-base64
 * Accept file as base64 string in JSON body (for n8n compatibility).
 * Body: { fileBase64: "...", fileName: "file.xlsx", threshold: 0.4, limit: 3 }
 */
async function processRFPBase64(req, res) {
  const { fileBase64, fileName, threshold: thresholdStr, limit: limitStr } = req.body;

  if (!fileBase64) {
    return res.status(400).json({ error: 'Missing fileBase64 field in request body.' });
  }

  const threshold = parseFloat(thresholdStr) || 0.4;
  const limit = parseInt(limitStr) || 3;

  // --- DEBUG: Diagnose base64 decoding and XLSX parsing ---
  const base64Length = fileBase64.length;
  // Strip data-URI prefix if present (e.g. "data:application/...;base64,")
  const base64Clean = fileBase64.includes(',') ? fileBase64.split(',').pop() : fileBase64;
  const fileBuffer = Buffer.from(base64Clean, 'base64');

  logger.info(`[base64-debug] fileName=${fileName || 'upload.xlsx'}`);
  logger.info(`[base64-debug] raw base64 string length: ${base64Length}`);
  logger.info(`[base64-debug] cleaned base64 string length: ${base64Clean.length}`);
  logger.info(`[base64-debug] decoded buffer size: ${fileBuffer.length} bytes`);
  logger.info(`[base64-debug] first 16 bytes (hex): ${fileBuffer.slice(0, 16).toString('hex')}`);

  // XLSX (ZIP) files start with PK header: 50 4b 03 04
  const isZipHeader = fileBuffer.length >= 4
    && fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4b
    && fileBuffer[2] === 0x03 && fileBuffer[3] === 0x04;
  logger.info(`[base64-debug] looks like valid XLSX/ZIP (PK header): ${isZipHeader}`);

  let parsed;
  try {
    // Try reading with XLSX directly first so we can log sheet-level detail
    const wb = XLSX.read(fileBuffer, { type: 'buffer' });
    logger.info(`[base64-debug] XLSX.read succeeded — sheets: ${JSON.stringify(wb.SheetNames)}`);

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      logger.info(`[base64-debug] Sheet "${sheetName}": ${rows.length} rows`);

      // Log first 5 rows so we can see what the parser is working with
      const preview = rows.slice(0, 5).map((r, idx) => `  row ${idx}: ${JSON.stringify(r)}`);
      logger.info(`[base64-debug] Sheet "${sheetName}" preview:\n${preview.join('\n')}`);

      // Run format detection manually and log the result
      const detection = rfpParserService._detectFormat(rows);
      logger.info(`[base64-debug] Sheet "${sheetName}" _detectFormat => headerRow=${detection.headerRow}, format=${detection.format}`);
    }

    // Now run the full parse (will repeat the work above, but keeps service API clean)
    parsed = rfpParserService.parse(fileBuffer, fileName || 'upload.xlsx');
    logger.info(`[base64-debug] parse returned ${parsed.items.length} items`);

    if (parsed.items.length === 0) {
      logger.warn('[base64-debug] 0 items parsed — possible causes: header row not detected, data-URI prefix not stripped, or file is not a real XLSX');
    }
  } catch (err) {
    logger.error(`[base64-debug] XLSX parsing failed: ${err.message}`);
    logger.error(`[base64-debug] Stack: ${err.stack}`);
    return res.status(400).json({
      error: 'Failed to parse the uploaded Excel file from base64.',
      detail: err.message,
      debug: {
        base64Length,
        cleanedBase64Length: base64Clean.length,
        bufferSize: fileBuffer.length,
        first16BytesHex: fileBuffer.slice(0, 16).toString('hex'),
        isZipHeader
      }
    });
  }
  // --- END DEBUG ---

  logger.info(`Processing ${parsed.items.length} RFP line items (base64)`);

  const results = [];
  for (const item of parsed.items) {
    try {
      // Always search with low threshold to get closest match for manual review context
      // The n8n Confidence Gate handles the actual filtering
      const searchResult = await searchService.search(item.query, {
        brand: item.brand,
        limit,
        threshold: 0.1,
        embeddingType: 'product_description'
      });

      const best = searchResult.results[0] || null;
      results.push({
        rfp_line: item.rfp_line,
        query: item.query,
        description: item.description,
        quantity: item.quantity,
        location: item.location,
        notes: item.notes,
        matched: best ? best.similarity >= threshold : false,
        confidence: best ? rescaleConfidence(best.similarity) : 0,
        raw_similarity: best ? best.similarity : 0,
        matchedOn: best ? best.matchedOn : null,
        product: best ? best.product : null,
        alternatives: searchResult.results.slice(1, 3).map(r => ({
          name: r.product.name,
          brand: r.product.brand,
          similarity: rescaleConfidence(r.similarity)
        }))
      });
    } catch (err) {
      logger.error(`Search failed for line ${item.rfp_line}: ${err.message}`);
      results.push({
        rfp_line: item.rfp_line,
        query: item.query,
        description: item.description,
        quantity: item.quantity,
        location: item.location,
        notes: item.notes,
        matched: false,
        confidence: 0,
        product: null,
        alternatives: [],
        error: err.message
      });
    }
  }

  const highConfidence = results.filter(r => r.confidence >= 0.55);
  const lowConfidence = results.filter(r => r.confidence < 0.55);

  res.json({
    meta: parsed.meta,
    summary: {
      total: results.length,
      matched: highConfidence.length,
      needsReview: lowConfidence.length
    },
    results,
    highConfidence,
    lowConfidence
  });
}

/**
 * POST /api/rfp/generate-pptx
 * Accept slide content array and generate a downloadable PowerPoint file.
 * Body: { clientName: "...", slides: [{ slide_title, recommendation, specs[], product_name, brand, confidence, quantity, location }] }
 */
async function generatePptx(req, res) {
  const { clientName, slides } = req.body;

  if (!slides || !Array.isArray(slides) || slides.length === 0) {
    return res.status(400).json({ error: 'Missing or empty slides array in request body.' });
  }

  try {
    const pptxBuffer = await pptxGenerator.generatePptx({
      clientName: clientName || 'Client',
      slides
    });

    const fileName = `RFP_Response_${(clientName || 'Client').replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.pptx`;

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': pptxBuffer.length
    });
    res.send(pptxBuffer);
  } catch (err) {
    logger.error(`PPTX generation failed: ${err.message}`);
    res.status(500).json({ error: 'Failed to generate PowerPoint.', detail: err.message });
  }
}

/**
 * POST /api/rfp/process-images-base64
 * Accept Excel file as base64, extract embedded images, use GPT-4o Vision
 * to describe each image, then search against product embeddings.
 * Body: { fileBase64: "...", fileName: "file.xlsx", threshold: 0.4, limit: 3 }
 */
async function processRFPImagesBase64(req, res) {
  const { fileBase64, fileName, threshold: thresholdStr, limit: limitStr } = req.body;

  if (!fileBase64) {
    return res.status(400).json({ error: 'Missing fileBase64 field in request body.' });
  }

  const threshold = parseFloat(thresholdStr) || 0.45;
  const limit = parseInt(limitStr) || 3;

  // Decode base64 to buffer
  const base64Clean = fileBase64.includes(',') ? fileBase64.split(',').pop() : fileBase64;
  const fileBuffer = Buffer.from(base64Clean, 'base64');

  logger.info(`[image-rfp] Processing ${fileName || 'upload.xlsx'} (${fileBuffer.length} bytes), threshold=${threshold}`);

  // Step 1: Parse text line items (for metadata: quantity, location, line numbers)
  let parsed;
  try {
    parsed = rfpParserService.parse(fileBuffer, fileName || 'upload.xlsx');
    logger.info(`[image-rfp] Parsed ${parsed.items.length} text line items`);
  } catch (err) {
    logger.error(`[image-rfp] Text parsing failed: ${err.message}`);
    return res.status(400).json({ error: 'Failed to parse Excel file.', detail: err.message });
  }

  // Step 2: Extract and describe images via Vision API
  let imageDescriptions;
  try {
    imageDescriptions = await visionService.processExcelImages(fileBuffer);
    logger.info(`[image-rfp] Got ${imageDescriptions.length} image descriptions`);
  } catch (err) {
    logger.error(`[image-rfp] Image extraction failed: ${err.message}`);
    return res.status(500).json({ error: 'Failed to extract/describe images.', detail: err.message });
  }

  // Step 3: Build row-based lookup maps for images
  // Key by row number for O(1) lookup. Items without a matching image get text-only search.
  const imageByRow = {};
  const imageDataByRow = {};
  for (const img of imageDescriptions) {
    if (img.description) imageByRow[img.row] = img.description;
    if (img.base64) imageDataByRow[img.row] = { base64: img.base64, extension: img.extension };
  }

  const imageRows = imageDescriptions.map(img => img.row).sort((a, b) => a - b);
  logger.info(`[image-rfp] ${imageDescriptions.length} images at rows: [${imageRows.join(', ')}]`);
  logger.info(`[image-rfp] ${parsed.items.length} items at _dataRows: [${parsed.items.map(it => it._dataRow).join(', ')}]`);

  // Search for each item
  const results = [];
  for (let i = 0; i < parsed.items.length; i++) {
    const item = parsed.items[i];

    // Exact row match only — no ±1 tolerance to prevent cross-contamination
    // Items without images get text-only search and no RFP Reference in PPT
    const dr = item._dataRow;
    const imgDesc = imageByRow[dr] || null;
    const rfpImageData = imageDataByRow[dr] || null;

    if (imgDesc) {
      logger.info(`[image-rfp] Item ${i} "${item.query}" (row ${dr}) ← image at row ${dr}`);
    } else {
      logger.info(`[image-rfp] Item ${i} "${item.query}" (row ${dr}) ← NO image (text-only search)`);
    }

    try {
      // Build search candidates: text-only, image-only, and combined
      const candidates = [];

      // 1. Text-only search (always run)
      // Strip "location - product" prefixes (e.g. "boardroom lounge - Center table" → "Center table")
      const textQuery = item.query
        .replace(/^[\w\s]+([-–—])\s+/i, '')  // strip everything before first dash separator
        .trim() || item.query;
      const textSearch = await searchService.search(textQuery, {
        brand: item.brand,
        limit,
        threshold: 0.1,
        embeddingType: 'product_description'
      });
      if (textSearch.results[0]) {
        candidates.push({ search: textSearch, best: textSearch.results[0], source: 'text' });
      }

      if (imgDesc) {
        // 2. Image-only search against product_description embeddings
        const imgSearch = await searchService.search(imgDesc, {
          limit,
          threshold: 0.1,
          embeddingType: 'product_description'
        });
        if (imgSearch.results[0]) {
          candidates.push({ search: imgSearch, best: imgSearch.results[0], source: 'image' });
        }

        // 3. Image-only search against image_description embeddings (Vision vs Vision - strongest signal)
        const imgVsImgSearch = await searchService.search(imgDesc, {
          limit,
          threshold: 0.1,
          embeddingType: 'image_description',
          includeImageEmbeddings: false  // don't double-search image_description
        });
        if (imgVsImgSearch.results[0]) {
          candidates.push({ search: imgVsImgSearch, best: imgVsImgSearch.results[0], source: 'image_vs_image' });
        }

        // 4. Combined search: clean product type + vision description
        const cleanType = item.query.replace(/\d+\s*mm/gi, '').replace(/\(.*?\)/g, '').replace(/[xX×]\s*\d+/g, '').trim();
        const combinedQuery = `${cleanType} furniture. ${imgDesc}`;
        const combinedSearch = await searchService.search(combinedQuery, {
          limit,
          threshold: 0.1,
          embeddingType: 'product_description'
        });
        if (combinedSearch.results[0]) {
          candidates.push({ search: combinedSearch, best: combinedSearch.results[0], source: 'combined' });
        }
      }

      // Log all candidates for debugging
      for (const c of candidates) {
        logger.info(`[image-rfp] Line ${item.rfp_line} "${item.query}" — ${c.source}: ${c.best.product.name} (${(c.best.similarity * 100).toFixed(1)}%)`);
      }

      // Smart selection: prefer image/combined results when an image is present
      // Text queries with dimensions get artificially high similarity but poor matches
      let bestResult;
      const imageCandidate = candidates.find(c => c.source === 'image');
      const imageVsImageCandidate = candidates.find(c => c.source === 'image_vs_image');
      const combinedCandidate = candidates.find(c => c.source === 'combined');
      const textCandidate = candidates.find(c => c.source === 'text');

      if (imgDesc && (imageCandidate || imageVsImageCandidate || combinedCandidate)) {
        const imgBest = imageCandidate?.best;
        const imgVsImgBest = imageVsImageCandidate?.best;
        const combBest = combinedCandidate?.best;
        const txtBest = textCandidate?.best;

        // Pick the best visual candidate (image_vs_image is strongest — Vision vs Vision)
        const visualCandidates = [imageCandidate, imageVsImageCandidate, combinedCandidate].filter(Boolean);
        visualCandidates.sort((a, b) => b.best.similarity - a.best.similarity);
        const visualBest = visualCandidates[0];

        // Check ALL text search results for name match (not just #1)
        // Uses bidirectional matching: query words in product AND product words in query
        let textNameMatch = false;
        let nameMatchResult = null;  // may differ from txtBest
        const queryNorm = item.query.toLowerCase().replace(/[\/\-–—,.\s]+/g, ' ').trim();
        const queryWords = queryNorm.split(' ').filter(w => w.length > 2);
        // Common furniture words that shouldn't count as distinctive matches
        const genericWords = new Set(['table', 'chair', 'sofa', 'lamp', 'light', 'desk', 'shelf', 'stool', 'bench', 'bed', 'cabinet', 'coffee', 'side', 'dining', 'arm', 'armchair', 'lounge', 'pendant', 'floor', 'wall', 'large', 'small', 'medium', 'base', 'tube', 'wood', 'sled', 'swivel', 'seater', 'seat', 'high', 'low', 'round', 'square', 'steel', 'outdoor', 'indoor', 'modular', 'portable', 'mini']);

        if (textCandidate) {
          let bestNameScore = 0;
          for (const result of textCandidate.search.results) {
            const productNorm = result.product.name.toLowerCase().replace(/[\/\-–—,.\s]+/g, ' ').trim();
            const productWords = productNorm.split(' ').filter(w => w.length > 2);

            // Forward: what % of product name words appear in query?
            const fwdMatching = productWords.filter(w => queryNorm.includes(w));
            const fwdRatio = productWords.length > 0 ? fwdMatching.length / productWords.length : 0;

            // Backward: what % of query's distinctive words appear in product name?
            const distinctiveQueryWords = queryWords.filter(w => !genericWords.has(w));
            const bwdMatching = distinctiveQueryWords.filter(w => productNorm.includes(w));
            const bwdRatio = distinctiveQueryWords.length > 0 ? bwdMatching.length / distinctiveQueryWords.length : 0;

            // Both directions must be strong — prevents "Halves Coffee Table" matching "AROUND COFFEE TABLE"
            // because "halves" is NOT in query (fwd fails) and "around" is NOT in "halves" (bwd fails)
            const score = Math.min(fwdRatio, bwdRatio);

            if (score >= 0.6 && score > bestNameScore) {
              bestNameScore = score;
              nameMatchResult = result;
              logger.info(`[image-rfp] Line ${item.rfp_line}: NAME MATCH candidate "${result.product.name}" — fwd=${(fwdRatio*100).toFixed(0)}% bwd=${(bwdRatio*100).toFixed(0)}% score=${(score*100).toFixed(0)}% sim=${(result.similarity*100).toFixed(1)}%`);
            }
          }
          if (nameMatchResult) {
            textNameMatch = true;
            logger.info(`[image-rfp] Line ${item.rfp_line}: BEST NAME MATCH → "${nameMatchResult.product.name}" (score=${(bestNameScore*100).toFixed(0)}%)`);
          }
        }

        // Check if any visual and text agree on the same product
        const anyVisualAgrees = txtBest && visualCandidates.some(c => c.best.product.name === txtBest.product.name);

        if (anyVisualAgrees) {
          // Text and at least one visual source agree — use the one with highest similarity
          const agreeingVisual = visualCandidates.find(c => c.best.product.name === txtBest.product.name);
          bestResult = agreeingVisual.best.similarity >= txtBest.similarity ? agreeingVisual : textCandidate;
          logger.info(`[image-rfp] Line ${item.rfp_line}: AGREE on "${txtBest.product.name}" → ${bestResult.source} (${(bestResult.best.similarity*100).toFixed(1)}%)`);
        } else if (textNameMatch && nameMatchResult) {
          // Text query clearly identifies product by name — trust the name-matched result
          // Create a synthetic candidate with the name-matched result as best
          bestResult = { search: textCandidate.search, best: nameMatchResult, source: 'text_name_match' };
          logger.info(`[image-rfp] Line ${item.rfp_line}: NAME MATCH → using "${nameMatchResult.product.name}" (${(nameMatchResult.similarity*100).toFixed(1)}%)`);
        } else {
          // Disagree, no name match — use best visual result
          bestResult = visualBest;
          if (txtBest) {
            logger.info(`[image-rfp] Line ${item.rfp_line}: DISAGREE — visual="${visualBest.best.product.name}" (${(visualBest.best.similarity*100).toFixed(1)}%) [${visualBest.source}] vs text="${txtBest.product.name}" (${(txtBest.similarity*100).toFixed(1)}%) → using visual`);
          }
        }
      } else {
        // No image — just pick highest similarity
        candidates.sort((a, b) => b.best.similarity - a.best.similarity);
        bestResult = candidates[0] || null;
      }

      const best = bestResult?.best || null;
      const searchResult = bestResult?.search || { results: [] };

      // Build RFP image data URI for PPT (use RFP image instead of database image)
      let rfpImageUrl = null;
      if (rfpImageData) {
        const mimeType = rfpImageData.extension === 'jpg' ? 'jpeg' : rfpImageData.extension;
        rfpImageUrl = `data:image/${mimeType};base64,${rfpImageData.base64}`;
      }

      results.push({
        rfp_line: item.rfp_line,
        query: item.query,
        description: item.description,
        image_description: imgDesc || null,
        match_source: bestResult?.source || 'none',
        quantity: item.quantity,
        location: item.location,
        notes: item.notes,
        matched: best ? best.similarity >= threshold : false,
        confidence: best ? rescaleConfidence(best.similarity) : 0,
        raw_similarity: best ? best.similarity : 0,
        matchedOn: best ? best.matchedOn : null,
        rfp_image_url: rfpImageUrl || null,
        product: best ? best.product : null,
        alternatives: searchResult.results.slice(1, 3).map(r => ({
          name: r.product.name,
          brand: r.product.brand,
          similarity: rescaleConfidence(r.similarity)
        }))
      });

      logger.info(`[image-rfp] Line ${item.rfp_line}: ${bestResult?.source || 'none'} match, confidence=${best ? best.similarity.toFixed(3) : 0}`);
    } catch (err) {
      logger.error(`[image-rfp] Search failed for line ${item.rfp_line}: ${err.message}`);
      results.push({
        rfp_line: item.rfp_line,
        query: item.query,
        description: item.description,
        image_description: imgDesc || null,
        match_source: 'error',
        quantity: item.quantity,
        location: item.location,
        notes: item.notes,
        matched: false,
        confidence: 0,
        product: null,
        alternatives: [],
        error: err.message
      });
    }
  }

  const matched = results.filter(r => r.matched);
  const needsReview = results.filter(r => !r.matched);

  res.json({
    meta: {
      ...parsed.meta,
      imagesExtracted: imageDescriptions.length,
      imagesDescribed: imageDescriptions.filter(d => d.description).length
    },
    summary: {
      total: results.length,
      matched: matched.length,
      needsReview: needsReview.length,
      matchedByImage: results.filter(r => r.match_source === 'image').length,
      matchedByText: results.filter(r => r.match_source === 'text').length
    },
    results,
    highConfidence: matched,
    lowConfidence: needsReview
  });
}

module.exports = { parseRFP, processRFP, processRFPBase64, generatePptx, processRFPImagesBase64 };
