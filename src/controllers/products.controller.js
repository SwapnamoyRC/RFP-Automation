const productService = require('../services/product.service');
const pdfService = require('../services/pdf.service');

async function getProducts(req, res) {
  const { brand, category, page = 1, limit = 20 } = req.query;
  const result = await productService.getProducts({
    brand,
    category,
    page: parseInt(page),
    limit: parseInt(limit)
  });
  res.json({
    products: result.products,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: result.total
    }
  });
}

async function getProductById(req, res) {
  const product = await productService.getProductById(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json({ product });
}

async function getProductPdf(req, res) {
  const product = await productService.getProductById(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  if (!product.pdf_url) {
    return res.json({
      product_id: product.id,
      pdf_url: null,
      extracted_text: product.pdf_text || null,
      specs: null,
      message: 'No PDF available for this product'
    });
  }

  // If we don't have extracted text yet, extract it now
  if (!product.pdf_text) {
    const result = await pdfService.processProductPdf(product.pdf_url, product.id);
    return res.json({
      product_id: product.id,
      pdf_url: product.pdf_url,
      extracted_text: result.text,
      specs: result.specs,
      pageCount: result.pageCount
    });
  }

  const specs = pdfService.parseSpecs(product.pdf_text);
  res.json({
    product_id: product.id,
    pdf_url: product.pdf_url,
    extracted_text: product.pdf_text,
    specs
  });
}

module.exports = { getProducts, getProductById, getProductPdf };
