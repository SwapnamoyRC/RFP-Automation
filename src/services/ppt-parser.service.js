/**
 * PPTX RFP Parser
 *
 * Parses a PowerPoint RFP file (the "DESIGN INTENT & SPECIFICATIONS" format)
 * and extracts product line items in the same shape as rfp-parser.service.js.
 *
 * Expected slide layout:
 *   - Slide title = room/location name ("RECEPTION", "RECEPTION LOUNGE", …)
 *   - Left half  = floor-plan & mood images (skipped)
 *   - Right half = "DESIGN INTENT & SPECIFICATIONS" box
 *       • Item title: bold (+ underlined) text run
 *       • Size: / Finishes: lines follow
 *       • Product reference image sits below each item's text
 */

const logger = require('../config/logger');

// ── XML helpers ───────────────────────────────────────────────────────────────

/** Pull every attribute of the first occurrence of <tagName …> in xml */
function attrOf(xml, tagName) {
  const m = new RegExp(`<${tagName}\\b([^>]*)>`).exec(xml);
  return m ? m[1] : '';
}

/** Pull the text inside every <a:t>…</a:t> run inside xml (preserves order) */
function extractText(xml) {
  const parts = [];
  const re = /<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g;
  let m;
  while ((m = re.exec(xml)) !== null) parts.push(m[1]);
  return parts.join('').trim();
}

/** Return the string value of a named XML attribute, e.g. x="457200" → "457200" */
function attr(attrsStr, name) {
  const m = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(attrsStr || '');
  return m ? m[1] : null;
}

/** Split xml into top-level chunks for <tag> */
function splitTags(xml, tag) {
  const chunks = [];
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'g');
  let m;
  while ((m = re.exec(xml)) !== null) chunks.push(m[0]);
  return chunks;
}

// ── PPTX navigation helpers ───────────────────────────────────────────────────

/** Parse `ppt/slides/_rels/slideN.xml.rels` into { rId: mediaFileName } */
function parseSlideRels(relsXml) {
  const rels = {};
  const re = /<Relationship\b([^>]*?)(?:\/?>|>)/g;
  let m;
  while ((m = re.exec(relsXml)) !== null) {
    const id     = attr(m[1], 'Id');
    const type   = attr(m[1], 'Type') || '';
    const target = attr(m[1], 'Target') || '';
    if (id && type.endsWith('/image')) {
      // Target is usually "../media/imageN.png"
      rels[id] = target.split('/').pop();
    }
  }
  return rels;
}

/** Get ordered slide file names from presentation.xml */
function getSlideOrder(presXml) {
  const order = [];
  const re = /<p:sldId\b[^>]*r:id="(rId\d+)"[^>]*/g;
  let m;
  while ((m = re.exec(presXml)) !== null) order.push(m[1]);
  return order;
}

/** Parse ppt/_rels/presentation.xml.rels → { rId: slideN } */
function getPresRels(relsXml) {
  const rels = {};
  const re = /<Relationship\b([^>]*?)(?:\/?>|>)/g;
  let m;
  while ((m = re.exec(relsXml)) !== null) {
    const id     = attr(m[1], 'Id');
    const target = attr(m[1], 'Target') || '';
    if (id && /slides\/slide\d+\.xml$/i.test(target)) {
      // e.g. "slides/slide3.xml" → extract index
      const nm = target.match(/slide(\d+)\.xml$/i);
      if (nm) rels[id] = parseInt(nm[1]);
    }
  }
  return rels;
}

/** Get slide cx (width in EMUs) from presentation.xml */
function getSlideCX(presXml) {
  const m = /<p:sldSz\b([^>]*)>/.exec(presXml);
  if (!m) return 9144000;
  const cx = attr(m[1], 'cx');
  return cx ? parseInt(cx) : 9144000;
}

// ── Shape extraction ──────────────────────────────────────────────────────────

/**
 * Extract all text shapes from a slide XML.
 * Returns [{ x, y, cx, cy, isTitle, paragraphs: [{ text, bold, underline }] }]
 */
