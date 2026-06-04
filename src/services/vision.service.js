const openaiConfig = require('../config/openai');
const logger = require('../config/logger');

logger.info('[vision] Using GPT-4o for image description');

class VisionService {
  /**
   * Extract images directly from the xlsx ZIP structure.
   * More reliable than ExcelJS getImages() which fails on Excel Online/OneDrive files.
   * Returns array of { row, col, base64, extension, size }
   */
  async _extractImagesViaZip(fileBuffer) {
    const JSZip = require('jszip');
    let zip;
    try {
      zip = await JSZip.loadAsync(fileBuffer);
    } catch (e) {
      logger.warn(`[image-extract-zip] Failed to open as ZIP: ${e.message}`);
      return [];
    }

    const allPaths = Object.keys(zip.files).filter(p => !zip.files[p].dir);
    const relevantPaths = allPaths.filter(p => p.includes('drawing') || p.includes('_rels') || p.includes('richData') || p.includes('cellImage'));
    logger.info(`[image-extract-zip] ZIP structure (drawing/rels/rich): ${JSON.stringify(relevantPaths)}`);

    // Build media map: filename -> { buffer, extension }
    const imgExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp', 'emf', 'wmf']);
    const mediaMap = {};
    const mediaOrder = []; // ordered list of filenames for index-based fallback
    // Natural numeric sort so image10 comes after image9, not after image1
    const naturalSort = (a, b) => {
      const numA = parseInt((a.match(/(\d+)(?=\.\w+$)/) || [0, 0])[1]);
      const numB = parseInt((b.match(/(\d+)(?=\.\w+$)/) || [0, 0])[1]);
      return numA - numB || a.localeCompare(b);
    };
    for (const p of allPaths.filter(p => p.startsWith('xl/media/')).sort(naturalSort)) {
      const fname = p.split('/').pop();
      const ext = (fname.split('.').pop() || 'png').toLowerCase();
      if (!imgExts.has(ext)) continue;
      const buf = await zip.files[p].async('nodebuffer');
      if (buf.length < 2000) continue;
      mediaMap[fname] = { buffer: buf, extension: ext === 'jpeg' ? 'jpg' : ext };
      mediaOrder.push(fname);
    }
    logger.info(`[image-extract-zip] Found ${mediaOrder.length} media files in xl/media/`);
    if (mediaOrder.length === 0) return [];

    // Helper: parse all <Relationship> elements regardless of attribute order or self-closing style
    function parseRels(xml) {
      const rels = {};
      // Match both self-closing <Relationship .../> and non-self-closing <Relationship ...>
      const re = /<Relationship\b([^>]*?)(?:\/?>|>)/g;
      let m;
      while ((m = re.exec(xml)) !== null) {
        const attrs = m[1];
        const id = (attrs.match(/\bId="([^"]+)"/) || [])[1];
        const type = (attrs.match(/\bType="([^"]+)"/) || [])[1];
        const target = (attrs.match(/\bTarget="([^"]+)"/) || [])[1];
        if (id) rels[id] = { type: type || '', target: target || '' };
      }
      return rels;
    }

    // Helper: position-based drawing XML parser.
    // Works regardless of namespace prefix, anchor element name, or attribute order.
    // Strategy: find all <*:from> positions + row numbers, find all r:embed positions + rIds,
    // then for each embed find the nearest preceding from-block to get its row.
    function parseDrawingAnchors(drawingXml, rIdToMedia, drawingLabel) {
      const found = [];

      // Collect all <*:from> blocks with their positions and row/col values
      const fromItems = [];
      const fromRe = /<[^:>\s]*:?from\b[^>]*>([\s\S]*?)<\/[^:>\s]*:?from>/g;
      let fm;
      while ((fm = fromRe.exec(drawingXml)) !== null) {
        const block = fm[1];
        const rowM = block.match(/<[^:>\s]*:?row\b[^>]*>(\d+)<\/[^:>\s]*:?row>/);
        const colM = block.match(/<[^:>\s]*:?col\b[^>]*>(\d+)<\/[^:>\s]*:?col>/);
        if (rowM) fromItems.push({ pos: fm.index, row: parseInt(rowM[1]), col: colM ? parseInt(colM[1]) : -1 });
      }

      // Collect all r:embed (or any ns:embed) occurrences with their positions
      const embedItems = [];
      const embedRe = /[a-z0-9]+:embed="(rId[^"]+)"/gi;
      let em;
      while ((em = embedRe.exec(drawingXml)) !== null) {
        embedItems.push({ pos: em.index, rId: em[1] });
      }

