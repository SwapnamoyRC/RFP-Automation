const { pool } = require('../config/database');
const logger = require('../config/logger');

class SessionService {
  /**
   * Create a new RFP session for a user
   */
  async createSession(userId) {
    const result = await pool.query(
      `INSERT INTO rfp_sessions (user_id, status) VALUES ($1, 'awaiting_file') RETURNING *`,
      [userId]
    );
    logger.info(`[session] Created session ${result.rows[0].id} for user ${userId}`);
    return result.rows[0];
  }

  /**
   * List sessions for a specific user (with item counts)
   */
  async listSessions({ userId, limit = 50, status } = {}) {
    const params = [userId];
    let where = `WHERE s.user_id = $1`;
    if (status) {
      params.push(status);
      where += ` AND s.status = $${params.length}`;
    }

    const query = `
      SELECT s.id, s.user_id, s.status, s.client_name, s.file_name,
        s.threshold, s.approved_count, s.rejected_count, s.created_at, s.updated_at,
        s.started_at, s.completed_at, s.processing_time_ms,
        COUNT(i.id)::int AS total_items,
        (COUNT(i.id) FILTER (WHERE i.review_status = 'approved'))::int AS approved_count_calc,
        (COUNT(i.id) FILTER (WHERE i.review_status = 'rejected'))::int AS rejected_count_calc,
        (COUNT(i.id) FILTER (WHERE i.review_status = 'pending'))::int AS pending_count,
        AVG(i.confidence) FILTER (WHERE i.review_status = 'approved') AS avg_confidence
      FROM rfp_sessions s
      LEFT JOIN rfp_session_items i ON i.session_id = s.id
      ${where}
      GROUP BY s.id ORDER BY s.created_at DESC
      LIMIT $${params.length + 1}
    `;
    params.push(limit);

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Get the active session for a user
   */
  async getActiveSession(userId) {
    const result = await pool.query(
      `SELECT * FROM rfp_sessions
       WHERE user_id = $1 AND status NOT IN ('completed', 'cancelled')
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId) {
    const result = await pool.query(`SELECT * FROM rfp_sessions WHERE id = $1`, [sessionId]);
    return result.rows[0] || null;
  }

  /**
   * Update session fields
   */
  async updateSession(sessionId, fields) {
    const setClauses = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(fields)) {
      setClauses.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
    setClauses.push(`updated_at = NOW()`);
    values.push(sessionId);

    await pool.query(
      `UPDATE rfp_sessions SET ${setClauses.join(', ')} WHERE id = $${idx}`,
      values
    );
  }

  /**
   * Save matched items for a session (batch)
   */
  async saveSessionItems(sessionId, items) {
    for (let i = 0; i < items.length; i++) {
      await this.saveSessionItem(sessionId, i, items[i]);
    }
    await this.updateSession(sessionId, { total_items: items.length, status: 'reviewing' });
    logger.info(`[session] Saved ${items.length} items for session ${sessionId}`);
  }

  /**
   * Save a single matched item for a session (for incremental saves during processing)
   */
  async saveSessionItem(sessionId, itemIndex, item) {
    await pool.query(
      `INSERT INTO rfp_session_items
       (session_id, item_index, rfp_line, query, description, quantity, location,
        image_description, match_source, confidence, product_name, product_brand,
        product_image_url, product_specs, rfp_image_base64, alternatives, match_explanation,
        matched_points, mismatched_points)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        sessionId, itemIndex, item.rfp_line, item.query, item.description,
        item.quantity, item.location, item.image_description, item.match_source,
        item.confidence, item.product?.name, item.product?.brand,
        item.product?.image_url || item.product?.images?.[0]?.url || null,
        JSON.stringify(item.product?.specs || {}),
        item.rfp_image_base64 || null,
        JSON.stringify(item.alternatives || []),
        item.match_explanation || null,
        JSON.stringify(item.matched_points || []),
        JSON.stringify(item.mismatched_points || []),
      ]
    );
  }

  /**
   * Get processing progress for a session
   */
  async getProgress(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    const itemCount = await pool.query(
      `SELECT COUNT(*)::int as completed FROM rfp_session_items WHERE session_id = $1`,
      [sessionId]
    );

    // Calculate elapsed time
    let elapsed_ms = null;
    if (session.started_at) {
      const end = session.completed_at ? new Date(session.completed_at) : new Date();
      elapsed_ms = new Date(end) - new Date(session.started_at);
    }

    return {
      status: session.status,
      total_items: session.total_items || 0,
      processed_items: itemCount.rows[0].completed,
      started_at: session.started_at || null,
      completed_at: session.completed_at || null,
      processing_time_ms: session.processing_time_ms || elapsed_ms,
    };
  }

