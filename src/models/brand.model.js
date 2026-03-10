const { pool } = require('../config/database');

class BrandModel {
  static async findAll() {
    const { rows } = await pool.query(
      'SELECT * FROM brands WHERE is_active = true ORDER BY name'
    );
    return rows;
  }

  static async findBySlug(slug) {
    const { rows } = await pool.query(
      'SELECT * FROM brands WHERE slug = $1',
      [slug]
    );
    return rows[0] || null;
  }

  static async findById(id) {
    const { rows } = await pool.query(
      'SELECT * FROM brands WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  }
}

module.exports = BrandModel;
