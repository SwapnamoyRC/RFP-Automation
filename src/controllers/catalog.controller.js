const { pool } = require('../config/database');
const logger = require('../config/logger');
const axios = require('axios');
const openaiConfig = require('../config/openai');
const { toSql } = require('pgvector/pg');
const { getImageEmbeddingFromBuffer } = require('../services/siglip-embedding.service');

/**
 * POST /api/catalog/submit
 * Internal team submits a product link/data for catalog learning.
 */
async function submitProduct(req, res) {
  const {
    productUrl, productName, brand, category,
    description, dimensions, materials, imageUrl, notes,
  } = req.body;

  if (!productUrl) {
    return res.status(400).json({ error: 'productUrl is required' });
  }

  // Check if already in the live catalog
  const inCatalog = await pool.query(
    'SELECT id FROM products WHERE source_url = $1 LIMIT 1',
    [productUrl]
  );
  if (inCatalog.rows.length > 0) {
    return res.status(409).json({ error: 'This product URL is already in the catalog.' });
  }

  // Check if already submitted (pending/approved/imported — not rejected)
  const inSubmissions = await pool.query(
    `SELECT id, status FROM product_submissions WHERE product_url = $1 AND status != 'rejected' LIMIT 1`,
    [productUrl]
  );
  if (inSubmissions.rows.length > 0) {
    const { status } = inSubmissions.rows[0];
    const label = status === 'imported' ? 'already imported into the catalog'
      : status === 'approved' ? 'already approved and pending import'
      : 'already submitted and under review';
    return res.status(409).json({ error: `This product URL has been ${label}.` });
  }

  const result = await pool.query(
    `INSERT INTO product_submissions
     (submitted_by, product_url, product_name, brand, category,
      description, dimensions, materials, image_url, notes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')
     RETURNING id, product_url, product_name, brand, status, created_at`,
    [
      req.user.id, productUrl, productName || null, brand || null,
      category || null, description || null, dimensions || null,
      materials || null, imageUrl || null, notes || null,
    ]
  );

  logger.info(`[catalog] Product submitted by user ${req.user.id}: ${productUrl}`);
  res.status(201).json(result.rows[0]);
}

/**
 * GET /api/catalog/submissions
 * List all product submissions (admin) or own submissions (user).
 */
