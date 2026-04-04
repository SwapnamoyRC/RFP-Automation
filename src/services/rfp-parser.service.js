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
    logger.info(`[format-detect] Scanning ${Math.min(25, rows.length)} rows for header pattern`);

    for (let i = 0; i < Math.min(25, rows.length); i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      // Skip rows that are mostly empty (all cells null/empty)
      const nonEmptyCells = row.filter(c => String(c || '').trim().length > 0).length;
      if (nonEmptyCells < 2) {
        logger.info(`[format-detect] Row ${i}: skipped (only ${nonEmptyCells} non-empty cells)`);
        continue;
      }

      const joined = row.map(c => String(c || '').toLowerCase().trim()).join('|');
      logger.info(`[format-detect] Row ${i}: "${joined.substring(0, 80)}..."`);

      // Helper: does this row have a serial number header?
      const hasSnoHeader = /\bs[.\s]*n[o.]?[.\s]*|sl[.\s]*no|sr[.\s]*no|sno\b/.test(joined);
      // Helper: does this row have a description header?
      const hasDescHeader = joined.includes('description') || joined.includes('product name');
      // Helper: does this row have a qty header?
      const hasQtyHeader = joined.includes('qty') || joined.includes('quantity');

      // Format A: "s no|description|...|qty|rate|amount" (like 1 RFP.xlsx)
      if (hasSnoHeader && hasDescHeader && hasQtyHeader) {
        // Check if there's a second Description column (Format B — 2 RFP.xlsx)
        const descCount = row.filter(c => String(c || '').toLowerCase().trim() === 'description').length;
        if (descCount >= 2 || joined.includes('location')) {
          return { headerRow: i, format: 'B' };
        }

        // Check if it's a BOQ/Format D style (has "item description" or "item" + multi-row data)
        if (joined.includes('item description')) {
          logger.info(`[format-detect] ✓ Matched Format D at row ${i}`);
          return { headerRow: i, format: 'D' };
        }

        return { headerRow: i, format: 'A' };
      }

      // Format C: "sr.no|location|product name|qty|price|total" (like 3 RFP.xlsx)
      if (joined.includes('sr.no') && joined.includes('product name')) {
        return { headerRow: i, format: 'C' };
      }

      // Format D: "sl.no|item description|ref image|...|total quantity" (like RFP 5.xlsx — BOQ format)
      if (hasSnoHeader && joined.includes('item description')) {
        logger.info(`[format-detect] ✓ Matched Format D at row ${i}`);
        return { headerRow: i, format: 'D' };
      }

      // Format E: "nos|item|specification|unit|...|qty" (like RFP 7.xlsx — multi-row format)
      if ((joined.includes('nos') || joined.includes('no.')) && joined.includes('item') && joined.includes('specification')) {
        return { headerRow: i, format: 'E' };
      }

      // Format F: "location|specifications|proposed image|quantity" (like RFP 6.xlsx)
      // No serial number header — serial numbers are in the first data column
      if (joined.includes('specification') && joined.includes('quantity') && joined.includes('location')) {
        return { headerRow: i, format: 'F' };
      }

      // Fallback: look for qty column with numeric data below
      if (hasQtyHeader && joined.includes('location')) {
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
      case 'D': return this._extractFormatD(rows, headerRow, sheetName);
      case 'E': return this._extractFormatE(rows, headerRow, sheetName);
      case 'F': return this._extractFormatF(rows, headerRow, sheetName);
      default: return [];
    }
  }

  /**
   * Format A: S No | Description (multi-line with name+specs) | Image | Lead Time | UoM | Qty | Rate | Amount
   * Example: 1 RFP.xlsx, RFP 8.xlsx
   * Note: Some files have an empty first column in the header but not in data (shift by 1)
   */
  _extractFormatA(rows, headerRow, sheetName) {
    const header = rows[headerRow];

    // Check if header starts with empty column (common in some RFPs)
    const headerShift = String(header[0] || '').trim() === '' ? 1 : 0;

    const colMap = this._mapColumns(header, {
      sno: ['s no', 'sno', 'sr no', 'sl no', 'sl.no', '#', 'sr.no'],
      description: ['description', 'product name', 'product'],
      qty: ['qty', 'quantity'],
      leadTime: ['lead time', 'lead time after po'],
      uom: ['uom', 'unit']
    });

    // Adjust column indices for header shift
    for (const key in colMap) {
      if (colMap[key] !== undefined) {
        colMap[key] -= headerShift;
      }
    }

    logger.info(`[extract-A] Column shift: ${headerShift}, mapped: sno=${colMap.sno}, desc=${colMap.description}, qty=${colMap.qty}`);

    const items = [];
    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const sno = colMap.sno !== undefined && colMap.sno >= 0 ? row[colMap.sno] : null;
      const desc = colMap.description !== undefined && colMap.description >= 0 ? String(row[colMap.description] || '').trim() : '';
      const qty = colMap.qty !== undefined && colMap.qty >= 0 ? row[colMap.qty] : null;

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

    logger.info(`[extract-A] Extracted ${items.length} items from sheet "${sheetName}"`);
    return items;
  }

  /**
   * Format B: S No | Product Name | Location | Image | UoM | Qty | Specifications
   * Example: 2 RFP.xlsx, RFP 8.xlsx
   * Note: Some files have an empty first column in the header but not in data (shift by 1)
   */
  _extractFormatB(rows, headerRow, sheetName) {
    const header = rows[headerRow];
    const colMap = {};

    // Check if header starts with empty column (common in some RFPs)
    const headerShift = String(header[0] || '').trim() === '' ? 1 : 0;

    for (let c = 0; c < header.length; c++) {
      const val = String(header[c] || '').toLowerCase().trim();
      if (['s no', 'sno', 'sr no', 'sr.no'].includes(val)) colMap.sno = c - headerShift;
      if (val === 'location') colMap.location = c - headerShift;
      if (val.includes('product name') || val === 'description') colMap.productName = c - headerShift;
      if (val.includes('proposed') || val.includes('reference') || val.includes('image')) colMap.image = c - headerShift;
      if (['qty', 'quantity'].includes(val)) colMap.qty = c - headerShift;
      if (['uom', 'unit'].includes(val)) colMap.uom = c - headerShift;
    }

    logger.info(`[extract-B] Column shift: ${headerShift}, mapped: sno=${colMap.sno}, productName=${colMap.productName}, location=${colMap.location}, qty=${colMap.qty}`);

    const items = [];
    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const sno = colMap.sno !== undefined && colMap.sno >= 0 ? row[colMap.sno] : null;
      const productName = colMap.productName !== undefined && colMap.productName >= 0 ? String(row[colMap.productName] || '').trim() : '';
      const location = colMap.location !== undefined && colMap.location >= 0 ? String(row[colMap.location] || '').trim() : null;
      const qty = colMap.qty !== undefined && colMap.qty >= 0 ? row[colMap.qty] : null;

      if (this._isTotalsRow(row)) break;
      if (!productName && !sno) continue;

      const parsed = this._parseDescription(String(productName));

      items.push({
        rfp_line: String(sno || items.length + 1),
        query: parsed.productName,
        description: String(productName),
        quantity: this._parseQty(qty),
        location: location || null,
        brand: parsed.brand,
        category: parsed.category,
        dimensions: parsed.dimensions,
        materials: parsed.materials,
        notes: parsed.specs,
        sheet: sheetName,
        _dataRow: i
      });
    }

    logger.info(`[extract-B] Extracted ${items.length} items from sheet "${sheetName}"`);
    return items;
  }

  /**
   * Format C: Sr.no | image | Location | Product name and code | Qty | Price | Total
   * Example: 3 RFP.xlsx
   * Note: The "Location" column often contains the product name/type (e.g. "SITTING CHAIR"),
   * while "Product name and code" contains specs/dimensions. We use both.
   */
  _extractFormatC(rows, headerRow, sheetName) {
    const header = rows[headerRow];

    // Map columns dynamically from headers
    const colMap = {};
    for (let c = 0; c < (header || []).length; c++) {
      const val = String(header[c] || '').toLowerCase().trim();
      if (['sr.no', 'sno', 's no', 'sr no', '#'].some(a => val.includes(a))) colMap.sno = c;
      if (val === 'image') colMap.image = c;
      if (val === 'location') colMap.location = c;
      if (val.includes('product name')) colMap.productName = c;
      if (['qty', 'quantity'].some(a => val === a)) colMap.qty = c;
      if (val === 'description' && colMap.productName === undefined) colMap.productName = c;
    }

    const items = [];
    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (this._isTotalsRow(row)) break;

      const sno = colMap.sno !== undefined ? row[colMap.sno] : null;
      const locationVal = colMap.location !== undefined ? String(row[colMap.location] || '').trim() : '';
      const productVal = colMap.productName !== undefined ? String(row[colMap.productName] || '').trim() : '';
      const qty = colMap.qty !== undefined ? row[colMap.qty] : null;

      if (!locationVal && !productVal) continue;

      // Heuristic: determine which column has the product name vs specs.
      // If locationVal is short text (no dimensions), it's likely the product name.
      // If productVal has lots of dimensions/numbers, it's likely the specs.
      const hasDimensions = (s) => /\d+\s*(mm|cm|kg|lb|in)\b/i.test(s) || /[wdh]\d{2,}/i.test(s);

      let productName, specs, location;
      if (locationVal && !hasDimensions(locationVal) && hasDimensions(productVal)) {
        // Location column has product name, product column has specs
        productName = locationVal;
        specs = productVal;
        location = null;
      } else if (productVal && !hasDimensions(productVal)) {
        // Product column has clean product name
        productName = productVal;
        specs = locationVal;
        location = null;
      } else {
        // Fallback: use whichever has less dimensions as product name
        productName = locationVal || productVal;
        specs = productVal || '';
        location = null;
      }

      const parsed = this._parseDescription(`${productName} ${specs}`);

      // Clean product name: strip dimensions for better search queries
      const cleanName = productName
        .replace(/\d+\s*mm\s*(\([^)]*\))?\s*/gi, '')  // remove "1200MM (L)"
        .replace(/\d+\s*[xX×]\s*\d+/g, '')            // remove "750 x 750"
        .replace(/\d+\s*(?:Dia|Ht|LENGTH)\b/gi, '')    // remove "750 Dia"
        .replace(/[()]/g, '')                           // remove leftover parens
        .replace(/\s{2,}/g, ' ')                        // collapse spaces
        .trim();

      items.push({
        rfp_line: String(sno || items.length + 1),
        query: cleanName || parsed.productName || productName,
        description: `${productName}${specs ? '\n' + specs : ''}`,
        quantity: this._parseQty(qty),
        location,
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
   * Format D: Sl.No | Item Description | Ref Image | Deck Image | Unit | Quantity | ... | Total Quantity | Rate | Amount
   * Example: RFP 5.xlsx — BOQ format with multi-line descriptions in "Item Description" column.
   * Items have no S.No (section headers do), and "Total Quantity" is the qty column.
   */
  _extractFormatD(rows, headerRow, sheetName) {
    const header = rows[headerRow];
    const colMap = {};

    for (let c = 0; c < (header || []).length; c++) {
      const val = String(header[c] || '').toLowerCase().trim();
      if (['sl.no', 'sl no', 's.no', 'sno'].some(a => val.includes(a))) colMap.sno = c;
      if (val.includes('item description') || val === 'item') colMap.description = c;
      if (val.includes('total quantity') || val.includes('total qty')) colMap.totalQty = c;
      if ((val.includes('qty') || val.includes('quantity')) && colMap.totalQty === undefined) colMap.qty = c;
      if (val === 'unit' || val === 'uom') colMap.unit = c;
      if (val === 'code' || val === 'item code') colMap.code = c;
    }

    logger.info(`[extract-D] Column mapping: sno=${colMap.sno}, desc=${colMap.description}, qty=${colMap.qty}, totalQty=${colMap.totalQty}, unit=${colMap.unit}, code=${colMap.code}`);

    const qtyCol = colMap.totalQty !== undefined ? colMap.totalQty : colMap.qty;

    // Collect items by merging multi-row entries (like Format E).
    // A row with a serial number starts a new item; rows without sno are continuations.
    const collected = [];
    let current = null;

    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const sno = colMap.sno !== undefined ? row[colMap.sno] : null;
      const desc = colMap.description !== undefined ? String(row[colMap.description] || '').trim() : '';
      const qty = qtyCol !== undefined ? row[qtyCol] : null;
      const unit = colMap.unit !== undefined ? String(row[colMap.unit] || '').trim() : '';
      const code = colMap.code !== undefined ? String(row[colMap.code] || '').trim() : '';

      // Skip fully empty rows
      if (!sno && !desc && !code) continue;

      if (this._isTotalsRow(row)) {
        logger.info(`[extract-D] Row ${i}: totals row, breaking`);
        break;
      }

      // Section headers: have sno text but no unit and no qty (e.g. "Work Area & Collab")
      if (sno && !unit && !qty && desc && !code) {
        logger.info(`[extract-D] Row ${i}: section header "${desc.substring(0, 40)}", skipped`);
        continue;
      }

      // New item starts when serial number is present
      if (sno && (unit || qty)) {
        if (current) collected.push(current);
        current = {
          sno: String(sno),
          code,
          productName: desc,
          extraDesc: '',
          quantity: this._parseQty(qty),
          unit,
          _dataRow: i,
        };
        logger.info(`[extract-D] Row ${i}: NEW item sno=${sno} "${desc.substring(0, 50)}" qty=${qty}`);
      } else if (current && desc) {
        // Continuation row — append description to previous item
        current.extraDesc += (current.extraDesc ? '\n' : '') + desc;
        logger.info(`[extract-D] Row ${i}: continuation → "${desc.substring(0, 50)}"`);
      }
    }
    // Don't forget the last item
    if (current) collected.push(current);

    logger.info(`[extract-D] Collected ${collected.length} items before conversion`);

    // Convert collected multi-row items to standard format
    return collected.map(item => {
      const fullDesc = item.extraDesc
        ? `${item.productName}\n${item.extraDesc}`
        : item.productName;
      const parsed = this._parseDescription(fullDesc);

      return {
        rfp_line: item.sno,
        query: item.productName || parsed.productName,
        description: fullDesc,
        quantity: item.quantity,
        location: null,
        brand: parsed.brand,
        category: parsed.category,
        dimensions: parsed.dimensions,
        materials: parsed.materials,
        notes: item.extraDesc || parsed.specs,
        sheet: sheetName,
        _dataRow: item._dataRow,
      };
    });
  }

  /**
   * Format E: Nos | ITEM | SPECIFICATION | UNIT | <location columns> | QTY | RATE | AMOUNT | PROPOSED ITEM | SPECIFICATION
   * Example: RFP 7.xlsx — multi-row format where item name is on one row and specs/dimensions on the next.
   * Rows with a number in "Nos" column start a new item; continuation rows add specs.
   */
  _extractFormatE(rows, headerRow, sheetName) {
    const header = rows[headerRow];
    const colMap = {};
    for (let c = 0; c < (header || []).length; c++) {
      const val = String(header[c] || '').toLowerCase().trim();
      if (val === 'nos' || val === 'no.' || val === 'no') colMap.nos = c;
      if (val === 'item') colMap.item = c;
      if (val === 'specification' && colMap.spec === undefined) colMap.spec = c; // first "specification" column
      if (val === 'unit' || val === 'uom') colMap.unit = c;
      if (val === 'qty' || val === 'quantity') colMap.qty = c;
    }

    // Collect items by merging multi-row entries
    const items = [];
    let current = null;

    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (this._isTotalsRow(row)) break;

      const nos = colMap.nos !== undefined ? row[colMap.nos] : null;
      const itemName = colMap.item !== undefined ? String(row[colMap.item] || '').trim() : '';
      const spec = colMap.spec !== undefined ? String(row[colMap.spec] || '').trim() : '';
      const qty = colMap.qty !== undefined ? row[colMap.qty] : null;

      // Skip section header rows (like "BOUGHT OUT FURNITURES")
      if (!nos && !itemName && spec && !qty) continue;

      // New item starts when "Nos" column has a number
      const nosNum = parseInt(String(nos), 10);
      if (!isNaN(nosNum) && nosNum > 0) {
        // Save previous item
        if (current) items.push(current);

        current = {
          rfp_line: String(nosNum),
          itemName: itemName,
          specs: spec,
          quantity: this._parseQty(qty),
          _dataRow: i,
        };
      } else if (current) {
        // Continuation row — append specs and pick up qty if present
        if (spec) current.specs += '\n' + spec;
        if (qty && !current.quantity) current.quantity = this._parseQty(qty);
        if (itemName && !current.itemName) current.itemName = itemName;
      }
    }
    // Don't forget the last item
    if (current) items.push(current);

    // Convert collected items to standard format
    return items.map(item => {
      const fullDesc = `${item.itemName}\n${item.specs}`.trim();
      const parsed = this._parseDescription(fullDesc);

      return {
        rfp_line: item.rfp_line,
        query: item.itemName || parsed.productName,
        description: fullDesc,
        quantity: item.quantity,
        location: null,
        brand: parsed.brand,
        category: parsed.category,
        dimensions: parsed.dimensions,
        materials: parsed.materials,
        notes: item.specs,
        sheet: sheetName,
        _dataRow: item._dataRow
      };
    });
  }

  /**
   * Format F: (sno) | LOCATION | Specifications | Proposed Image | Lead Time | Quantity | Rate | Total | Description | Reference Images
   * Example: RFP 6.xlsx — serial numbers in first column (no header for it),
   * product description in "Specifications" column, section headers as non-numbered rows.
   */
  _extractFormatF(rows, headerRow, sheetName) {
    const header = rows[headerRow];
    const colMap = {};
    for (let c = 0; c < (header || []).length; c++) {
      const val = String(header[c] || '').toLowerCase().trim();
      if (val.includes('specification')) colMap.spec = c;
      if (val === 'location') colMap.location = c;
      if (val === 'quantity' || val === 'qty') colMap.qty = c;
      if (val === 'description') colMap.description = c;
    }

    // Serial number is in the first column (col 0) with no header
    const snoCol = 0;

    // Some items span two rows: row with serial number only, then row with data.
    // Collect by tracking current serial number.
    const items = [];
    let pendingSno = null;
    let pendingRow = null;

    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (this._isTotalsRow(row)) break;

      const sno = row[snoCol];
      const snoNum = parseInt(String(sno), 10);
      const spec = colMap.spec !== undefined ? String(row[colMap.spec] || '').trim() : '';
      const qty = colMap.qty !== undefined ? row[colMap.qty] : null;
      const location = colMap.location !== undefined ? String(row[colMap.location] || '').trim() : '';
      const desc = colMap.description !== undefined ? String(row[colMap.description] || '').trim() : '';

      // Row with just a serial number and no spec — save for next row
      if (!isNaN(snoNum) && !spec) {
        pendingSno = snoNum;
        pendingRow = i;
        continue;
      }

      // Skip section headers (no serial number, no pending serial, no qty)
      const effectiveSno = !isNaN(snoNum) ? snoNum : pendingSno;
      const effectiveRow = !isNaN(snoNum) ? i : (pendingRow || i);
      pendingSno = null;
      pendingRow = null;

      if (effectiveSno === null || !spec) continue;

      const fullDesc = desc ? `${spec}\n${desc}` : spec;
      const parsed = this._parseDescription(fullDesc);

      items.push({
        rfp_line: String(effectiveSno),
        query: parsed.productName,
        description: fullDesc,
        quantity: this._parseQty(qty),
        location: location || null,
        brand: parsed.brand,
        category: parsed.category,
        dimensions: parsed.dimensions,
        materials: parsed.materials,
        notes: parsed.specs,
        sheet: sheetName,
        _dataRow: effectiveRow
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
