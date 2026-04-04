const { pool } = require('../config/database');

class ProductVariantV2Model {
  static async upsert(familyId, brandId, data) {
    const { name, slug, description, sku, source_url, thumbnail_url, is_primary, metadata } = data;

    const { rows } = await pool.query(
      `INSERT INTO product_variants_v2 (family_id, brand_id, name, slug, description, sku, source_url, thumbnail_url, is_primary, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (family_id, slug) DO UPDATE SET
         name = $3, description = $5, sku = $6, source_url = $7,
         thumbnail_url = $8, is_primary = $9, metadata = $10, updated_at = NOW()
       RETURNING id, (xmax = 0) AS is_new`,
      [familyId, brandId, name, slug, description, sku, source_url, thumbnail_url,
       is_primary || false, metadata ? JSON.stringify(metadata) : null]
    );
    return rows[0];
  }

  static async findByFamily(familyId) {
    const { rows } = await pool.query(
      'SELECT * FROM product_variants_v2 WHERE family_id = $1 ORDER BY is_primary DESC, name',
      [familyId]
    );
    return rows;
  }

  static async findById(id) {
    const { rows } = await pool.query(
      `SELECT v.*, pf.name AS family_name, pf.slug AS family_slug, b.name AS brand_name
       FROM product_variants_v2 v
       JOIN product_families pf ON pf.id = v.family_id
       JOIN brands b ON b.id = v.brand_id
       WHERE v.id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  static async findBySlug(familyId, slug) {
    const { rows } = await pool.query(
      'SELECT * FROM product_variants_v2 WHERE family_id = $1 AND slug = $2',
      [familyId, slug]
    );
    return rows[0] || null;
  }
}

module.exports = ProductVariantV2Model;
