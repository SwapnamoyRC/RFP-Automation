const PptxGenJS = require('pptxgenjs');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const logger = require('../config/logger');

/**
 * Download an image from URL and return as base64 data string.
 * Returns null if download fails.
 */
function downloadImage(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!url || typeof url !== 'string') return resolve(null);

    // Handle base64 data URIs directly (from RFP image extraction)
    if (url.startsWith('data:image/')) {
      const match = url.match(/^data:image\/(\w+);base64,(.+)$/);
      if (match) {
        const ext = match[1] === 'jpeg' || match[1] === 'jpg' ? 'jpeg' : 'png';
        return resolve({ base64: match[2], ext });
      }
      return resolve(null);
    }

    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      // Follow redirects (up to 3)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadImage(res.headers.location, timeoutMs).then(resolve);
      }
      if (res.statusCode !== 200) return resolve(null);

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (buffer.length < 500) return resolve(null); // too small, likely error page
        const contentType = res.headers['content-type'] || 'image/png';
        const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpeg' : 'png';
        resolve({ base64: buffer.toString('base64'), ext });
      });
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * Generate a PowerPoint presentation from matched RFP results.
 * Each slide shows one RFP item with multiple approved product options in a grid.
 *
 * @param {Object} options
 * @param {string} options.clientName
 * @param {Array}  options.slides - slide data objects with products array
 * @returns {Buffer}
 */
