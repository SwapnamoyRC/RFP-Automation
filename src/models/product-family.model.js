const { pool } = require('../config/database');

class ProductFamilyModel {
  static async upsert(brandId, data) {
    const { name, slug, description, category, source_url, thumbnail_url, metadata } = data;

    const { rows } = await pool.query(
      `INSERT INTO product_families (brand_id, name, slug, description, category, source_url, thumbnail_url, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (brand_id, slug) DO UPDATE SET
         name = $2, description = $4, category = $5, source_url = $6,
         thumbnail_url = $7, metadata = $8, updated_at = NOW()
       RETURNING id, (xmax = 0) AS is_new`,
      [brandId, name, slug, description, category, source_url, thumbnail_url,
       metadata ? JSON.stringify(metadata) : null]
    );
    return rows[0];
  }

  static async findById(id) {
    const { rows } = await pool.query(
      `SELECT pf.*, b.name AS brand_name, b.slug AS brand_slug
       FROM product_families pf JOIN brands b ON b.id = pf.brand_id
       WHERE pf.id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  static async findByBrand(brandId) {
    const { rows } = await pool.query(
      'SELECT * FROM product_families WHERE brand_id = $1 ORDER BY name',
      [brandId]
    );
    return rows;
  }

  static async findBySlug(brandId, slug) {
    const { rows } = await pool.query(
      'SELECT * FROM product_families WHERE brand_id = $1 AND slug = $2',
      [brandId, slug]
    );
    return rows[0] || null;
  }

  static async findAll({ brand, category, page = 1, limit = 20 }) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (brand) { conditions.push(`b.slug = $${idx++}`); params.push(brand); }
    if (category) { conditions.push(`pf.category = $${idx++}`); params.push(category); }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT pf.*, b.name AS brand_name, b.slug AS brand_slug
         FROM product_families pf JOIN brands b ON b.id = pf.brand_id
         ${where} ORDER BY pf.name LIMIT $${idx} OFFSET $${idx + 1}`,
        params
      ),
      pool.query(
        `SELECT COUNT(*) FROM product_families pf JOIN brands b ON b.id = pf.brand_id ${where}`,
        params.slice(0, -2)
      )
    ]);

    return { families: dataResult.rows, total: parseInt(countResult.rows[0].count) };
  }
}

module.exports = ProductFamilyModel;
