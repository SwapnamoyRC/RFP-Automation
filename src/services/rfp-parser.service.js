const XLSX = require('xlsx');
const logger = require('../config/logger');

class RFPParserService {
  /**
   * Parse an uploaded RFP Excel file and extract product line items.
   * Handles multiple formats automatically by detecting header patterns.
   * @param {Buffer} fileBuffer - The Excel file buffer
   * @param {string} fileName - Original file name (for logging)
   * @returns {{ items: Array, meta: Object }}
   */
  parse(fileBuffer, fileName = 'unknown') {
    const wb = XLSX.read(fileBuffer, { type: 'buffer' });
    logger.info(`Parsing RFP file: ${fileName} (sheets: ${wb.SheetNames.join(', ')})`);

    const allItems = [];

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      const { headerRow, format } = this._detectFormat(rows);
      if (headerRow === -1) {
        logger.warn(`Sheet "${sheetName}": could not detect header row, skipping`);
        continue;
      }

      logger.info(`Sheet "${sheetName}": detected format="${format}" headerRow=${headerRow}`);
      const items = this._extractItems(rows, headerRow, format, sheetName);
      allItems.push(...items);
    }

    logger.info(`Parsed ${allItems.length} line items from ${fileName}`);

    return {
      items: allItems,
      meta: {
        fileName,
        sheetsProcessed: wb.SheetNames,
        totalItems: allItems.length
      }
    };
  }

  /**
   * Detect the header row and format type by scanning for known patterns.
   */
  _detectFormat(rows) {
    for (let i = 0; i < Math.min(25, rows.length); i++) {
      const row = rows[i];
      if (!row) continue;
      const joined = row.map(c => String(c || '').toLowerCase().trim()).join('|');

      // Format A: "s no|description|...|qty|rate|amount" (like 1 RFP.xlsx)
      if (joined.includes('s no') && joined.includes('description') && joined.includes('qty')) {
        // Check if there's a second Description column (Format B — 2 RFP.xlsx)
        const descCount = row.filter(c => String(c || '').toLowerCase().trim() === 'description').length;
        if (descCount >= 2 || joined.includes('location')) {
          return { headerRow: i, format: 'B' };
        }
        return { headerRow: i, format: 'A' };
      }

      // Format C: "sr.no|location|product name|qty|price|total" (like 3 RFP.xlsx)
      if (joined.includes('sr.no') && joined.includes('product name')) {
        return { headerRow: i, format: 'C' };
      }

      // Fallback: look for qty column with numeric data below
      if (joined.includes('qty') && joined.includes('location')) {
        return { headerRow: i, format: 'C' };
      }
    }

    return { headerRow: -1, format: null };
  }

  /**
   * Extract line items based on detected format.
   */
  _extractItems(rows, headerRow, format, sheetName) {
    switch (format) {
      case 'A': return this._extractFormatA(rows, headerRow, sheetName);
      case 'B': return this._extractFormatB(rows, headerRow, sheetName);
      case 'C': return this._extractFormatC(rows, headerRow, sheetName);
      default: return [];
    }
  }

  /**
   * Format A: S No | Description (multi-line with name+specs) | Image | Lead Time | UoM | Qty | Rate | Amount
   * Example: 1 RFP.xlsx
   */
  _extractFormatA(rows, headerRow, sheetName) {
    const header = rows[headerRow];
    const colMap = this._mapColumns(header, {
      sno: ['s no', 'sno', 'sr no', 'sl no', '#'],
      description: ['description'],
      qty: ['qty', 'quantity'],
      leadTime: ['lead time', 'lead time after po'],
      uom: ['uom', 'unit']
    });

    const items = [];
    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const sno = row[colMap.sno];
      const desc = row[colMap.description];
      const qty = row[colMap.qty];

      // Stop at totals row
      if (this._isTotalsRow(row)) break;
      if (!desc && !sno) continue;

      const parsed = this._parseDescription(String(desc || ''));

      items.push({
        rfp_line: String(sno || items.length + 1),
        query: parsed.productName,
        description: String(desc || ''),
        quantity: this._parseQty(qty),
        location: null,
        brand: parsed.brand,
        category: parsed.category,
        dimensions: parsed.dimensions,
        materials: parsed.materials,
        notes: parsed.specs,
        sheet: sheetName,
        _dataRow: i
      });
    }

    return items;
  }

  /**
   * Format B: S No | Description (requirement) | Location | Image | UoM | Qty | Description (recommended product)
   * Example: 2 RFP.xlsx
   */
  _extractFormatB(rows, headerRow, sheetName) {
    const header = rows[headerRow];
    // Find description column indices (there are two)
    const descIndices = [];
    const colMap = {};

    for (let c = 0; c < header.length; c++) {
      const val = String(header[c] || '').toLowerCase().trim();
      if (val === 'description') descIndices.push(c);
      if (['s no', 'sno', 'sr no'].includes(val)) colMap.sno = c;
      if (val === 'location') colMap.location = c;
      if (['qty', 'quantity'].includes(val)) colMap.qty = c;
      if (['uom', 'unit'].includes(val)) colMap.uom = c;
    }

    colMap.descRequirement = descIndices[0]; // RFP requirement
    colMap.descRecommended = descIndices.length > 1 ? descIndices[1] : null; // Recommended product

    const items = [];
    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const sno = row[colMap.sno];
      const reqDesc = row[colMap.descRequirement];
      const recDesc = colMap.descRecommended != null ? row[colMap.descRecommended] : null;
      const location = colMap.location != null ? row[colMap.location] : null;
      const qty = row[colMap.qty];

      if (this._isTotalsRow(row)) break;
      if (!reqDesc && !sno && !recDesc) continue;

      // Use recommended description if available (it's more specific), fall back to requirement
      const primaryDesc = recDesc || reqDesc || '';
      const parsed = this._parseDescription(String(primaryDesc));

      items.push({
        rfp_line: String(sno || items.length + 1),
        query: parsed.productName,
        description: String(primaryDesc),
        requirement: String(reqDesc || ''),
        quantity: this._parseQty(qty),
        location: location ? String(location).trim() : null,
        brand: parsed.brand,
        category: parsed.category,
        dimensions: parsed.dimensions,
        materials: parsed.materials,
        notes: parsed.specs,
        sheet: sheetName,
        _dataRow: i
      });
    }

    return items;
  }

  /**
   * Format C: Sr.no | Location | Product name and code | Qty | Price | Total
   * Example: 3 RFP.xlsx
   */
  _extractFormatC(rows, headerRow, sheetName) {
    const header = rows[headerRow];
    const colMap = this._mapColumns(header, {
      sno: ['sr.no', 'sno', 's no', 'sr no', '#'],
      location: ['location', 'product name and code', 'product name'],
      specs: ['product name and code', 'product name', 'description'],
      qty: ['qty', 'quantity']
    });

    // For Format C, "Location" is actually the product name column in some rows,
    // and "Product name and code" is the specs. Let's be smarter:
    // Col 3 = Location/Product Name, Col 4 = Specs/Code, Col 5 = Qty
    const items = [];
    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (this._isTotalsRow(row)) break;

      // Try to find the product name — it could be in column 3 or 4
      const col3 = row[3] ? String(row[3]).trim() : '';
      const col4 = row[4] ? String(row[4]).trim() : '';
      const qty = row[5];

      if (!col3 && !col4) continue;

      // col3 is typically the product type (MEETING POD TABLE, COFFEE TABLE, etc.)
      // col4 is typically the specs (dimensions, materials)
      const productName = col3 || col4;
      const specs = col4 || '';
      const parsed = this._parseDescription(`${productName} ${specs}`);

      // Clean product name: strip dimensions for better search queries
      // "MEETING POD TABLE 1200MM (L) X 800MM (w)" → "MEETING POD TABLE"
      const cleanName = productName
        .replace(/\d+\s*mm\s*(\([^)]*\))?\s*/gi, '')  // remove "1200MM (L)"
        .replace(/\d+\s*[xX×]\s*\d+/g, '')            // remove "750 x 750"
        .replace(/\d+\s*(?:Dia|Ht|LENGTH)\b/gi, '')    // remove "750 Dia"
        .replace(/[()]/g, '')                           // remove leftover parens
        .replace(/\s{2,}/g, ' ')                        // collapse spaces
        .trim();

      items.push({
        rfp_line: String(row[1] || items.length + 1),
        query: cleanName || parsed.productName || productName,
        description: `${productName}${specs ? '\n' + specs : ''}`,
        quantity: this._parseQty(qty),
        location: null,
        brand: parsed.brand,
        category: parsed.category,
        dimensions: parsed.dimensions,
        materials: parsed.materials,
        notes: specs,
        sheet: sheetName,
        _dataRow: i
      });
    }

    return items;
  }

  /**
   * Map column headers to indices.
   */
  _mapColumns(headerRow, mapping) {
    const result = {};
    for (const [key, aliases] of Object.entries(mapping)) {
      for (let c = 0; c < (headerRow || []).length; c++) {
        const val = String(headerRow[c] || '').toLowerCase().trim();
        if (aliases.some(a => val.includes(a))) {
          result[key] = c;
          break;
        }
      }
    }
    return result;
  }

  /**
   * Parse a multi-line product description into structured fields.
   * Extracts product name, brand, dimensions, materials, etc.
   */
  _parseDescription(text) {
    if (!text) return { productName: '', brand: null, category: null, dimensions: null, materials: null, specs: '' };

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    // First line is usually the product name
    let productName = lines[0] || '';

    // Detect brand from known brands in text
    const brand = this._detectBrand(text);

    // If brand prefix exists, clean it from product name
    if (brand) {
      productName = productName.replace(/^(HAY|Hay|hay|MUUTO|Muuto|muuto|NAUGHTONE|NaughtOne|naughtone|HM|Herman Miller|Knoll|KN)[_\s\-:]+/i, '').trim();
    }

    // Extract dimensions
    const dimensions = this._extractDimensions(text);

    // Extract materials
    const materials = this._extractMaterials(text);

    // Detect category
    const category = this._detectCategory(productName + ' ' + text);

    // Build specs string from non-name lines
    const specs = lines.slice(1).join('; ');

    return {
      productName: productName.replace(/\r/g, '').substring(0, 300),
      brand,
      category,
      dimensions,
      materials,
      specs
    };
  }

  /**
   * Detect brand from text.
   */
  _detectBrand(text) {
    const lower = text.toLowerCase();
    if (lower.includes('hay_') || lower.includes('hay ') || /\bhay\b/.test(lower)) return 'hay';
    if (lower.includes('muuto') || lower.includes('fiber armchair') || lower.includes('around coffee') || lower.includes('oslo sofa') || lower.includes('airy coffee') || lower.includes('echo pouf') || lower.includes('linear steel') || lower.includes('midst table') || lower.includes('base high table')) return 'muuto';
    if (lower.includes('naughtone') || lower.includes('lasso')) return 'naughtone';
    if (lower.includes('herman miller') || lower.includes('hm_') || lower.includes('passport table')) return null; // Not in our DB
    if (lower.includes('knoll') || lower.includes('kn collection')) return null;
    return null;
  }

  /**
   * Extract dimension info from text.
   */
  _extractDimensions(text) {
    const dimPatterns = [
      /(\d+(?:\.\d+)?\s*(?:L|W|D|H|Dia|Ht|Sh|cm|mm)[\s\S]*?(?:cm|mm))/i,
      /(\d+\s*(?:x|×)\s*\d+(?:\s*(?:x|×)\s*\d+)?(?:\s*(?:cm|mm)))/i,
      /DIMENSION[S]?\s*[:\n]\s*([^\n]+)/i
    ];

    for (const pattern of dimPatterns) {
      const match = text.match(pattern);
      if (match) return match[1].trim().substring(0, 300);
    }
    return null;
  }

  /**
   * Extract materials from text.
   */
  _extractMaterials(text) {
    const matPatterns = [
      /(?:material|finish|top|base|shell|upholstery)[:\s]+([^\n]+)/i,
      /(powder coated|upholster|fabric|leather|oak|beech|steel|metal|laminate|marble|plywood|melamine)/i
    ];

    for (const pattern of matPatterns) {
      const match = text.match(pattern);
      if (match) return match[1] ? match[1].trim().substring(0, 300) : match[0].trim();
    }
    return null;
  }

  /**
   * Detect product category from text.
   */
  _detectCategory(text) {
    const lower = text.toLowerCase();
    if (/\bchair\b/.test(lower) || /\barmchair\b/.test(lower) || /\bstool\b/.test(lower)) return 'seating';
    if (/\bsofa\b/.test(lower) || /\blounge\b/.test(lower) || /\brecliner\b/.test(lower)) return 'seating';
    if (/\btable\b/.test(lower) || /\bdesk\b/.test(lower)) return 'tables';
    if (/\bpouf\b/.test(lower) || /\bpouffe\b/.test(lower)) return 'accessories';
    if (/\blamp\b/.test(lower) || /\blight\b/.test(lower) || /\bpendant\b/.test(lower)) return 'lighting';
    if (/\bbed\b/.test(lower)) return 'seating';
    if (/\bcredenza\b/.test(lower) || /\bstorage\b/.test(lower)) return 'storage';
    return null;
  }

  /**
   * Check if a row is a totals/summary row.
   */
  _isTotalsRow(row) {
    const joined = row.map(c => String(c || '').toLowerCase()).join(' ');
    return joined.includes('total') || joined.includes('gst') || joined.includes('sub-total')
      || joined.includes('thank you') || joined.includes('terms & conditions');
  }

  /**
   * Parse quantity, handling various formats.
   */
  _parseQty(val) {
    if (val === null || val === undefined) return 0;
    const num = parseInt(String(val), 10);
    return isNaN(num) ? 0 : num;
  }
}

module.exports = new RFPParserService();
