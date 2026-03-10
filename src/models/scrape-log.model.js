const { pool } = require('../config/database');

class ScrapeLogModel {
  static async create({ brand_id, triggered_by = 'manual' }) {
    const { rows } = await pool.query(
      `INSERT INTO scrape_logs (brand_id, triggered_by)
       VALUES ($1, $2) RETURNING *`,
      [brand_id, triggered_by]
    );
    return rows[0];
  }

  static async complete(id, { products_found = 0, products_new = 0, products_updated = 0 }) {
    const { rows } = await pool.query(
      `UPDATE scrape_logs SET
        status = 'completed',
        products_found = $2,
        products_new = $3,
        products_updated = $4,
        completed_at = NOW(),
        duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
       WHERE id = $1 RETURNING *`,
      [id, products_found, products_new, products_updated]
    );
    return rows[0];
  }

  static async fail(id, error) {
    const { rows } = await pool.query(
      `UPDATE scrape_logs SET
        status = 'failed',
        errors = errors || $2::jsonb,
        completed_at = NOW(),
        duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
       WHERE id = $1 RETURNING *`,
      [id, JSON.stringify([{ message: error.message, stack: error.stack }])]
    );
    return rows[0];
  }

  static async findById(id) {
    const { rows } = await pool.query('SELECT * FROM scrape_logs WHERE id = $1', [id]);
    return rows[0] || null;
  }

  static async findByBrand(brandId, limit = 10) {
    const { rows } = await pool.query(
      'SELECT * FROM scrape_logs WHERE brand_id = $1 ORDER BY started_at DESC LIMIT $2',
      [brandId, limit]
    );
    return rows;
  }
}

module.exports = ScrapeLogModel;
