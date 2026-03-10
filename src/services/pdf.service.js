const axios = require('axios');
const pdfParse = require('pdf-parse');
const logger = require('../config/logger');
const ProductModel = require('../models/product.model');

class PdfService {
  async extractFromUrl(pdfUrl) {
    const response = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RFPBot/1.0)'
      }
    });

    const buffer = Buffer.from(response.data);
    const data = await pdfParse(buffer);

    return {
      text: data.text,
      pageCount: data.numpages,
      info: data.info
    };
  }

  parseSpecs(rawText) {
    const specs = {};

    // Dimension patterns
    const dimPatterns = [
      /dimensions?[:\s]+([^\n]+)/i,
      /(?:w|width)[:\s]*(\d+)\s*(?:x|d|depth)[:\s]*(\d+)\s*(?:x|h|height)[:\s]*(\d+)\s*(mm|cm|in)/i,
      /(\d+)\s*x\s*(\d+)\s*x\s*(\d+)\s*(mm|cm)/i
    ];
    for (const pattern of dimPatterns) {
      const match = rawText.match(pattern);
      if (match) {
        specs.dimensions = match[0].trim();
        break;
      }
    }

    // Materials
    const matMatch = rawText.match(/materials?[:\s]+([^\n]+(?:\n(?!\n)[^\n]+)*)/i);
    if (matMatch) specs.materials = matMatch[1].trim();

    // Weight
    const weightMatch = rawText.match(/weight[:\s]+([\d.]+\s*(?:kg|lbs?|g))/i);
    if (weightMatch) specs.weight = weightMatch[1].trim();

    // Certifications
    const certPatterns = /(?:BS EN|ANSI|BIFMA|ISO)\s*[\d:.-]+/gi;
    const certs = rawText.match(certPatterns);
    if (certs) specs.certifications = [...new Set(certs)];

    return specs;
  }

  async processProductPdf(pdfUrl, productId = null) {
    logger.info(`Processing PDF: ${pdfUrl}`);
    const { text, pageCount } = await this.extractFromUrl(pdfUrl);
    const specs = this.parseSpecs(text);

    if (productId) {
      await ProductModel.updatePdfData(productId, { pdf_text: text, pdf_url: pdfUrl });
    }

    return { text, specs, pageCount };
  }
}

module.exports = new PdfService();