  /**
   * Get all items for a session
   */
  async getSessionItems(sessionId) {
    const result = await pool.query(
      `SELECT * FROM rfp_session_items WHERE session_id = $1 ORDER BY item_index`,
      [sessionId]
    );
    return result.rows;
  }

  /**
   * Get pending (unreviewed) items for a session
   */
  async getPendingItems(sessionId) {
    const result = await pool.query(
      `SELECT * FROM rfp_session_items WHERE session_id = $1 AND review_status = 'pending' ORDER BY item_index`,
      [sessionId]
    );
    return result.rows;
  }

  /**
   * Approve or reject an item
   */
  async reviewItem(sessionId, itemId, status) {
    await pool.query(
      `UPDATE rfp_session_items SET review_status = $1 WHERE id = $2 AND session_id = $3`,
      [status, itemId, sessionId]
    );

    // Update session counts
    const counts = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE review_status = 'approved') as approved,
         COUNT(*) FILTER (WHERE review_status = 'rejected') as rejected,
         COUNT(*) FILTER (WHERE review_status = 'pending') as pending
       FROM rfp_session_items WHERE session_id = $1`,
      [sessionId]
    );

    const { approved, rejected, pending } = counts.rows[0];
    await this.updateSession(sessionId, {
      approved_count: parseInt(approved),
      rejected_count: parseInt(rejected)
    });

    logger.info(`[session] Item ${itemId} in session ${sessionId}: ${status} (${pending} pending)`);
    return { approved: parseInt(approved), rejected: parseInt(rejected), pending: parseInt(pending) };
  }

  /**
   * Get approved items formatted for PPT generation
   */
  async getApprovedItemsForPPT(sessionId) {
    const result = await pool.query(
      `SELECT * FROM rfp_session_items WHERE session_id = $1 AND review_status = 'approved' ORDER BY item_index`,
      [sessionId]
    );
    return result.rows.map(item => ({
      rfp_line: item.rfp_line,
      query: item.query,
      description: item.description,
      quantity: item.quantity,
      location: item.location,
      confidence: item.confidence,
      match_source: item.match_source,
      product_name: item.is_overridden ? (item.override_product_name || item.product_name) : item.product_name,
      product_brand: item.is_overridden ? (item.override_product_brand || item.product_brand) : item.product_brand,
      product_image_url: item.is_overridden ? (item.override_product_image_url || item.product_image_url) : item.product_image_url,
      product_specs: JSON.parse(item.product_specs || '{}'),
      rfp_image_base64: item.rfp_image_base64,
      is_overridden: item.is_overridden || false,
      override_product_url: item.override_product_url || null,
    }));
  }

  /**
   * Save an overridden product to the catalog with text + SigLIP embeddings
   */
  async saveOverriddenProductToCatalog(productName, productBrand, productUrl, productImageUrl = null) {
    const debugId = `OVERRIDE-${Date.now()}`;

    logger.info(`[${debugId}] ✨ Starting product catalog save`);
    logger.info(`[${debugId}] Input: name="${productName}", brand="${productBrand}", url="${productUrl}", imageUrl="${productImageUrl ? 'yes' : 'no'}"`);

    if (!productName || !productBrand || !productUrl) {
      logger.error(`[${debugId}] ❌ Insufficient data to save overridden product`, { productName, productBrand, productUrl });
      return null;
    }

    try {
      const openaiConfig = require('../config/openai');
      const { toSql } = require('pgvector/pg');
      const axios = require('axios');
      const { getImageEmbeddingFromBuffer } = require('./siglip-embedding.service');

      // 1. Get or create brand
      logger.info(`[${debugId}] 📌 Step 1: Get or create brand...`);
      const brandSlug = productBrand.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      logger.info(`[${debugId}]   Brand slug: "${brandSlug}"`);

      let brandId;
      try {
        const { rows: brandRows } = await pool.query(
          `INSERT INTO brands (name, slug, base_url, scraper_type)
           VALUES ($1, $2, $3, 'manual')
           ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [productBrand, brandSlug, 'https://manual-override']
        );
        brandId = brandRows[0].id;
        logger.info(`[${debugId}]   ✅ Brand saved/found: id=${brandId}`);
      } catch (err) {
        logger.error(`[${debugId}]   ❌ Brand creation failed: ${err.message}`);
        throw err;
      }

      // 2. Create product slug
      logger.info(`[${debugId}] 📌 Step 2: Create product slug...`);
      const baseSlug = productName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const productSlug = `${baseSlug}-override-${Date.now().toString().slice(-6)}`;
      logger.info(`[${debugId}]   Product slug: "${productSlug}"`);

      // 3. Upsert product
      logger.info(`[${debugId}] 📌 Step 3: Upsert product to database...`);
      let productId;
      try {
        const { rows: productRows } = await pool.query(
          `INSERT INTO products (brand_id, name, slug, source_url, image_url, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
           ON CONFLICT (brand_id, slug) DO UPDATE SET
             source_url = EXCLUDED.source_url,
             image_url = EXCLUDED.image_url,
             updated_at = NOW()
           RETURNING id`,
          [brandId, productName, productSlug, productUrl, productImageUrl]
        );
        productId = productRows[0].id;
        logger.info(`[${debugId}]   ✅ Product saved: id=${productId}`);
      } catch (err) {
        logger.error(`[${debugId}]   ❌ Product creation failed: ${err.message}`);
        throw err;
      }

      // 4. Generate text embedding
      logger.info(`[${debugId}] 📌 Step 4: Generate text embedding...`);
      const embInput = `${productName}. Brand: ${productBrand}. Product Link: ${productUrl}`;
      try {
        logger.info(`[${debugId}]   Calling OpenAI embeddings API...`);
        const embResponse = await openaiConfig.openai.embeddings.create({
          model: 'text-embedding-3-large',
          input: embInput.substring(0, 8000),
        });
        const textEmb = embResponse.data[0].embedding;
        logger.info(`[${debugId}]   Received embedding (${textEmb.length} dimensions)`);

        await pool.query(
          `INSERT INTO product_embeddings (product_id, embedding_type, embedding, input_text, model)
           VALUES ($1, 'product_description', $2, $3, 'text-embedding-3-large')
           ON CONFLICT (product_id, embedding_type) DO UPDATE SET
             embedding = $2, input_text = $3, created_at = NOW()`,
          [productId, toSql(textEmb), embInput]
        );
        logger.info(`[${debugId}]   ✅ Text embedding stored in database`);
      } catch (embErr) {
        logger.error(`[${debugId}]   ❌ Text embedding failed: ${embErr.message}`);
        logger.error(`[${debugId}]   Stack: ${embErr.stack}`);
      }

      // 5. Generate SigLIP embedding if image URL provided
      if (productImageUrl) {
        logger.info(`[${debugId}] 📌 Step 5: Generate SigLIP embedding...`);
        try {
          logger.info(`[${debugId}]   Downloading image from: ${productImageUrl}`);
          const imgResponse = await axios.get(productImageUrl, {
            responseType: 'arraybuffer',
            timeout: 20000,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RFP-Bot/1.0)' },
          });
          logger.info(`[${debugId}]   Downloaded ${imgResponse.data.length} bytes`);

          const imageBuffer = Buffer.from(imgResponse.data);
          logger.info(`[${debugId}]   Generating SigLIP embedding...`);
          const siglipEmb = await getImageEmbeddingFromBuffer(imageBuffer);
          const siglipStr = `[${siglipEmb.join(',')}]`;
          logger.info(`[${debugId}]   Generated SigLIP embedding (${siglipEmb.length} dimensions)`);

          await pool.query(
            `INSERT INTO product_siglip_images (product_id, image_url, image_type, siglip_embedding)
             VALUES ($1, $2, 'product', $3::vector)
             ON CONFLICT DO NOTHING`,
            [productId, productImageUrl, siglipStr]
          );
          logger.info(`[${debugId}]   ✅ SigLIP embedding stored in database`);
        } catch (siglipErr) {
          logger.error(`[${debugId}]   ❌ SigLIP embedding failed: ${siglipErr.message}`);
          logger.error(`[${debugId}]   Stack: ${siglipErr.stack}`);
        }
      } else {
        logger.info(`[${debugId}] 📌 Step 5: Skipping SigLIP (no image URL provided)`);
      }

      logger.info(`[${debugId}] ✅ SUCCESS: Product saved to catalog (${productName} by ${productBrand})`);
      logger.info(`[${debugId}]   Product ID: ${productId}`);
      logger.info(`[${debugId}]   Brand ID: ${brandId}`);
      logger.info(`[${debugId}]   Slug: ${productSlug}`);
      return productId;
    } catch (err) {
      logger.error(`[${debugId}] ❌ FATAL ERROR: ${err.message}`);
      logger.error(`[${debugId}] Stack trace: ${err.stack}`);
      return null;
    }
  }
}

module.exports = new SessionService();
