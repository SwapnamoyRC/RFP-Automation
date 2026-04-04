const { pool } = require('../config/database');

class TechnicalSpecModel {
  static async insertBatch(specs) {
    if (!specs || specs.length === 0) return { inserted: 0 };

    let inserted = 0;
    for (const spec of specs) {
      const { rows } = await pool.query(
        `INSERT INTO technical_specs (family_id, variant_id, spec_category, spec_name, spec_value, unit, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [spec.family_id, spec.variant_id || null, spec.spec_category,
         spec.spec_name, spec.spec_value, spec.unit || null,
         spec.metadata ? JSON.stringify(spec.metadata) : null]
      );
      if (rows.length) inserted++;
    }
    return { inserted };
  }

  static async findByFamily(familyId) {
    const { rows } = await pool.query(
      'SELECT * FROM technical_specs WHERE family_id = $1 ORDER BY spec_category, spec_name',
      [familyId]
    );
    return rows;
  }

  static async findByVariant(variantId) {
    const { rows } = await pool.query(
      'SELECT * FROM technical_specs WHERE variant_id = $1 ORDER BY spec_category, spec_name',
      [variantId]
    );
    return rows;
  }

  static async deleteByFamily(familyId) {
    await pool.query('DELETE FROM technical_specs WHERE family_id = $1', [familyId]);
  }
}

module.exports = TechnicalSpecModel;