async function generatePptx({ clientName, slides }) {
  const pptx = new PptxGenJS();

  pptx.author = 'RFP Automation';
  pptx.subject = `RFP Response for ${clientName}`;
  pptx.title = `RFP Response — ${clientName}`;

  // Count total products for title slide
  let totalProducts = 0;
  for (const slide of slides) {
    totalProducts += (slide.products || []).length;
  }

  // Pre-download all product images in parallel
  const allProductImages = [];
  for (const slide of slides) {
    const slideImages = await Promise.all(
      (slide.products || []).map(p => downloadImage(p.image_url))
    );
    allProductImages.push(slideImages);
  }

  // Pre-download all RFP reference images
  const rfpImageResults = await Promise.all(slides.map(item => downloadImage(item.rfp_image_url)));
  logger.info(`Downloading images: ${totalProducts} product options + ${slides.length} RFP reference...`);

  // ── Title Slide ──────────────────────────────────────────────────────────────
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: '1a1a2e' };
  titleSlide.addText('RFP Response', {
    x: 0.5, y: 0.9, w: 9, h: 1.1,
    fontSize: 36, bold: true, color: 'FFFFFF', fontFace: 'Calibri',
  });
  titleSlide.addText(clientName, {
    x: 0.5, y: 2.1, w: 9, h: 0.75,
    fontSize: 22, color: '16213e', fontFace: 'Calibri',
    fill: { color: 'e8e8e8' }, rectRadius: 0.08,
  });
  titleSlide.addText(
    new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }),
    { x: 0.5, y: 3.1, w: 9, h: 0.4, fontSize: 13, color: '9999AA', fontFace: 'Calibri' }
  );
  titleSlide.addText(`${slides.length} Item${slides.length !== 1 ? 's' : ''} with ${totalProducts} Product${totalProducts !== 1 ? 's' : ''} Recommended`, {
    x: 0.5, y: 3.55, w: 9, h: 0.4, fontSize: 13, color: '9999AA', fontFace: 'Calibri',
  });

  // ── Product Slides ───────────────────────────────────────────────────────────
  for (let i = 0; i < slides.length; i++) {
    const item = slides[i];
    const products = item.products || [];
    const rfpImage = rfpImageResults[i];
    const productImages = allProductImages[i] || [];

    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };

    // Dark header bar
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.42, fill: { color: '1a1a2e' },
    });

    // Item number label (top-left in header)
    slide.addText(`${i + 1} / ${slides.length}`, {
      x: 0.2, y: 0.06, w: 1, h: 0.3,
      fontSize: 8, color: '8888AA', fontFace: 'Calibri',
    });

    const textX = 0.4;
    const textW = 4.8;

    // ── RFP Item Title ──────────────────────────────────────────────────
    const itemTitle = item.slide_title || item.query || 'Item';
    slide.addText(itemTitle, {
      x: textX, y: 0.40, w: textW, h: 0.55,
      fontSize: 18, bold: true, color: '1a1a2e', fontFace: 'Calibri',
    });

    // ── RFP Requirement block ───────────────────────────────────────
    slide.addText('RFP Requirement', {
      x: textX, y: 0.98, w: textW, h: 0.22,
      fontSize: 8, bold: true, color: '888888', fontFace: 'Calibri',
    });

    const rfpLines = [];
    if (item.rfp_description || item.query) {
      rfpLines.push({ text: item.rfp_description || item.query, options: { fontSize: 8.5, color: '222222' } });
    }
    if (item.quantity) {
      rfpLines.push({ text: `Quantity: ${item.quantity}`, options: { fontSize: 8, color: '555555' } });
    }
    if (item.location) {
      rfpLines.push({ text: `Location: ${item.location}`, options: { fontSize: 8, color: '555555' } });
    }

    if (rfpLines.length > 0) {
      slide.addText(rfpLines, {
        x: textX, y: 1.22, w: textW, h: 0.65,
        fontFace: 'Calibri', valign: 'top', wrap: true,
      });
    }

    // ── RFP Reference Image (left column, compact) ─────────────────
    if (rfpImage) {
      const rfpImgW = 2.2;
      const rfpImgH = 1.2; // image: y 2.14 + h 1.2 = 3.34, clears specsY (3.45)
      slide.addText('RFP Reference', {
        x: textX, y: 1.94, w: rfpImgW, h: 0.18,
        fontSize: 7, bold: true, color: 'AAAAAA', fontFace: 'Calibri', align: 'center',
      });
      slide.addImage({
        data: `image/${rfpImage.ext};base64,${rfpImage.base64}`,
        x: textX, y: 2.14, w: rfpImgW, h: rfpImgH,
        sizing: { type: 'contain', w: rfpImgW, h: rfpImgH },
      });
    }

    // ── Approved Options Grid (right column, image + name + brand only) ──
    const gridX = 5.3;
    const gridW = 4.5;
    const numProducts = products.length;
    const colCount = numProducts >= 3 ? 3 : numProducts >= 2 ? 2 : 1;
    const colWidth = (gridW - 0.2) / colCount;
    const rowHeight = numProducts >= 3 ? 1.75 : 2.0;

    slide.addText('Recommended', {
      x: gridX, y: 0.40, w: gridW, h: 0.20,
      fontSize: 8, bold: true, color: 'AAAAAA', fontFace: 'Calibri', align: 'center',
    });

    for (let prodIdx = 0; prodIdx < numProducts; prodIdx++) {
      const product = products[prodIdx];
      const prodImage = productImages[prodIdx];
      const colIdx = prodIdx % colCount;
      const rowIdx = Math.floor(prodIdx / colCount);
      const cellX = gridX + (colIdx * colWidth) + 0.05;
      const cellY = 0.63 + (rowIdx * rowHeight);
      const cardW = colWidth - 0.1;

      slide.addShape(pptx.ShapeType.rect, {
        x: cellX, y: cellY, w: cardW, h: rowHeight,
        fill: { color: 'F5F5F5' }, line: { color: 'DDDDDD', width: 1 },
      });

      if (prodImage) {
        const imgW = cardW - 0.1;
        const imgH = numProducts >= 3 ? 0.95 : 1.1;
        slide.addImage({
          data: `image/${prodImage.ext};base64,${prodImage.base64}`,
          x: cellX + 0.05, y: cellY + 0.05, w: imgW, h: imgH,
          sizing: { type: 'contain', w: imgW, h: imgH },
        });
      }

      slide.addText(product.product_name || 'Product', {
        x: cellX + 0.05, y: cellY + (numProducts >= 3 ? 1.03 : 1.2), w: cardW - 0.1, h: 0.25,
        fontSize: numProducts >= 3 ? 7 : 8, bold: true, color: '222222', fontFace: 'Calibri',
        align: 'center', valign: 'top', wrap: true,
      });

      if (product.brand) {
        slide.addText(product.brand, {
          x: cellX + 0.05, y: cellY + (numProducts >= 3 ? 1.30 : 1.5), w: cardW - 0.1, h: 0.14,
          fontSize: 7, color: '666666', fontFace: 'Calibri', align: 'center',
        });
      }

      if (product.source_url) {
        // Extract domain from URL for cleaner display
        try {
          const urlObj = new URL(product.source_url);
          const domain = urlObj.hostname.replace('www.', '');

          slide.addText(domain, {
            x: cellX + 0.05, y: cellY + (numProducts >= 3 ? 1.46 : 1.66), w: cardW - 0.1, h: 0.20,
            fontSize: numProducts >= 3 ? 6.5 : 7, color: '0066CC', fontFace: 'Calibri', align: 'center',
            wrap: true, valign: 'top', underline: true,
            hyperlink: { url: product.source_url, tooltip: 'Visit product page' },
          });
        } catch (e) {
          // Fallback if URL parsing fails
          logger.warn(`Failed to parse URL: ${product.source_url}`, e.message);
        }
      }
    }

    // ── Key Specifications — all products side by side at the bottom ──
    // specsY must be below the RFP reference image (y:2.22 + h:1.1 = 3.32)
    const specsY = 3.45;
    // Cap height to fit 4 spec bullets — do not fill to slide bottom
    const specsH = 1.8;
    const totalSpecW = 9.4;
    const prodColW = totalSpecW / numProducts;
    const maxSpecChars = 90; // truncate long spec lines

    // Horizontal divider
    slide.addShape(pptx.ShapeType.line, {
      x: 0.3, y: specsY - 0.12, w: 9.4, h: 0,
      line: { color: 'DDDDDD', width: 0.75 },
    });

    // Section header
    slide.addText('Key Specifications', {
      x: 0.3, y: specsY, w: 9.4, h: 0.25,
      fontSize: 9, bold: true, color: '888888', fontFace: 'Calibri',
    });

    for (let i = 0; i < numProducts; i++) {
      const product = products[i];
      const colX = 0.3 + (i * prodColW);

      // Product name as column header
      slide.addText(product.product_name || '', {
        x: colX, y: specsY + 0.28, w: prodColW - 0.1, h: 0.24,
        fontSize: 9, bold: true, color: '1a1a2e', fontFace: 'Calibri',
      });

      // Spec bullets — limit to 4 items, truncate long lines
      const colSpecs = (product.specs || []).slice(0, 4).map(spec => {
        const text = String(spec).trim();
        return text.length > maxSpecChars ? text.slice(0, maxSpecChars) + '…' : text;
      });

      if (colSpecs.length > 0) {
        const specRows = colSpecs.map(spec => ({
          text: spec,
          options: { fontSize: 8, color: '333333', bullet: { code: '25A0', color: '4444AA' } },
        }));
        slide.addText(specRows, {
          x: colX + 0.1, y: specsY + 0.55, w: prodColW - 0.2, h: specsH - 0.65,
          fontFace: 'Calibri', valign: 'top', wrap: true,
        });
      } else {
        slide.addText('—', {
          x: colX + 0.1, y: specsY + 0.55, w: prodColW - 0.2, h: 0.3,
          fontSize: 8, color: '999999', fontFace: 'Calibri', italic: true,
        });
      }

      // Vertical divider between columns (except last)
      if (i < numProducts - 1) {
        slide.addShape(pptx.ShapeType.line, {
          x: colX + prodColW - 0.05, y: specsY, w: 0, h: specsH,
          line: { color: 'EEEEEE', width: 0.5 },
        });
      }
    }

    // ── Slide Notes — full product details from DB ──────────────────────────
    const notesLines = products.map((product, idx) => {
      const lines = [`${idx + 1}. ${product.product_name} (${product.brand || ''})`];
      if (product.source_url) lines.push(`   URL: ${product.source_url}`);
      const db = product.dbDetails || {};
      if (db.category)    lines.push(`   Category: ${db.category}`);
      if (db.designer)    lines.push(`   Designer: ${db.designer}`);
      if (db.materials)   lines.push(`   Materials: ${db.materials}`);
      if (db.dimensions)  lines.push(`   Dimensions: ${db.dimensions}`);
      if (db.description) lines.push(`   Description: ${db.description}`);
      if (lines.length === 1 + (product.source_url ? 1 : 0)) lines.push('   No details available');
      return lines.join('\n');
    });
    slide.addNotes(`FULL PRODUCT DETAILS\n${'─'.repeat(40)}\n${notesLines.join('\n\n')}`);
  }

  // ── Summary Slide ────────────────────────────────────────────────────────────
  const summarySlide = pptx.addSlide();
  summarySlide.background = { color: '1a1a2e' };
  summarySlide.addText('Item Summary', {
    x: 0.5, y: 0.5, w: 9, h: 0.75,
    fontSize: 26, bold: true, color: 'FFFFFF', fontFace: 'Calibri',
  });
  summarySlide.addText(`${slides.length} item${slides.length !== 1 ? 's' : ''} with ${totalProducts} product option${totalProducts !== 1 ? 's' : ''} for ${clientName}`, {
    x: 0.5, y: 1.35, w: 9, h: 0.4,
    fontSize: 13, color: '9999BB', fontFace: 'Calibri',
  });

  const summaryRows = slides.map((s, i) => {
    const prodCount = (s.products || []).length;
    const prodList = s.products.map(p => p.product_name || 'Unknown').join(', ');
    return {
      text: `${i + 1}.  ${s.slide_title || 'Item'}  (${prodCount} option${prodCount !== 1 ? 's' : ''})  —  ${prodList}${s.quantity ? `  ·  Qty: ${s.quantity}` : ''}`,
      options: { fontSize: 10, color: 'CCCCCC', paraSpaceBefore: 7 },
    };
  });
  summarySlide.addText(summaryRows, {
    x: 0.5, y: 1.85, w: 9, h: 3.5,
    fontFace: 'Calibri', valign: 'top', wrap: true,
  });

  const totalImgCount = allProductImages.flat().filter(Boolean).length;
  const rfpImgCount = rfpImageResults.filter(Boolean).length;
  const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' });
  logger.info(`Generated PPTX: ${slides.length} slides, ${totalImgCount} product imgs + ${rfpImgCount} RFP imgs, ${totalProducts} options total, for "${clientName}" (${pptxBuffer.length} bytes)`);

  return pptxBuffer;
}

module.exports = { generatePptx };
