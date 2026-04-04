-- =====================================================
-- Migration 011: Product Family Embeddings
-- Vector embeddings for the new product_families schema
-- =====================================================

CREATE TABLE IF NOT EXISTS product_family_embeddings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id       UUID NOT NULL REFERENCES product_families(id) ON DELETE CASCADE,
    embedding_type  VARCHAR(50) NOT NULL DEFAULT 'family_description',
    embedding       vector(1536) NOT NULL,
    input_text      TEXT,
    model           VARCHAR(100) DEFAULT 'text-embedding-3-small',
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(family_id, embedding_type)
);

CREATE INDEX IF NOT EXISTS idx_family_embeddings_family ON product_family_embeddings(family_id);
CREATE INDEX IF NOT EXISTS idx_family_embeddings_type ON product_family_embeddings(embedding_type);
