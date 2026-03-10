CREATE TABLE IF NOT EXISTS product_variants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sku             VARCHAR(200),
    variant_name    VARCHAR(500),
    color           VARCHAR(200),
    material        VARCHAR(200),
    finish          VARCHAR(200),
    dimensions      TEXT,
    weight          VARCHAR(100),
    image_url       TEXT,
    additional_data JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(product_id, sku)
);
