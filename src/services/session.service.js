const { pool } = require('../config/database');
const logger = require('../config/logger');

class SessionService {
  /**
   * Create a new RFP session for a Telegram chat
   */
  async createSession(chatId, userId) {
    // Check for existing active session
    const existing = await pool.query(
      `SELECT id, status FROM rfp_sessions
       WHERE telegram_chat_id = $1 AND status NOT IN ('completed', 'cancelled')
       ORDER BY created_at DESC LIMIT 1`,
      [chatId]
    );
    if (existing.rows.length > 0) {
      // Cancel previous incomplete session
      await pool.query(
        `UPDATE rfp_sessions SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [existing.rows[0].id]
      );
      logger.info(`[session] Cancelled previous session ${existing.rows[0].id} for chat ${chatId}`);
    }

    const result = await pool.query(
      `INSERT INTO rfp_sessions (telegram_chat_id, telegram_user_id, status)
       VALUES ($1, $2, 'awaiting_file') RETURNING *`,
      [chatId, userId]
    );
    logger.info(`[session] Created session ${result.rows[0].id} for chat ${chatId}`);
    return result.rows[0];
  }

  /**
   * Get the active session for a chat
   */
  async getActiveSession(chatId) {
    const result = await pool.query(
      `SELECT * FROM rfp_sessions
       WHERE telegram_chat_id = $1 AND status NOT IN ('completed', 'cancelled')
       ORDER BY created_at DESC LIMIT 1`,
      [chatId]
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
   * Save matched items for a session
   */
  async saveSessionItems(sessionId, items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await pool.query(
        `INSERT INTO rfp_session_items
         (session_id, item_index, rfp_line, query, description, quantity, location,
          image_description, match_source, confidence, product_name, product_brand,
          product_image_url, product_specs, rfp_image_base64)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          sessionId, i, item.rfp_line, item.query, item.description,
          item.quantity, item.location, item.image_description, item.match_source,
          item.confidence, item.product?.name, item.product?.brand,
          item.product?.image_url, JSON.stringify(item.product?.specs || {}),
          item.rfp_image_base64 || null
        ]
      );
    }
    await this.updateSession(sessionId, { total_items: items.length, status: 'reviewing' });
    logger.info(`[session] Saved ${items.length} items for session ${sessionId}`);
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
      product_name: item.product_name,
      product_brand: item.product_brand,
      product_image_url: item.product_image_url,
      product_specs: JSON.parse(item.product_specs || '{}'),
      rfp_image_base64: item.rfp_image_base64
    }));
  }
}

module.exports = new SessionService();