async function listSubmissions(req, res) {
  const { status, limit = 50, offset = 0 } = req.query;
  const isAdmin = req.user.role === 'admin';

  const params = [];
  const conditions = [];

  if (!isAdmin) {
    params.push(req.user.id);
    conditions.push(`submitted_by = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(parseInt(limit), parseInt(offset));

  const result = await pool.query(
    `SELECT ps.*, u.email as submitted_by_email, u.name as submitted_by_name
     FROM product_submissions ps
     LEFT JOIN users u ON u.id = ps.submitted_by
     ${where}
     ORDER BY ps.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json(result.rows);
}

/**
 * PATCH /api/catalog/submissions/:id
 * Update submission status (admin only).
 * Body: { status: 'approved' | 'rejected' | 'imported' }
 */
async function updateSubmission(req, res) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const { id } = req.params;
  const { status, notes } = req.body;

  if (!['pending', 'approved', 'rejected', 'imported'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const result = await pool.query(
    `UPDATE product_submissions SET status = $1, notes = COALESCE($2, notes), updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [status, notes || null, id]
  );

  if (!result.rows[0]) return res.status(404).json({ error: 'Submission not found' });
  res.json(result.rows[0]);
}

/**
 * DELETE /api/catalog/submissions/:id
 * Delete own submission (or admin deletes any).
 */
async function deleteSubmission(req, res) {
  const { id } = req.params;
  const isAdmin = req.user.role === 'admin';

  const check = await pool.query(
    `SELECT id, submitted_by FROM product_submissions WHERE id = $1`,
    [id]
  );
  if (!check.rows[0]) return res.status(404).json({ error: 'Submission not found' });
  if (!isAdmin && check.rows[0].submitted_by !== req.user.id) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  await pool.query(`DELETE FROM product_submissions WHERE id = $1`, [id]);
  res.json({ deleted: true });
}

/**
 * POST /api/catalog/submissions/:id/import
 * Import an approved submission into the live products catalog.
 * Admin only. Steps:
 *   1. Get/create brand
 *   2. Upsert product row
 *   3. Generate + store text embedding
 *   4. If imageUrl: download → SigLIP embedding → product_siglip_images
 *   5. Mark submission as 'imported'
 */
async function importSubmission(req, res) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const { id } = req.params;

  const subResult = await pool.query(
    'SELECT * FROM product_submissions WHERE id = $1',
    [id]
  );
  const sub = subResult.rows[0];
  if (!sub) return res.status(404).json({ error: 'Submission not found' });
  if (sub.status !== 'approved') {
    return res.status(400).json({ error: 'Only approved submissions can be imported' });
  }

  const brandName = sub.brand || 'Unknown Brand';
  const brandSlug = brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const productDomain = (() => {
    try { return new URL(sub.product_url).hostname; } catch { return sub.product_url; }
  })();

  // 1. Get or create brand
  let brandId;
  const existingBrand = await pool.query('SELECT id FROM brands WHERE slug = $1', [brandSlug]);
  if (existingBrand.rows[0]) {
    brandId = existingBrand.rows[0].id;
  } else {
    const newBrand = await pool.query(
      `INSERT INTO brands (name, slug, base_url, scraper_type)
       VALUES ($1, $2, $3, 'manual')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [brandName, brandSlug, productDomain]
    );
    brandId = newBrand.rows[0].id;
  }

  // 2. Upsert product
  const productName = sub.product_name || 'Unnamed Product';
  const baseSlug = productName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // Ensure slug uniqueness within brand by appending short id
  const productSlug = `${baseSlug}-${String(id).substring(0, 6)}`;

  const productResult = await pool.query(
    `INSERT INTO products
      (brand_id, name, slug, description, dimensions, materials, category, image_url, source_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (brand_id, slug) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       dimensions = EXCLUDED.dimensions,
       materials = EXCLUDED.materials,
       category = EXCLUDED.category,
       image_url = EXCLUDED.image_url,
       source_url = EXCLUDED.source_url,
       updated_at = NOW()
     RETURNING id`,
    [
      brandId, productName, productSlug,
      sub.description || null,
      sub.dimensions || null,
      sub.materials || null,
      sub.category || null,
      sub.image_url || null,
      sub.product_url,
    ]
  );
  const productId = productResult.rows[0].id;

  // 3. Generate text embedding
  const embeddingInput = [
    productName,
    brandName,
    sub.description,
    sub.category,
    sub.dimensions ? `Dimensions: ${sub.dimensions}` : null,
    sub.materials ? `Materials: ${sub.materials}` : null,
  ].filter(Boolean).join('. ');

  try {
    const embResponse = await openaiConfig.openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: embeddingInput.substring(0, 8000),
    });
    const textEmb = embResponse.data[0].embedding;
    await pool.query(
      `INSERT INTO product_embeddings (product_id, embedding_type, embedding, input_text)
       VALUES ($1, 'product_description', $2, $3)
       ON CONFLICT (product_id, embedding_type) DO UPDATE SET
         embedding = $2, input_text = $3, created_at = NOW()`,
      [productId, toSql(textEmb), embeddingInput]
    );
    logger.info(`[catalog] Text embedding generated for product ${productId}`);
  } catch (err) {
    logger.warn(`[catalog] Text embedding failed for ${productId}: ${err.message}`);
  }

  // 4. SigLIP image embedding (if image URL provided)
  if (sub.image_url) {
    try {
      const imgResponse = await axios.get(sub.image_url, {
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RFP-Bot/1.0)' },
      });
      const imageBuffer = Buffer.from(imgResponse.data);
      const siglipEmb = await getImageEmbeddingFromBuffer(imageBuffer);
      const siglipStr = `[${siglipEmb.join(',')}]`;

      await pool.query(
        `INSERT INTO product_siglip_images (product_id, image_url, image_type, siglip_embedding)
         VALUES ($1, $2, 'product', $3::vector)
         ON CONFLICT DO NOTHING`,
        [productId, sub.image_url, siglipStr]
      );
      logger.info(`[catalog] SigLIP embedding generated for product ${productId}`);
    } catch (err) {
      logger.warn(`[catalog] SigLIP embedding failed for ${productId}: ${err.message}`);
    }
  }

  // 5. Mark as imported
  await pool.query(
    `UPDATE product_submissions SET status = 'imported', updated_at = NOW() WHERE id = $1`,
    [id]
  );

  logger.info(`[catalog] Submission ${id} imported as product ${productId}`);
  res.json({ imported: true, productId, productName, brandName });
}

module.exports = { submitProduct, listSubmissions, updateSubmission, deleteSubmission, importSubmission };
