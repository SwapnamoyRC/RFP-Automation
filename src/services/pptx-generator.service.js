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
 * Generate a PowerPoint presentation from matched RFP results + GPT slide content.
 *
 * @param {Object} options
 * @param {string} options.clientName - Client name for the title slide
 * @param {Array} options.slides - Array of slide objects from GPT:
 *   { slide_title, recommendation, specs[], product_name, brand, image_url, confidence, quantity, location }
 * @returns {Buffer} - The .pptx file as a Buffer
 */
async function generatePptx({ clientName, slides }) {
  const pptx = new PptxGenJS();

  pptx.author = 'RFP Automation';
  pptx.subject = `RFP Response for ${clientName}`;
  pptx.title = `RFP Response — ${clientName}`;

  // Pre-download all images in parallel (both DB product images and RFP reference images)
  const dbImageCount = slides.filter(s => s.image_url).length;
  const rfpImageCount = slides.filter(s => s.rfp_image_url).length;
  logger.info(`Downloading images: ${dbImageCount} product (DB) + ${rfpImageCount} reference (RFP)...`);
  const imageResults = await Promise.all(
    slides.map(item => downloadImage(item.image_url))
  );
  const rfpImageResults = await Promise.all(
    slides.map(item => downloadImage(item.rfp_image_url))
  );

  // --- Title Slide ---
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: '1a1a2e' };
  titleSlide.addText('RFP Response', {
    x: 0.5, y: 1.0, w: 9, h: 1.2,
    fontSize: 36, bold: true, color: 'FFFFFF',
    fontFace: 'Arial'
  });
  titleSlide.addText(clientName, {
    x: 0.5, y: 2.2, w: 9, h: 0.8,
    fontSize: 24, color: '16213e',
    fontFace: 'Arial',
    fill: { color: 'e2e2e2' },
    rectRadius: 0.1
  });
  titleSlide.addText(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), {
    x: 0.5, y: 3.3, w: 9, h: 0.5,
    fontSize: 14, color: 'AAAAAA', fontFace: 'Arial'
  });
  titleSlide.addText(`${slides.length} Product Recommendations`, {
    x: 0.5, y: 3.8, w: 9, h: 0.5,
    fontSize: 14, color: 'AAAAAA', fontFace: 'Arial'
  });

  // --- Product Slides ---
  for (let i = 0; i < slides.length; i++) {
    const item = slides[i];
    const dbImage = imageResults[i];
    const rfpImage = rfpImageResults[i];
    const hasBothImages = !!dbImage && !!rfpImage;
    const hasAnyImage = !!dbImage || !!rfpImage;
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };

    // Top color bar
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.4,
      fill: { color: '1a1a2e' }
    });

    // Layout depends on how many images we have
    const textW = hasAnyImage ? 5.3 : 9;
    const textX = 0.5;

    // Slide title
    slide.addText(item.slide_title || item.product_name || 'Product Recommendation', {
      x: textX, y: 0.6, w: textW, h: 0.6,
      fontSize: 22, bold: true, color: '1a1a2e',
      fontFace: 'Arial'
    });

    // Brand + confidence badge
    const confidencePct = item.confidence ? `${(item.confidence * 100).toFixed(0)}%` : '';
    const badgeText = [item.brand, confidencePct ? `Match: ${confidencePct}` : ''].filter(Boolean).join('  |  ');
    if (badgeText) {
      slide.addText(badgeText, {
        x: textX, y: 1.2, w: textW, h: 0.35,
        fontSize: 11, color: '666666', fontFace: 'Arial'
      });
    }

    // Recommendation paragraph
    if (item.recommendation) {
      slide.addText(item.recommendation, {
        x: textX, y: 1.7, w: textW, h: 1.2,
        fontSize: 13, color: '333333', fontFace: 'Arial',
        valign: 'top', wrap: true
      });
    }

    // Specs as bullet points
    if (item.specs && item.specs.length > 0) {
      slide.addText('Key Specifications:', {
        x: textX, y: 3.0, w: textW, h: 0.35,
        fontSize: 12, bold: true, color: '1a1a2e', fontFace: 'Arial'
      });

      const specRows = item.specs.map(spec => ({
        text: spec,
        options: { fontSize: 11, color: '444444', bullet: { code: '2022' }, paraSpaceBefore: 4 }
      }));

      slide.addText(specRows, {
        x: textX + 0.2, y: 3.35, w: textW - 0.2, h: 1.5,
        fontFace: 'Arial', valign: 'top', wrap: true
      });
    }

    // Images on the right side
    if (hasBothImages) {
      // Both images: RFP reference on top, DB match on bottom
      const imgX = 5.9;
      const imgW = 3.8;
      const imgH = 2.0;

      // RFP Reference Image (top-right)
      slide.addText('RFP Reference', {
        x: imgX, y: 0.5, w: imgW, h: 0.25,
        fontSize: 8, bold: true, color: '999999', fontFace: 'Arial', align: 'center'
      });
      slide.addImage({
        data: `image/${rfpImage.ext};base64,${rfpImage.base64}`,
        x: imgX, y: 0.75, w: imgW, h: imgH,
        sizing: { type: 'contain', w: imgW, h: imgH }
      });

      // Matched Product Image (bottom-right)
      slide.addText('Recommended Product', {
        x: imgX, y: 2.85, w: imgW, h: 0.25,
        fontSize: 8, bold: true, color: '999999', fontFace: 'Arial', align: 'center'
      });
      slide.addImage({
        data: `image/${dbImage.ext};base64,${dbImage.base64}`,
        x: imgX, y: 3.1, w: imgW, h: imgH,
        sizing: { type: 'contain', w: imgW, h: imgH }
      });
    } else if (rfpImage) {
      // Only RFP image
      slide.addText('RFP Reference', {
        x: 6.3, y: 0.5, w: 3.4, h: 0.25,
        fontSize: 8, bold: true, color: '999999', fontFace: 'Arial', align: 'center'
      });
      slide.addImage({
        data: `image/${rfpImage.ext};base64,${rfpImage.base64}`,
        x: 6.3, y: 0.8, w: 3.4, h: 3.2,
        sizing: { type: 'contain', w: 3.4, h: 3.2 }
      });
    } else if (dbImage) {
      // Only DB image
      slide.addText('Recommended Product', {
        x: 6.3, y: 0.5, w: 3.4, h: 0.25,
        fontSize: 8, bold: true, color: '999999', fontFace: 'Arial', align: 'center'
      });
      slide.addImage({
        data: `image/${dbImage.ext};base64,${dbImage.base64}`,
        x: 6.3, y: 0.8, w: 3.4, h: 3.2,
        sizing: { type: 'contain', w: 3.4, h: 3.2 }
      });
    }

    // Quantity + Location footer
    const footerParts = [];
    if (item.quantity) footerParts.push(`Qty: ${item.quantity}`);
    if (item.location) footerParts.push(`Location: ${item.location}`);
    if (footerParts.length > 0) {
      slide.addText(footerParts.join('  |  '), {
        x: 0.5, y: 4.9, w: 9, h: 0.3,
        fontSize: 10, color: '999999', fontFace: 'Arial'
      });
    }
  }

  // --- Summary Slide ---
  const summarySlide = pptx.addSlide();
  summarySlide.background = { color: '1a1a2e' };
  summarySlide.addText('Summary', {
    x: 0.5, y: 0.5, w: 9, h: 0.8,
    fontSize: 28, bold: true, color: 'FFFFFF', fontFace: 'Arial'
  });
  summarySlide.addText(`Total Products Matched: ${slides.length}`, {
    x: 0.5, y: 1.5, w: 9, h: 0.5,
    fontSize: 16, color: 'CCCCCC', fontFace: 'Arial'
  });

  const summaryRows = slides.map((s, i) => ({
    text: `${i + 1}. ${s.product_name || s.slide_title} — ${s.brand || 'N/A'}`,
    options: { fontSize: 12, color: 'AAAAAA', bullet: false, paraSpaceBefore: 6 }
  }));
  summarySlide.addText(summaryRows, {
    x: 0.5, y: 2.2, w: 9, h: 3.0,
    fontFace: 'Arial', valign: 'top', wrap: true
  });

  const imgCount = imageResults.filter(Boolean).length;
  const rfpImgCount = rfpImageResults.filter(Boolean).length;
  // Generate the file
  const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' });
  logger.info(`Generated PPTX: ${slides.length} product slides, ${imgCount} DB images + ${rfpImgCount} RFP images, for "${clientName}" (${pptxBuffer.length} bytes)`);

  return pptxBuffer;
}

module.exports = { generatePptx };
