const { pool } = require('../config/database');
const { toSql } = require('pgvector/pg');

class EmbeddingModel {
  // ---- Legacy product_embeddings (old products table) ----

  static async upsert(productId, embeddingType, embedding, inputText) {
    await pool.query(
      `INSERT INTO product_embeddings (product_id, embedding_type, embedding, input_text)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id, embedding_type) DO UPDATE SET
         embedding = $3, input_text = $4, created_at = NOW()`,
      [productId, embeddingType, toSql(embedding), inputText]
    );
  }

  static async findByProductId(productId) {
    const { rows } = await pool.query(
      'SELECT id, product_id, embedding_type, input_text, model, created_at FROM product_embeddings WHERE product_id = $1',
      [productId]
    );
    return rows;
  }

  static async searchSimilar(queryEmbedding, { embeddingType = 'product_description', brand, category, limit = 10 }) {
    const conditions = ['pe.embedding_type = $2'];
    const params = [toSql(queryEmbedding), embeddingType];
    let paramIndex = 3;

    if (brand) {
      conditions.push(`b.slug = $${paramIndex++}`);
      params.push(brand);
    }
    if (category) {
      conditions.push(`p.category = $${paramIndex++}`);
      params.push(category);
    }

    params.push(limit);

    const { rows } = await pool.query(
      `SELECT
        p.id, p.name, p.description, p.dimensions, p.materials,
        p.pdf_url, p.image_url, p.source_url, p.category, p.designer,
        p.weight, p.certifications,
        b.name AS brand_name, b.slug AS brand_slug,
        pe.embedding_type,
        1 - (pe.embedding <=> $1) AS similarity
      FROM product_embeddings pe
      JOIN products p ON p.id = pe.product_id
      JOIN brands b ON b.id = p.brand_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY pe.embedding <=> $1 ASC
      LIMIT $${paramIndex}`,
      params
    );
    return rows;
  }

  // ---- New product_family_embeddings ----

  static async upsertFamily(familyId, embeddingType, embedding, inputText) {
    await pool.query(
      `INSERT INTO product_family_embeddings (family_id, embedding_type, embedding, input_text)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (family_id, embedding_type) DO UPDATE SET
         embedding = $3, input_text = $4, created_at = NOW()`,
      [familyId, embeddingType, toSql(embedding), inputText]
    );
  }

  static async findByFamilyId(familyId) {
    const { rows } = await pool.query(
      'SELECT id, family_id, embedding_type, input_text, model, created_at FROM product_family_embeddings WHERE family_id = $1',
      [familyId]
    );
    return rows;
  }

  /**
   * Search product families by vector similarity.
   */
  static async searchFamilies(queryEmbedding, { embeddingType = 'family_description', brand, category, limit = 10 }) {
    const conditions = ['pfe.embedding_type = $2'];
    const params = [toSql(queryEmbedding), embeddingType];
    let paramIndex = 3;

    if (brand) {
      conditions.push(`b.slug = $${paramIndex++}`);
      params.push(brand);
    }
    if (category) {
      conditions.push(`pf.category = $${paramIndex++}`);
      params.push(category);
    }

    params.push(limit);

    const { rows } = await pool.query(
      `SELECT
        pf.id, pf.name, pf.slug, pf.description, pf.category,
        pf.source_url, pf.thumbnail_url, pf.metadata,
        b.name AS brand_name, b.slug AS brand_slug,
        pfe.embedding_type,
        1 - (pfe.embedding <=> $1) AS similarity
      FROM product_family_embeddings pfe
      JOIN product_families pf ON pf.id = pfe.family_id
      JOIN brands b ON b.id = pf.brand_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY pfe.embedding <=> $1 ASC
      LIMIT $${paramIndex}`,
      params
    );
    return rows;
  }
}

module.exports = EmbeddingModel;
