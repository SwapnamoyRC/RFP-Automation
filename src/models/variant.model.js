const { pool } = require('../config/database');

class VariantModel {
  static async upsertBatch(productId, variants) {
    if (!variants || variants.length === 0) return;

    for (const v of variants) {
      await pool.query(
        `INSERT INTO product_variants (
          product_id, sku, variant_name, color, material, finish,
          dimensions, weight, image_url, additional_data
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (product_id, sku) DO UPDATE SET
          variant_name=$3, color=$4, material=$5, finish=$6,
          dimensions=$7, weight=$8, image_url=$9, additional_data=$10`,
        [
          productId,
          (v.sku || `${productId}-${v.variant_name || 'default'}`).substring(0, 200),
          v.variant_name ? v.variant_name.substring(0, 500) : v.variant_name,
          v.color ? v.color.substring(0, 200) : v.color,
          v.material ? v.material.substring(0, 200) : v.material,
          v.finish ? v.finish.substring(0, 200) : v.finish,
          v.dimensions, v.weight ? v.weight.substring(0, 100) : v.weight,
          v.image_url,
          v.additional_data ? JSON.stringify(v.additional_data) : null
        ]
      );
    }
  }

  static async findByProductId(productId) {
    const { rows } = await pool.query(
      'SELECT * FROM product_variants WHERE product_id = $1 ORDER BY variant_name',
      [productId]
    );
    return rows;
  }

  static async deleteByProductId(productId) {
    await pool.query(
      'DELETE FROM product_variants WHERE product_id = $1',
      [productId]
    );
  }
}

module.exports = VariantModel;
