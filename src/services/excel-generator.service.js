const ExcelJS = require('exceljs');
const https = require('https');
const http = require('http');

// ── Helpers ──────────────────────────────────────────────────────────────────

function downloadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    try {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, { timeout: 8000 }, (res) => {
        if (res.statusCode !== 200) { res.destroy(); return resolve(null); }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', () => resolve(null));
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    } catch { resolve(null); }
  });
}

function parseBase64Image(str) {
  if (!str || typeof str !== 'string') return null;
  try {
    const match = str.match(/^data:image\/(\w+);base64,(.+)$/s);
    if (match) {
      const ext = match[1] === 'jpg' ? 'jpeg' : match[1];
      const buf = Buffer.from(match[2], 'base64');
      return buf.length > 50 ? { buffer: buf, extension: ext } : null;
    }
    // Raw base64 — detect format from decoded bytes
    const buf = Buffer.from(str, 'base64');
    return buf.length > 50 ? { buffer: buf, extension: detectExt(buf) } : null;
  } catch { return null; }
}

function detectExt(buf) {
  if (!buf || buf.length < 4) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';  // PNG
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'jpeg'; // JPEG
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'gif';  // GIF
  return 'jpeg';
}

// Strip HTML tags, JSON-like fragments, and HTML entities from a string
function cleanText(str) {
  if (!str) return '';
  return str
    .replace(/<[^>]+>/g, ' ')           // HTML tags
    .replace(/\{[^}]*"href"[^}]*\}/g, '') // JSON href objects
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildProductSpec(product) {
  const db = product.dbDetails || {};
  const parts = [];
  if (db.dimensions)  parts.push(`Dimensions: ${db.dimensions}`);
  if (db.materials)   parts.push(`Materials: ${db.materials}`);
  if (db.category)    parts.push(`Category: ${db.category}`);
  if (db.description) parts.push(cleanText(db.description));
  // Fall back to specs array
  if (parts.length === 0) {
    for (const s of (product.specs || [])) parts.push(cleanText(s));
  }
  return parts.join('\n');
}

// ── Style constants ───────────────────────────────────────────────────────────

const HEADER_FILL  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
const HEADER_FONT  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
const BORDER_SIDE  = { style: 'thin', color: { argb: 'FFB0B8C4' } };
const ALL_BORDERS  = { top: BORDER_SIDE, left: BORDER_SIDE, bottom: BORDER_SIDE, right: BORDER_SIDE };
const ROW_H        = 85; // points — fits thumbnail images

// ── Main export ───────────────────────────────────────────────────────────────