function extractTextShapes(slideXml) {
  const shapes = [];
  const spChunks = splitTags(slideXml, 'p:sp');

  for (const sp of spChunks) {
    // Position
    const xfrmAttrs = attrOf(sp, 'a:off');
    const extAttrs  = attrOf(sp, 'a:ext');
    const x  = parseInt(attr(xfrmAttrs, 'x')  || '0');
    const y  = parseInt(attr(xfrmAttrs, 'y')  || '0');
    const cx = parseInt(attr(extAttrs, 'cx')   || '0');
    const cy = parseInt(attr(extAttrs, 'cy')   || '0');

    // Is this the title placeholder?
    const isTitle = /<p:ph\b[^>]*type="(title|ctrTitle)"/.test(sp);

    // Extract paragraphs
    const txBodyM = /<p:txBody\b[^>]*>([\s\S]*?)<\/p:txBody>/.exec(sp);
    if (!txBodyM) continue;

    const paragraphs = [];
    const paraChunks = splitTags(txBodyM[1], 'a:p');
    for (const ap of paraChunks) {
      const runChunks = splitTags(ap, 'a:r');
      if (runChunks.length === 0) continue;

      let bold = false, underline = false;
      const textParts = [];
      for (const run of runChunks) {
        const rPrM = /<a:rPr\b([^>]*)>/.exec(run);
        const rPrA = rPrM ? rPrM[1] : '';
        if (/\bb="1"/.test(rPrA))                   bold      = true;
        if (/\bu="(sng|dbl|dotted|dash)"/.test(rPrA)) underline = true;

        const tM = /<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/.exec(run);
        if (tM) textParts.push(tM[1]);
      }

      const text = textParts.join('').trim();
      if (text) paragraphs.push({ text, bold, underline });
    }

    if (paragraphs.length > 0) {
      shapes.push({ x, y, cx, cy, isTitle, paragraphs });
    }
  }

  return shapes;
}

/**
 * Extract image references from slide XML.
 * Returns [{ rId, x, y, cx, cy }]
 */
function extractImageRefs(slideXml) {
  const images = [];
  const picChunks = splitTags(slideXml, 'p:pic');

  for (const pic of picChunks) {
    const blipM = /<a:blip\b([^>]*)>/.exec(pic);
    if (!blipM) continue;
    const rId = attr(blipM[1], 'r:embed');
    if (!rId) continue;

    const xfrmAttrs = attrOf(pic, 'a:off');
    const extAttrs  = attrOf(pic, 'a:ext');
    images.push({
      rId,
      x:  parseInt(attr(xfrmAttrs, 'x')  || '0'),
      y:  parseInt(attr(xfrmAttrs, 'y')  || '0'),
      cx: parseInt(attr(extAttrs, 'cx')   || '0'),
      cy: parseInt(attr(extAttrs, 'cy')   || '0'),
    });
  }

  return images;
}

// ── Item parsing from paragraph stream ───────────────────────────────────────

const SKIP_RE = /^(DESIGN INTENT|VENDOR PROPOSAL|SPECIFICATIONS|PROPOSAL & FINISHES)/i;

/** Return true if this paragraph looks like the start of a new item entry */
function isItemTitle(para) {
  const t = para.text.trim();
  if (!t || t.length < 4) return false;
  if (SKIP_RE.test(t)) return false;

  // Bold + underlined = strong signal (most common in these PPT templates)
  if (para.bold && para.underline) return true;

  // Bold with item-like content (dash separator + parenthetical code)
  if (para.bold && (/[–—-]/.test(t) || /\([^)]+\)/.test(t))) return true;

  return false;
}

/**
 * Parse a flat stream of paragraphs (sorted top→bottom) into item objects.
 * Each item: { query, sizeText, finishesText, descLines[] }
 */
function parseItems(paragraphs) {
  const items = [];
  let current = null;

  for (const para of paragraphs) {
    const t = para.text.trim();
    if (!t) continue;
    if (SKIP_RE.test(t)) continue;

    if (isItemTitle(para)) {
      if (current) items.push(current);
      current = { query: t, sizeText: '', finishesText: '', descLines: [] };
    } else if (current) {
      if (/^Size[:：\s]/i.test(t)) {
        current.sizeText = t.replace(/^Size[:：\s]*/i, '').trim();
      } else if (/^Finish(es)?[:：\s]/i.test(t)) {
        current.finishesText = t.replace(/^Finish(es)?[:：\s]*/i, '').trim();
      } else {
        current.descLines.push(t);
      }
    }
  }
  if (current) items.push(current);
  return items;
}

// ── Main parser ───────────────────────────────────────────────────────────────

