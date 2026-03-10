CREATE TABLE IF NOT EXISTS products (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id        INTEGER NOT NULL REFERENCES brands(id),
    name            VARCHAR(500) NOT NULL,
    slug            VARCHAR(500) NOT NULL,
    description     TEXT,
    dimensions      TEXT,
    materials       TEXT,
    weight          VARCHAR(100),
    certifications  TEXT,
    pdf_url         TEXT,
    pdf_text        TEXT,
    image_url       TEXT,
    source_url      TEXT NOT NULL,
    category        VARCHAR(200),
    designer        VARCHAR(300),
    sustainability  TEXT,
    raw_data        JSONB,
    last_scraped_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(brand_id, slug)
);