async function generateExcel({ clientName, slides }) {
  // Pre-download all product images in parallel before touching ExcelJS
  const imgCache = new Map(); // url → Buffer
  const allProducts = slides.flatMap(s => s.products || []);
  await Promise.all(
    allProducts.map(async (p) => {
      const url = p.image_url;
      if (url && !imgCache.has(url)) {
        const buf = await downloadImage(url);
        if (buf) imgCache.set(url, buf);
      }
    })
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'RFP Automation';

  const sheet = workbook.addWorksheet('RFP Proposal', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  });

  // Columns: A Sl.No | B Image (RFP) | C Description | D qty | E Product Image | F Proposed product | G description
  sheet.getColumn(1).width = 7;   // A: Sl. No
  sheet.getColumn(2).width = 19;  // B: Image (RFP ref)
  sheet.getColumn(3).width = 38;  // C: Description
  sheet.getColumn(4).width = 7;   // D: qty
  sheet.getColumn(5).width = 19;  // E: Product Image
  sheet.getColumn(6).width = 26;  // F: Proposed product
  sheet.getColumn(7).width = 38;  // G: description

  // ── Header row ──────────────────────────────────────────────────────────────
  const HEADERS = ['Sl. No', 'Image', 'Description', 'qty', 'Product Image', 'Proposed product', 'description'];
  const hRow = sheet.getRow(1);
  hRow.height = 24;
  HEADERS.forEach((h, i) => {
    const cell = hRow.getCell(i + 1);
    cell.value = h;
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = ALL_BORDERS;
  });

  // ── Data rows ────────────────────────────────────────────────────────────────
  let currentRow = 2;
  const rfpImageOps  = []; // { imgStr, startRow, rowCount }
  const prodImageOps = []; // { buf, rowNum }

  for (let si = 0; si < slides.length; si++) {
    const slide   = slides[si];
    const prods   = slide.products || [];
    const rowCount = Math.max(prods.length, 1);
    const bgArgb  = si % 2 === 0 ? 'FFFFFFFF' : 'FFF3F4F6';

    // Add one row per product (or one empty row if no products)
    for (let p = 0; p < rowCount; p++) {
      const row  = sheet.getRow(currentRow + p);
      row.height = ROW_H;

      // Apply background + border to all 7 cells
      for (let c = 1; c <= 7; c++) {
        const cell = row.getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
        cell.border = ALL_BORDERS;
        cell.font = { size: 10, name: 'Calibri' };
        cell.alignment = { vertical: 'top', wrapText: true };
      }

      // ── Item-level cells (first row of the item only) ──────────────────────
      if (p === 0) {
        // A: Sl. No
        const aCell = row.getCell(1);
        aCell.value = si + 1;
        aCell.font = { bold: true, size: 11, name: 'Calibri' };
        aCell.alignment = { vertical: 'middle', horizontal: 'center' };

        // C: RFP Description — bold title + plain detail
        const cCell = row.getCell(3);
        const title  = (slide.slide_title || '').trim();
        const detail = cleanText((slide.rfp_description || '')).trim();
        const showDetail = detail && detail !== title && !detail.startsWith(title);
        if (showDetail) {
          cCell.value = {
            richText: [
              { text: title + '\n', font: { bold: true, size: 10, name: 'Calibri' } },
              { text: detail,       font: { bold: false, size: 10, name: 'Calibri' } },
            ],
          };
        } else {
          cCell.value = detail || title;
          cCell.font = { size: 10, name: 'Calibri' };
        }

        // D: qty
        const dCell = row.getCell(4);
        dCell.value = slide.quantity || '';
        dCell.alignment = { vertical: 'middle', horizontal: 'center' };
        dCell.font = { size: 10, name: 'Calibri' };
      }

      // ── Product-level cells ────────────────────────────────────────────────
      const prod = prods[p];
      if (prod) {
        // F: Proposed product (bold name + brand)
        const fCell = row.getCell(6);
        const prodName = (prod.product_name || '').trim();
        const brand    = (prod.brand || '').trim();
        fCell.value = {
          richText: [
            { text: prodName + (brand ? '\n' : ''), font: { bold: true,  size: 10, name: 'Calibri' } },
            { text: brand,                          font: { bold: false, size: 9,  name: 'Calibri', color: { argb: 'FF4B5563' } } },
          ],
        };

        // G: description / specs
        row.getCell(7).value = buildProductSpec(prod);

        // Schedule product image in column E
        const imgBuf = prod.image_url ? imgCache.get(prod.image_url) : null;
        if (imgBuf) {
          prodImageOps.push({ buf: imgBuf, rowNum: currentRow + p });
        }
      }
    }

    // Merge item-level columns (A, B, C, D) across all rows for this item
    if (rowCount > 1) {
      ['A', 'B', 'C', 'D'].forEach(col => {
        sheet.mergeCells(`${col}${currentRow}:${col}${currentRow + rowCount - 1}`);
      });
    }

    // Schedule RFP reference image in column B
    if (slide.rfp_image_url) {
      rfpImageOps.push({ imgStr: slide.rfp_image_url, startRow: currentRow, rowCount });
    }

    currentRow += rowCount;
  }

  // ── Embed images (after all rows/merges are set) ──────────────────────────

  for (const { imgStr, startRow, rowCount } of rfpImageOps) {
    const parsed = parseBase64Image(imgStr);
    if (!parsed) continue;
    try {
      const id = workbook.addImage({ buffer: parsed.buffer, extension: parsed.extension });
      const endRow = startRow + rowCount - 1;
      sheet.addImage(id, `B${startRow}:B${endRow}`);
    } catch { /* skip */ }
  }

  for (const { buf, rowNum } of prodImageOps) {
    try {
      const ext = detectExt(buf);
      const id  = workbook.addImage({ buffer: buf, extension: ext });
      sheet.addImage(id, `E${rowNum}:E${rowNum}`);
    } catch { /* skip */ }
  }

  return workbook.xlsx.writeBuffer();
}

module.exports = { generateExcel };
