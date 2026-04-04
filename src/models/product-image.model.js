const { pool } = require('../config/database');

class ProductImageModel {
  static async insertBatch(images) {
    if (!images || images.length === 0) return { inserted: 0 };

    let inserted = 0;
    // Batch insert in chunks of 100
    for (let i = 0; i < images.length; i += 100) {
      const chunk = images.slice(i, i + 100);
      const values = [];
      const params = [];
      let idx = 1;

      for (const img of chunk) {
        values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
        params.push(
          img.family_id, img.variant_id || null, img.image_url,
          img.product_id_tag || null, img.file_size || null,
          img.image_type || 'product', img.alt_text || null,
          img.metadata ? JSON.stringify(img.metadata) : null
        );
      }

      const { rowCount } = await pool.query(
        `INSERT INTO product_images (family_id, variant_id, image_url, product_id_tag, file_size, image_type, alt_text, metadata)
         VALUES ${values.join(', ')}
         ON CONFLICT DO NOTHING`,
        params
      );
      inserted += rowCount;
    }
    return { inserted };
  }

  static async findByFamily(familyId, { limit = 50, offset = 0 } = {}) {
    const { rows } = await pool.query(
      'SELECT * FROM product_images WHERE family_id = $1 ORDER BY sort_order, created_at LIMIT $2 OFFSET $3',
      [familyId, limit, offset]
    );
    return rows;
  }

  static async findByVariant(variantId, { limit = 50, offset = 0 } = {}) {
    const { rows } = await pool.query(
      'SELECT * FROM product_images WHERE variant_id = $1 ORDER BY sort_order, created_at LIMIT $2 OFFSET $3',
      [variantId, limit, offset]
    );
    return rows;
  }

  static async countByFamily(familyId) {
    const { rows } = await pool.query(
      'SELECT COUNT(*) FROM product_images WHERE family_id = $1',
      [familyId]
    );
    return parseInt(rows[0].count);
  }
}

module.exports = ProductImageModel;
