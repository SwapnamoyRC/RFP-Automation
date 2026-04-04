const { pool } = require('../config/database');

class ProductResourceModel {
  static async upsert(data) {
    const { family_id, variant_id, resource_type, title, url, file_size, extracted_text, metadata } = data;

    const { rows } = await pool.query(
      `INSERT INTO product_resources (family_id, variant_id, resource_type, title, url, file_size, extracted_text, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [family_id, variant_id || null, resource_type, title, url, file_size,
       extracted_text, metadata ? JSON.stringify(metadata) : null]
    );
    return rows[0];
  }

  static async findByFamily(familyId) {
    const { rows } = await pool.query(
      'SELECT * FROM product_resources WHERE family_id = $1 ORDER BY resource_type, title',
      [familyId]
    );
    return rows;
  }

  static async findByVariant(variantId) {
    const { rows } = await pool.query(
      'SELECT * FROM product_resources WHERE variant_id = $1 ORDER BY resource_type, title',
      [variantId]
    );
    return rows;
  }
}

module.exports = ProductResourceModel;
