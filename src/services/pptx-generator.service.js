const PptxGenJS = require('pptxgenjs');
const https = require('https');
const http = require('http');
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
 * Generate a simplified PowerPoint presentation from matched RFP results.
 * Slide layout: key requirements + dimensions + short spec summary + images.
 * No AI recommendation paragraph.
 *
 * @param {Object} options
 * @param {string} options.clientName
 * @param {Array}  options.slides - slide data objects
 * @returns {Buffer}
 */
async function generatePptx({ clientName, slides }) {
  const pptx = new PptxGenJS();

  pptx.author = 'RFP Automation';
  pptx.subject = `RFP Response for ${clientName}`;
  pptx.title = `RFP Response — ${clientName}`;

  // Pre-download all images in parallel
  const dbImageCount = slides.filter(s => s.image_url).length;
  const rfpImageCount = slides.filter(s => s.rfp_image_url).length;
  logger.info(`Downloading images: ${dbImageCount} product + ${rfpImageCount} RFP reference...`);
  const imageResults = await Promise.all(slides.map(item => downloadImage(item.image_url)));
  const rfpImageResults = await Promise.all(slides.map(item => downloadImage(item.rfp_image_url)));

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
  titleSlide.addText(`${slides.length} Product${slides.length !== 1 ? 's' : ''} Recommended`, {
    x: 0.5, y: 3.55, w: 9, h: 0.4, fontSize: 13, color: '9999AA', fontFace: 'Calibri',
  });

  // ── Product Slides ───────────────────────────────────────────────────────────
  for (let i = 0; i < slides.length; i++) {
    const item = slides[i];
    const dbImage = imageResults[i];
    const rfpImage = rfpImageResults[i];
    const hasBothImages = !!dbImage && !!rfpImage;
    const hasAnyImage = !!dbImage || !!rfpImage;

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

    // Layout: text on left (5.2"), images on right (3.8")
    const textW = hasAnyImage ? 5.2 : 9;
    const textX = 0.4;

    // ── Product Name (title) ────────────────────────────────────────
    const productTitle = item.product_name || item.slide_title || 'Recommended Product';
    slide.addText(productTitle, {
      x: textX, y: 0.55, w: textW, h: 0.65,
      fontSize: 20, bold: true, color: '1a1a2e', fontFace: 'Calibri',
    });

    // Brand + confidence chip + override indicator
    const confidencePct = item.confidence ? `${(item.confidence * 100).toFixed(0)}% match` : '';
    const overrideIndicator = item.is_overridden ? '⚑ Override' : '';
    const brandLine = [item.brand, confidencePct, overrideIndicator].filter(Boolean).join('   ·   ');
    if (brandLine) {
      slide.addText(brandLine, {
        x: textX, y: 1.22, w: textW, h: 0.3,
        fontSize: 10, color: item.is_overridden ? 'BB6600' : '555577', fontFace: 'Calibri',
        bold: false, italic: false,
      });
    }

    // Thin divider
    slide.addShape(pptx.ShapeType.line, {
      x: textX, y: 1.58, w: textW - 0.2, h: 0,
      line: { color: 'DDDDDD', width: 0.5 },
    });

    // ── RFP Requirement block ───────────────────────────────────────
    slide.addText('RFP Requirement', {
      x: textX, y: 1.68, w: textW, h: 0.28,
      fontSize: 9, bold: true, color: '888888', fontFace: 'Calibri',
    });

    const rfpLines = [];
    if (item.rfp_description || item.query) {
      rfpLines.push({ text: item.rfp_description || item.query, options: { fontSize: 11, color: '222222' } });
    }
    if (item.quantity) {
      rfpLines.push({ text: `Quantity: ${item.quantity}`, options: { fontSize: 10, color: '555555' } });
    }
    if (item.location) {
      rfpLines.push({ text: `Location: ${item.location}`, options: { fontSize: 10, color: '555555' } });
    }

    if (rfpLines.length > 0) {
      slide.addText(rfpLines, {
        x: textX, y: 1.98, w: textW, h: 0.9,
        fontFace: 'Calibri', valign: 'top', wrap: true,
      });
    }

    // ── Key Specifications ──────────────────────────────────────────
    const specs = item.specs || [];
    const specsToShow = specs.slice(0, 6);

    if (specsToShow.length > 0) {
      slide.addText('Key Specifications', {
        x: textX, y: 2.95, w: textW, h: 0.28,
        fontSize: 9, bold: true, color: '888888', fontFace: 'Calibri',
      });

      const specRows = specsToShow.map(spec => ({
        text: spec,
        options: {
          fontSize: 10, color: '333333',
          bullet: { code: '25A0', color: '4444AA' }, // filled square bullet
        },
      }));

      slide.addText(specRows, {
        x: textX + 0.15, y: 3.25, w: textW - 0.2, h: 1.55,
        fontFace: 'Calibri', valign: 'top', wrap: true,
      });
    }

    // ── Images (right column) ────────────────────────────────────────
    if (hasBothImages) {
      const imgX = 5.6;
      const imgW = 4.1;
      const imgH = 1.7;

      slide.addText('RFP Reference', {
        x: imgX, y: 0.48, w: imgW, h: 0.22,
        fontSize: 7.5, bold: true, color: 'AAAAAA', fontFace: 'Calibri', align: 'center',
      });
      slide.addImage({
        data: `image/${rfpImage.ext};base64,${rfpImage.base64}`,
        x: imgX, y: 0.72, w: imgW, h: imgH,
        sizing: { type: 'contain', w: imgW, h: imgH },
      });

      slide.addText('Recommended', {
        x: imgX, y: 2.52, w: imgW, h: 0.22,
        fontSize: 7.5, bold: true, color: 'AAAAAA', fontFace: 'Calibri', align: 'center',
      });
      slide.addImage({
        data: `image/${dbImage.ext};base64,${dbImage.base64}`,
        x: imgX, y: 2.76, w: imgW, h: imgH,
        sizing: { type: 'contain', w: imgW, h: imgH },
      });
    } else if (rfpImage) {
      slide.addText('RFP Reference', {
        x: 6.0, y: 0.48, w: 3.7, h: 0.22,
        fontSize: 7.5, bold: true, color: 'AAAAAA', fontFace: 'Calibri', align: 'center',
      });
      slide.addImage({
        data: `image/${rfpImage.ext};base64,${rfpImage.base64}`,
        x: 6.0, y: 0.72, w: 3.7, h: 4.25,
        sizing: { type: 'contain', w: 3.7, h: 4.25 },
      });
    } else if (dbImage) {
      slide.addText('Recommended', {
        x: 6.0, y: 0.48, w: 3.7, h: 0.22,
        fontSize: 7.5, bold: true, color: 'AAAAAA', fontFace: 'Calibri', align: 'center',
      });
      slide.addImage({
        data: `image/${dbImage.ext};base64,${dbImage.base64}`,
        x: 6.0, y: 0.72, w: 3.7, h: 4.25,
        sizing: { type: 'contain', w: 3.7, h: 4.25 },
      });
    }

  }

  // ── Summary Slide ────────────────────────────────────────────────────────────
  const summarySlide = pptx.addSlide();
  summarySlide.background = { color: '1a1a2e' };
  summarySlide.addText('Product Summary', {
    x: 0.5, y: 0.5, w: 9, h: 0.75,
    fontSize: 26, bold: true, color: 'FFFFFF', fontFace: 'Calibri',
  });
  summarySlide.addText(`${slides.length} item${slides.length !== 1 ? 's' : ''} recommended for ${clientName}`, {
    x: 0.5, y: 1.35, w: 9, h: 0.4,
    fontSize: 13, color: '9999BB', fontFace: 'Calibri',
  });

  const summaryRows = slides.map((s, i) => ({
    text: `${i + 1}.  ${s.product_name || s.slide_title || 'Unknown'}${s.brand ? `  —  ${s.brand}` : ''}${s.quantity ? `  ·  Qty: ${s.quantity}` : ''}`,
    options: { fontSize: 11, color: 'CCCCCC', paraSpaceBefore: 7 },
  }));
  summarySlide.addText(summaryRows, {
    x: 0.5, y: 1.85, w: 9, h: 3.5,
    fontFace: 'Calibri', valign: 'top', wrap: true,
  });

  const imgCount = imageResults.filter(Boolean).length;
  const rfpImgCount = rfpImageResults.filter(Boolean).length;
  const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' });
  logger.info(`Generated PPTX: ${slides.length} slides, ${imgCount} DB imgs + ${rfpImgCount} RFP imgs, for "${clientName}" (${pptxBuffer.length} bytes)`);

  return pptxBuffer;
}

module.exports = { generatePptx };