async function parsePPTX(fileBuffer, fileName) {
  const JSZip = require('jszip');
  let zip;
  try {
    zip = await JSZip.loadAsync(fileBuffer);
  } catch (e) {
    throw new Error(`Failed to open PPTX file: ${e.message}`);
  }

  // Read presentation.xml for slide order and dimensions
  const presEntry   = zip.file('ppt/presentation.xml');
  const presRelsEnt = zip.file('ppt/_rels/presentation.xml.rels');
  const presXml     = presEntry   ? await presEntry.async('string') : '';
  const presRelsXml = presRelsEnt ? await presRelsEnt.async('string') : '';

  const slideCX  = getSlideCX(presXml);
  const presRels = getPresRels(presRelsXml);  // { rId: slideIndex }
  const slideOrder = getSlideOrder(presXml);  // [rId, rId, …] in presentation order

  // Build ordered list of slide indices
  const orderedIndices = slideOrder
    .map(rId => presRels[rId])
    .filter(n => n != null);

  // Fall back to whatever slides exist if presentation.xml couldn't be parsed
  if (orderedIndices.length === 0) {
    Object.keys(zip.files)
      .map(p => { const m = p.match(/^ppt\/slides\/slide(\d+)\.xml$/); return m ? parseInt(m[1]) : null; })
      .filter(Boolean)
      .sort((a, b) => a - b)
      .forEach(n => orderedIndices.push(n));
  }

  const items = [];
  const imgExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'emf', 'wmf']);

  for (const slideIdx of orderedIndices) {
    const slidePath = `ppt/slides/slide${slideIdx}.xml`;
    const relsPath  = `ppt/slides/_rels/slide${slideIdx}.xml.rels`;

    const slideEntry = zip.file(slidePath);
    if (!slideEntry) continue;

    const slideXml = await slideEntry.async('string');

    const relsEntry = zip.file(relsPath);
    const rels      = relsEntry ? parseSlideRels(await relsEntry.async('string')) : {};

    // ── Extract shapes ──────────────────────────────────────────────────────
    const textShapes = extractTextShapes(slideXml);
    const imageRefs  = extractImageRefs(slideXml);

    // ── Slide title = location ──────────────────────────────────────────────
    const titleShape = textShapes.find(s => s.isTitle);
    const location   = titleShape
      ? titleShape.paragraphs.map(p => p.text).join(' ').trim()
      : null;

    // ── Determine right-half threshold (40 % of slide width) ───────────────
    const rightThreshold = slideCX * 0.40;

    // ── Collect paragraphs from right-half text shapes, sorted top→bottom ──
    let rightShapes = textShapes
      .filter(s => !s.isTitle && s.x + s.cx > rightThreshold)
      .sort((a, b) => a.y - b.y);

    // If nothing in right half, fall back to all non-title shapes
    if (rightShapes.length === 0) {
      rightShapes = textShapes.filter(s => !s.isTitle).sort((a, b) => a.y - b.y);
    }

    const allParas = rightShapes.flatMap(s => s.paragraphs);

    // ── Parse items from paragraph stream ──────────────────────────────────
    const parsedItems = parseItems(allParas);
    if (parsedItems.length === 0) {
      logger.debug(`[ppt-parser] Slide ${slideIdx}: no items found`);
      continue;
    }

    // ── Right-half images, sorted top→bottom ────────────────────────────────
    const rightImages = imageRefs
      .filter(img => img.x + img.cx > rightThreshold)
      .sort((a, b) => a.y - b.y);

    // ── Map images to items in order ────────────────────────────────────────
    for (let i = 0; i < parsedItems.length; i++) {
      const pi  = parsedItems[i];
      const ref = rightImages[i] || null;

      // Build description text
      const descParts = [];
      if (pi.sizeText)     descParts.push(`Size: ${pi.sizeText}`);
      if (pi.finishesText) descParts.push(`Finishes: ${pi.finishesText}`);
      if (pi.descLines.length) descParts.push(...pi.descLines);
      const description = descParts.join('\n') || pi.query;

      // Load image buffer from media
      let rfpImageBase64 = null;
      if (ref && rels[ref.rId]) {
        const mediaFile = rels[ref.rId];
        const ext = (mediaFile.split('.').pop() || 'png').toLowerCase();
        if (imgExts.has(ext)) {
          const mediaEntry = zip.file(`ppt/media/${mediaFile}`);
          if (mediaEntry) {
            const buf = await mediaEntry.async('nodebuffer');
            if (buf.length > 2000) {
              const mimeExt = ext === 'jpg' ? 'jpeg' : ext;
              rfpImageBase64 = `data:image/${mimeExt};base64,${buf.toString('base64')}`;
            }
          }
        }
      }

      items.push({
        rfp_line:        `${slideIdx}.${i + 1}`,
        query:           pi.query,
        description,
        quantity:        1,
        location:        location || '',
        brand:           null,
        category:        null,
        dimensions:      pi.sizeText || null,
        materials:       pi.finishesText || null,
        notes:           '',
        sheet:           `Slide ${slideIdx}${location ? ` – ${location}` : ''}`,
        rfp_image_base64: rfpImageBase64,
        _dataRow:        slideIdx * 100 + i,
      });
    }
  }

  logger.info(`[ppt-parser] ${fileName}: ${items.length} items from ${orderedIndices.length} slides`);

  return {
    items,
    meta: {
      fileName,
      sheetsProcessed: [...new Set(items.map(i => i.sheet))],
      totalItems: items.length,
      format: 'pptx',
    },
    warnings: items.length === 0 ? [{
      sheet: 'all',
      severity: 'error',
      message: 'No items found in the PPT file',
      issues: [
        'Make sure item names are formatted as bold text in the "DESIGN INTENT & SPECIFICATIONS" section.',
      ],
    }] : [],
  };
}

module.exports = { parsePPTX };
