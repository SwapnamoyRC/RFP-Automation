const { pool } = require('../config/database');

class ProductModel {
  static async upsert(brandId, productData) {
    const {
      name, slug, description, dimensions, materials, weight,
      certifications, pdf_url, pdf_text, image_url, source_url,
      category, designer, sustainability, raw_data
    } = productData;

    // Truncate VARCHAR fields to prevent overflow
    const safeName = name ? name.substring(0, 500) : name;
    const safeSlug = slug ? slug.substring(0, 500) : slug;
    const safeWeight = weight ? weight.substring(0, 100) : weight;
    const safeCategory = category ? category.substring(0, 200) : category;
    const safeDesigner = designer ? designer.substring(0, 300) : designer;

    const { rows } = await pool.query(
      `INSERT INTO products (
        brand_id, name, slug, description, dimensions, materials, weight,
        certifications, pdf_url, pdf_text, image_url, source_url,
        category, designer, sustainability, raw_data, last_scraped_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
      ON CONFLICT (brand_id, slug) DO UPDATE SET
        name=$2, description=$4, dimensions=$5, materials=$6, weight=$7,
        certifications=$8, pdf_url=$9, pdf_text=$10, image_url=$11,
        source_url=$12, category=$13, designer=$14, sustainability=$15,
        raw_data=$16, last_scraped_at=NOW(), updated_at=NOW()
      RETURNING id, (xmax = 0) AS is_new`,
      [brandId, safeName, safeSlug, description, dimensions, materials, safeWeight,
       certifications, pdf_url, pdf_text, image_url, source_url,
       safeCategory, safeDesigner, sustainability, raw_data ? JSON.stringify(raw_data) : null]
    );
    return rows[0];
  }

  static async findById(id) {
    const { rows } = await pool.query(
      `SELECT p.*, b.name AS brand_name, b.slug AS brand_slug
       FROM products p JOIN brands b ON b.id = p.brand_id
       WHERE p.id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  static async findByBrand(brandId) {
    const { rows } = await pool.query(
      'SELECT * FROM products WHERE brand_id = $1 ORDER BY name',
      [brandId]
    );
    return rows;
  }

  static async findAll({ brand, category, page = 1, limit = 20 }) {
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (brand) {
      conditions.push(`b.slug = $${paramIndex++}`);
      params.push(brand);
    }
    if (category) {
      conditions.push(`p.category = $${paramIndex++}`);
      params.push(category);
    }

    const where = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT p.*, b.name AS brand_name, b.slug AS brand_slug
         FROM products p JOIN brands b ON b.id = p.brand_id
         ${where}
         ORDER BY p.name
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        params
      ),
      pool.query(
        `SELECT COUNT(*) FROM products p JOIN brands b ON b.id = p.brand_id ${where}`,
        params.slice(0, -2)
      )
    ]);

    return {
      products: dataResult.rows,
      total: parseInt(countResult.rows[0].count)
    };
  }

  static async updatePdfData(productId, { pdf_text, pdf_url }) {
    await pool.query(
      `UPDATE products SET pdf_text = $2, pdf_url = $3, updated_at = NOW()
       WHERE id = $1`,
      [productId, pdf_text, pdf_url]
    );
  }
}

module.exports = ProductModel;
