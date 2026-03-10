CREATE TABLE IF NOT EXISTS product_embeddings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    embedding_type  VARCHAR(50) NOT NULL DEFAULT 'product_description',
    embedding       vector(1536) NOT NULL,
    input_text      TEXT,
    model           VARCHAR(100) DEFAULT 'text-embedding-3-small',
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(product_id, embedding_type)
);
