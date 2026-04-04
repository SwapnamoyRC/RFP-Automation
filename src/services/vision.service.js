const ExcelJS = require('exceljs');
const openaiConfig = require('../config/openai');
const logger = require('../config/logger');

logger.info('[vision] Using GPT-4o for image description');

class VisionService {
  /**
   * Extract embedded images from an Excel buffer.
   * Returns array of { row, base64, extension }
   */
  async extractImagesFromExcel(fileBuffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);

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
          const joined = (rows[i] || []).map(c => String(c || '').toLowerCase()).join(' ');
          if (joined.includes('total') || joined.includes('gst') || joined.includes('thank you') || joined.includes('terms')) {
            dataEndRow = i;
            break;
          }
        }
        if (dataEndRow < 0) dataEndRow = rows.length;
        logger.info(`[image-extract] Data rows: ${dataStartRow} to ${dataEndRow - 1}`);
        break;
      }
    }

    // Second pass: extract images from exceljs, filtering by location
    const rawImages = [];

    for (const worksheet of workbook.worksheets) {
      const wsImages = worksheet.getImages();
      logger.info(`[image-extract] Found ${wsImages.length} raw images in sheet "${worksheet.name}"`);

      for (const img of wsImages) {
        const media = workbook.model.media.find(m => m.index === img.imageId);
        if (!media || !media.buffer) continue;

        const row = img.range?.tl?.nativeRow ?? img.range?.tl?.row ?? null;
        const col = img.range?.tl?.nativeCol ?? img.range?.tl?.col ?? null;
        if (row === null) continue;

        const bufferSize = media.buffer.length;

        // Skip tiny images (icons, decorations) — less than 2KB
        if (bufferSize < 2000) {
          logger.info(`[image-extract] Skipping tiny image at row ${row} col ${col} (${bufferSize} bytes)`);
          continue;
        }

        // Skip images outside the data range (logos, signatures, stamps)
        // Allow a small buffer past dataEndRow for images anchored on/near the totals row
        if (headerRow >= 0 && (row < dataStartRow || row > dataEndRow + 2)) {
          logger.info(`[image-extract] Skipping non-data image at row ${row} col ${col} (outside rows ${dataStartRow}-${dataEndRow - 1})`);
          continue;
        }

        // Only take images from the exact image column
        if (imageCol >= 0 && col !== null && col !== imageCol) {
          logger.info(`[image-extract] Skipping image at row ${row} col ${col} (not in image col ${imageCol})`);
          continue;
        }

        const ext = media.extension || media.type || 'png';
        const base64 = Buffer.from(media.buffer).toString('base64');

        rawImages.push({ row, col, base64, extension: ext, size: bufferSize });
      }
    }

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