      logger.info(`[image-extract-zip] ${drawingLabel}: ${fromItems.length} from-blocks, ${embedItems.length} embeds, ${Object.keys(rIdToMedia).length} rIdToMedia entries`);

      if (fromItems.length === 0 || embedItems.length === 0) {
        // Log a snippet to help diagnose the XML structure
        logger.info(`[image-extract-zip] ${drawingLabel} XML snippet (first 800): ${drawingXml.substring(0, 800).replace(/\s+/g, ' ')}`);
        return found;
      }

      // For each embed, find the from-block immediately before it (within the same anchor block)
      for (const embed of embedItems) {
        const precedingFroms = fromItems.filter(f => f.pos < embed.pos);
        if (precedingFroms.length === 0) continue;
        const fromItem = precedingFroms[precedingFroms.length - 1]; // nearest preceding from

        const mediaFile = rIdToMedia[embed.rId];
        if (!mediaFile || !mediaMap[mediaFile]) continue;
        const { buffer, extension } = mediaMap[mediaFile];
        // Drawing XML rows are 0-indexed; add 1 to match ExcelJS 1-indexed convention
        // (controller does img.row - 1 to get _dataRow, so row=2 → _dataRow=1 = first data row)
        found.push({ row: fromItem.row + 1, col: fromItem.col, base64: buffer.toString('base64'), extension, size: buffer.length });
      }
      return found;
    }

    const images = [];

    // Strategy 1: worksheet rels → drawing file
    const wsRelsPaths = allPaths.filter(p => /xl\/worksheets\/_rels\/.*\.rels$/.test(p));
    logger.info(`[image-extract-zip] Worksheet rels: [${wsRelsPaths.join(', ')}]`);

    for (const relsPath of wsRelsPaths) {
      const relsXml = await zip.files[relsPath].async('text');
      const wsRels = parseRels(relsXml);

      for (const [, rel] of Object.entries(wsRels)) {
        if (!rel.type.toLowerCase().includes('drawing')) continue;

        let drawingPath = rel.target;
        if (drawingPath.startsWith('../')) drawingPath = 'xl/' + drawingPath.slice(3);
        else if (!drawingPath.startsWith('xl/')) drawingPath = 'xl/drawings/' + drawingPath.split('/').pop();

        const drawingNum = (drawingPath.match(/drawing(\d+)/) || [])[1];
        if (!drawingNum) continue;

        const drawingRelsFile = zip.file(`xl/drawings/_rels/drawing${drawingNum}.xml.rels`);
        if (!drawingRelsFile) { logger.info(`[image-extract-zip] Missing drawing rels for drawing${drawingNum}`); continue; }

        const drawingRels = parseRels(await drawingRelsFile.async('text'));
        const rIdToMedia = {};
        for (const [dRId, dRel] of Object.entries(drawingRels)) {
          rIdToMedia[dRId] = dRel.target.replace(/^.*[/\\]/, '');
        }

        const drawingFile = zip.file(drawingPath);
        if (!drawingFile) { logger.info(`[image-extract-zip] Drawing file not found: ${drawingPath}`); continue; }

        const drawingXml = await drawingFile.async('text');
        const found = parseDrawingAnchors(drawingXml, rIdToMedia, `drawing${drawingNum}`);
        images.push(...found);
      }
    }

    // Strategy 2: scan all drawing files directly (if strategy 1 found nothing)
    if (images.length === 0) {
      logger.info('[image-extract-zip] Strategy 1 found 0 images, scanning all drawing files directly...');
      const drawingPaths = allPaths.filter(p => /xl\/drawings\/drawing\d+\.xml$/.test(p));
      logger.info(`[image-extract-zip] Drawing files: [${drawingPaths.join(', ')}]`);

      for (const drawingPath of drawingPaths) {
        const drawingNum = (drawingPath.match(/drawing(\d+)/) || [])[1];
        const drawingRelsFile = zip.file(`xl/drawings/_rels/drawing${drawingNum}.xml.rels`);
        if (!drawingRelsFile) continue;

        const drawingRels = parseRels(await drawingRelsFile.async('text'));
        const rIdToMedia = {};
        for (const [dRId, dRel] of Object.entries(drawingRels)) {
          rIdToMedia[dRId] = dRel.target.replace(/^.*[/\\]/, '');
        }

        const drawingXml = await zip.files[drawingPath].async('text');
        const found = parseDrawingAnchors(drawingXml, rIdToMedia, `drawing${drawingNum}(direct)`);
        images.push(...found);
      }
    }

    // Strategy 3: index-based fallback — map sorted media files to data rows sequentially
    // Used when drawing XML positioning completely fails (e.g., unusual anchor format)
    if (images.length === 0 && mediaOrder.length > 0) {
      logger.info(`[image-extract-zip] Anchor parsing found 0 images. Falling back to sequential media→row mapping.`);
      // mediaOrder[0] → dataStartRow (row index 1 in 0-based), etc.
      // We don't know dataStartRow here, so return with row=-1 and let the caller assign rows
      for (let i = 0; i < mediaOrder.length; i++) {
        const fname = mediaOrder[i];
        const { buffer, extension } = mediaMap[fname];
        images.push({ row: -1, col: 1, mediaIndex: i, base64: buffer.toString('base64'), extension, size: buffer.length });
      }
      logger.info(`[image-extract-zip] Fallback: returning ${images.length} images with row=-1 (index-based)`);
    }

    logger.info(`[image-extract-zip] Extracted ${images.length} positioned images`);
    return images;
  }

  /**
   * Extract embedded images from an Excel buffer.
   * Returns array of { row, base64, extension }
   */
  async extractImagesFromExcel(fileBuffer) {
    // First pass: find the header row and image column using XLSX for text parsing
    const XLSX = require('xlsx');
    const wb = XLSX.read(fileBuffer, { type: 'buffer' });
    let headerRow = -1;
    let imageCol = -1;
    let dataStartRow = -1;
    let dataEndRow = -1;

    for (const sheetName of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
      for (let i = 0; i < Math.min(25, rows.length); i++) {
        const row = rows[i];
        if (!row) continue;
        const cells = row.map(c => String(c || '').toLowerCase().trim());
        // Look for header row with known columns
        const hasHeader = cells.includes('s no') || cells.includes('sr.no') || cells.includes('sl.no')
          || cells.includes('nos') || cells.includes('description') || cells.includes('item description')
          || cells.includes('item') || cells.includes('qty');
        const imageAliases = ['image', 'images', 'photo', 'picture', 'pic', 'img', 'ref image', 'deck image', 'proposed image'];
        const hasImageCol = cells.some(c => imageAliases.some(a => c.includes(a)));
        if (hasHeader && hasImageCol) {
          headerRow = i;
          // Find the FIRST image column
          for (let c = 0; c < cells.length; c++) {
            if (imageAliases.includes(cells[c])) {
              imageCol = c;
              break;
            }
          }
          dataStartRow = i + 1;
          logger.info(`[image-extract] Header at row ${i}, image column at col ${imageCol}`);
          break;
        }
        // Also detect header rows without an explicit "Image" column (Format C)
        if (hasHeader && !hasImageCol && headerRow < 0) {
          headerRow = i;
          dataStartRow = i + 1;
          logger.info(`[image-extract] Header at row ${i}, NO image column header (will auto-detect)`);
          break;
        }
      }
      if (headerRow >= 0) {
        // Find where data ends (totals row)
        for (let i = dataStartRow; i < rows.length; i++) {
          const cells = (rows[i] || []).map(c => String(c || '').toLowerCase().trim());
          const joined = cells.join(' ');
          // Only stop on a standalone totals label — not on "Total no's" inside a description
          const hasTotalsCell = cells.some(c =>
            c === 'total' || c === 'grand total' || c === 'sub-total' || c === 'subtotal' ||
            /^total (amount|value|cost|price|sum)/.test(c)
          );
          if (hasTotalsCell || joined.includes('gst') || joined.includes('thank you') || joined.includes('terms')) {
            dataEndRow = i;
            break;
          }
        }
        if (dataEndRow < 0) dataEndRow = rows.length;
        logger.info(`[image-extract] Data rows: ${dataStartRow} to ${dataEndRow - 1}`);
        break;
      }
    }

    // Second pass: extract images via direct ZIP parsing (handles Excel Online/OneDrive files)
    const allZipImages = await this._extractImagesViaZip(fileBuffer);
    const rawImages = [];

    // Check if we got index-based fallback results (row === -1)
    const isFallback = allZipImages.length > 0 && allZipImages.every(img => img.row === -1);
    if (isFallback) {
      // dataStartRow is 0-indexed (XLSX); +1 converts to ExcelJS 1-indexed so img.row-1 == _dataRow
      const start = dataStartRow >= 0 ? dataStartRow + 1 : 2;
      for (let i = 0; i < allZipImages.length; i++) {
        rawImages.push({ ...allZipImages[i], row: start + i, col: imageCol >= 0 ? imageCol : 1 });
      }
      logger.info(`[image-extract] Fallback: assigned ${rawImages.length} images to rows ${start}-${start + rawImages.length - 1}`);
    } else {
      for (const img of allZipImages) {
        const { row, col } = img;

        // Skip images outside the data range (logos, signatures, stamps)
        if (headerRow >= 0 && (row < dataStartRow || row > dataEndRow + 2)) {
          logger.info(`[image-extract] Skipping non-data image at row ${row} col ${col} (outside rows ${dataStartRow}-${dataEndRow - 1})`);
          continue;
        }

        // Only take images from the exact image column (if header detected one)
        if (imageCol >= 0 && col !== null && col !== imageCol) {
          logger.info(`[image-extract] Skipping image at row ${row} col ${col} (not in image col ${imageCol})`);
          continue;
        }

        rawImages.push(img);
      }
    }

    logger.info(`[image-extract] Found ${rawImages.length} raw images after filtering`);

    // When no explicit "Image" header was found (imageCol === -1),
    // auto-detect the primary image column by finding which column has the most images.
    // This prevents grabbing images from other columns (e.g., recommended product column)
    // which could show a completely different product (chair vs table).
    if (imageCol < 0 && rawImages.length > 0) {
      const colCounts = {};
      for (const img of rawImages) {
        const c = img.col ?? -1;
        colCounts[c] = (colCounts[c] || 0) + 1;
      }
      // Find the column with the most images
      let bestCol = -1;
      let bestCount = 0;
      for (const [col, count] of Object.entries(colCounts)) {
        if (count > bestCount) {
          bestCount = count;
          bestCol = parseInt(col);
        }
      }
      if (bestCol >= 0 && Object.keys(colCounts).length > 1) {
        logger.info(`[image-extract] No "Image" header found. Auto-detected image column: col ${bestCol} (${bestCount} images). Other columns: ${JSON.stringify(colCounts)}`);
        // Filter to only the primary image column
        const before = rawImages.length;
        const filtered = rawImages.filter(img => (img.col ?? -1) === bestCol);
        rawImages.length = 0;
        rawImages.push(...filtered);
        logger.info(`[image-extract] Filtered ${before} → ${rawImages.length} images (col ${bestCol} only)`);
      } else {
        logger.info(`[image-extract] All ${rawImages.length} images in single column ${bestCol}, no filtering needed`);
      }
    }

    // Deduplicate: keep only the largest image per row
    const byRow = {};
    for (const img of rawImages) {
      if (!byRow[img.row] || img.size > byRow[img.row].size) {
        byRow[img.row] = img;
      }
    }

    const images = Object.values(byRow)
      .map(({ row, base64, extension }) => ({ row, base64, extension }))
      .sort((a, b) => a.row - b.row);

    logger.info(`[image-extract] Final: ${images.length} product images (from ${rawImages.length} candidates)`);
    return images;
  }

  /**
   * Send a single image to GPT-4o and get a text description for furniture product matching.
   */
  async describeImage(base64, extension = 'png') {
    const mimeType = extension === 'jpg' ? 'jpeg' : extension;
    const prompt = 'You are identifying a furniture product from an RFP document image for database matching. Be extremely precise about the product type. CRITICAL distinctions:\n- Side table vs coffee table vs dining table (check height and size)\n- Chair vs stool vs armchair vs lounge chair (check arms, height, cushioning)\n- Sofa vs settee vs bench (check arms, back, seat count)\n\nDescribe: 1) EXACT product type (side table, coffee table, dining table, desk, armchair, dining chair, bar stool, lounge chair, sofa, 2-seater sofa, 3-seater sofa, pendant lamp, floor lamp, pouf, shelf, bench, etc.), 2) distinctive shape/silhouette (round top, mushroom shape, tapered legs, cantilever, organic form, angular, etc.), 3) base/leg type (pedestal base, tube base, sled base, wood legs, metal legs, etc.), 4) materials and colors visible, 5) any brand name or product name text visible in the image. Be very specific about shape and form in 2-3 sentences.';

    const dataUri = `data:image/${mimeType};base64,${base64}`;
    const response = await openaiConfig.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUri, detail: 'high' } }
        ]
      }],
      max_tokens: 300
    });

    return response.choices[0].message.content;
  }

  /**
   * Process all images from an Excel file:
   * extract images, describe each via Vision API, return descriptions keyed by row.
   */
  async processExcelImages(fileBuffer) {
    const images = await this.extractImagesFromExcel(fileBuffer);

    if (images.length === 0) {
      logger.warn('No images found in Excel file');
      return [];
    }

    const results = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      logger.info(`Describing image ${i + 1}/${images.length} (row ${img.row})...`);

      try {
        const description = await this.describeImage(img.base64, img.extension);
        logger.info(`Row ${img.row}: "${description.substring(0, 80)}..."`);
        results.push({
          row: img.row,
          description,
          base64: img.base64,
          extension: img.extension
        });
      } catch (err) {
        logger.error(`Vision API failed for row ${img.row}: ${err.message}`);
        results.push({
          row: img.row,
          description: null,
          base64: img.base64,
          extension: img.extension
        });
      }
    }

    return results;
  }

  /**
   * Describe a product image from a URL (for generating image embeddings).
   * Downloads the image, converts to base64, and runs vision analysis.
   */
  async describeImageFromUrl(imageUrl) {
    if (!imageUrl) return null;

    const fetch = (await import('node-fetch')).default;
    const response = await fetch(imageUrl, { timeout: 60000 });
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || '';
    let extension = 'png';
    if (contentType.includes('jpeg') || contentType.includes('jpg')) extension = 'jpg';
    else if (contentType.includes('webp')) extension = 'webp';

    const base64 = buffer.toString('base64');
    return this.describeImage(base64, extension);
  }
}

module.exports = new VisionService();
