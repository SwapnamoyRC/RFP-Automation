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

    // ── Layout constants ────────────────────────────────────────────────────────
    const LEFT_X   = 0.30;
    const LEFT_W   = 4.70;
    const RIGHT_X  = 5.20;
    const RIGHT_W  = 4.60;
    const SPECS_Y  = 3.20;   // slightly lower to give RFP description more room

    // Dark header bar
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.38, fill: { color: '1a1a2e' },
    });

    // Item counter in header
    slide.addText(`${i + 1} / ${slides.length}`, {
      x: 0.22, y: 0.06, w: 1.2, h: 0.26,
      fontSize: 8, color: '8888AA', fontFace: 'Calibri',
    });

    // ── Title ──────────────────────────────────────────────────────────────────
    const itemTitle = item.slide_title || item.query || 'Item';
    slide.addText(itemTitle.toUpperCase(), {
      x: LEFT_X, y: 0.40, w: LEFT_W, h: 0.56,
      fontSize: 16, bold: true, color: '1a1a2e', fontFace: 'Calibri',
      valign: 'middle', wrap: true, shrinkText: true,
    });

    // ── RFP Requirement label + description ────────────────────────────────────
    slide.addText('RFP Requirement', {
      x: LEFT_X, y: 1.02, w: LEFT_W, h: 0.20,
      fontSize: 8, bold: true, color: '999999', fontFace: 'Calibri',
    });

    const rfpLines = [];
    if (item.rfp_description || item.query) {
      rfpLines.push({ text: item.rfp_description || item.query, options: { fontSize: 8.5, color: '222222', paraSpaceAfter: 2 } });
    }
    if (item.quantity) rfpLines.push({ text: `Quantity: ${item.quantity}`, options: { fontSize: 8, color: '555555' } });
    if (item.location) rfpLines.push({ text: `Location: ${item.location}`, options: { fontSize: 8, color: '555555' } });

    if (rfpLines.length > 0) {
      slide.addText(rfpLines, {
        x: LEFT_X, y: 1.24, w: LEFT_W, h: 0.72,
        fontFace: 'Calibri', valign: 'top', wrap: true,
      });
    }

    // ── RFP Reference Image ────────────────────────────────────────────────────
    // Label starts 0.14" after description ends (1.24 + 0.72 = 1.96 + 0.14 = 2.10)
    const rfpImgW = 2.30;
    const rfpRefLabelY = 2.10;
    const rfpImgY = rfpRefLabelY + 0.20;   // 2.30
    const rfpImgH = SPECS_Y - rfpImgY - 0.04;  // fills to specs line

    slide.addText('RFP Reference', {
      x: LEFT_X, y: rfpRefLabelY, w: rfpImgW, h: 0.18,
      fontSize: 7, bold: true, color: 'BBBBBB', fontFace: 'Calibri', align: 'center',
    });

    if (rfpImage) {
      slide.addImage({
        data: `image/${rfpImage.ext};base64,${rfpImage.base64}`,
        x: LEFT_X, y: rfpImgY, w: rfpImgW, h: rfpImgH,
        sizing: { type: 'contain', w: rfpImgW, h: rfpImgH },
      });
    } else {
      // Placeholder box when no RFP image
      slide.addShape(pptx.ShapeType.rect, {
        x: LEFT_X, y: rfpImgY, w: rfpImgW, h: rfpImgH,
        fill: { color: 'F0F0F0' }, line: { color: 'DDDDDD', width: 1 },
      });
      slide.addText('No Image', {
        x: LEFT_X, y: rfpImgY + rfpImgH / 2 - 0.13, w: rfpImgW, h: 0.25,
        fontSize: 8, color: 'BBBBBB', fontFace: 'Calibri', align: 'center', italic: true,
      });
    }

    // ── Approved Products Grid (right column) ──────────────────────────────────
    const numProducts = products.length;
    const colCount = Math.min(numProducts, 3);
    const colWidth = (RIGHT_W - (colCount - 1) * 0.08) / colCount;
    const cardStartY = 0.58;
    const rowHeight = SPECS_Y - cardStartY - 0.10;   // compact: ~2.42 inches

    slide.addText('Recommended', {
      x: RIGHT_X, y: 0.40, w: RIGHT_W, h: 0.18,
      fontSize: 8, bold: true, color: 'AAAAAA', fontFace: 'Calibri', align: 'center',
    });

    for (let prodIdx = 0; prodIdx < numProducts; prodIdx++) {
      const product = products[prodIdx];
      const prodImage = productImages[prodIdx];
      const colIdx = prodIdx % colCount;
      const rowIdx = Math.floor(prodIdx / colCount);
      const cellX = RIGHT_X + colIdx * (colWidth + 0.08);
      const cellY = cardStartY + rowIdx * (rowHeight + 0.08);
      const cardW = colWidth;

      // Card background
      slide.addShape(pptx.ShapeType.rect, {
        x: cellX, y: cellY, w: cardW, h: rowHeight,
        fill: { color: 'F7F7F7' }, line: { color: 'E0E0E0', width: 0.75 },
      });

      // Product image — takes up most of the card height
      const imgPad   = 0.08;
      const textZone = 0.76;   // reserved at bottom for name + brand + url
      const imgH     = rowHeight - textZone - imgPad * 2;
      const imgW     = cardW - imgPad * 2;

      if (prodImage) {
        slide.addImage({
          data: `image/${prodImage.ext};base64,${prodImage.base64}`,
          x: cellX + imgPad, y: cellY + imgPad, w: imgW, h: imgH,
          sizing: { type: 'contain', w: imgW, h: imgH },
        });
      }

      // Thin separator between image and text zone
      slide.addShape(pptx.ShapeType.line, {
        x: cellX + 0.05, y: cellY + imgPad * 2 + imgH, w: cardW - 0.1, h: 0,
        line: { color: 'E8E8E8', width: 0.5 },
      });

      const textBaseY = cellY + rowHeight - textZone + 0.05;

      // Product name
      slide.addText(product.product_name || 'Product', {
        x: cellX + 0.06, y: textBaseY, w: cardW - 0.12, h: 0.26,
        fontSize: colCount >= 3 ? 7 : 8, bold: true, color: '1a1a2e',
        fontFace: 'Calibri', align: 'center', valign: 'middle', wrap: true,
      });

      // Brand
      if (product.brand) {
        slide.addText(product.brand, {
          x: cellX + 0.06, y: textBaseY + 0.26, w: cardW - 0.12, h: 0.20,
          fontSize: colCount >= 3 ? 6.5 : 7, color: '777777',
          fontFace: 'Calibri', align: 'center', valign: 'middle',
        });
      }

      // URL link
      if (product.source_url) {
        try {
          const domain = new URL(product.source_url).hostname.replace('www.', '');
          slide.addText(domain, {
            x: cellX + 0.06, y: textBaseY + 0.46, w: cardW - 0.12, h: 0.20,
            fontSize: colCount >= 3 ? 6 : 6.5, color: '0066CC',
            fontFace: 'Calibri', align: 'center', underline: true,
            hyperlink: { url: product.source_url, tooltip: 'Visit product page' },
          });
        } catch (e) {
          logger.warn(`Failed to parse URL: ${product.source_url}`, e.message);
        }
      }
    }

    // ── Key Specifications ─────────────────────────────────────────────────────
    const specsH = 1.85;
    const totalSpecW = 9.40;
    const prodColW = totalSpecW / numProducts;
    const maxSpecChars = 120;

    // Horizontal divider
    slide.addShape(pptx.ShapeType.line, {
      x: LEFT_X, y: SPECS_Y - 0.07, w: totalSpecW, h: 0,
      line: { color: 'D8D8D8', width: 0.75 },
    });

    slide.addText('Key Specifications', {
      x: LEFT_X, y: SPECS_Y, w: totalSpecW, h: 0.22,
      fontSize: 8.5, bold: true, color: '888888', fontFace: 'Calibri',
    });

    for (let j = 0; j < numProducts; j++) {
      const product = products[j];
      const colX = LEFT_X + j * prodColW;

      slide.addText(product.product_name || '', {
        x: colX, y: SPECS_Y + 0.25, w: prodColW - 0.12, h: 0.24,
        fontSize: 8.5, bold: true, color: '1a1a2e', fontFace: 'Calibri', wrap: true,
      });

      const colSpecs = (product.specs || []).slice(0, 4).map(s => {
        const t = String(s).trim();
        return t.length > maxSpecChars ? t.slice(0, maxSpecChars) + '…' : t;
      });

      if (colSpecs.length > 0) {
        slide.addText(
          colSpecs.map(s => ({
            text: s,
            options: { fontSize: 7.5, color: '333333', bullet: { code: '25A0', color: '4444AA' } },
          })),
          { x: colX + 0.08, y: SPECS_Y + 0.52, w: prodColW - 0.18, h: specsH - 0.56, fontFace: 'Calibri', valign: 'top', wrap: true }
        );
      } else {
        slide.addText('—', {
          x: colX + 0.08, y: SPECS_Y + 0.52, w: prodColW - 0.18, h: 0.26,
          fontSize: 8, color: '999999', fontFace: 'Calibri', italic: true,
        });
      }

      if (j < numProducts - 1) {
        slide.addShape(pptx.ShapeType.line, {
          x: colX + prodColW - 0.04, y: SPECS_Y, w: 0, h: specsH,
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
