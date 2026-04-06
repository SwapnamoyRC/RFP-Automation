exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS product_families (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      brand_id        INTEGER NOT NULL REFERENCES brands(id),
      name            VARCHAR(200) NOT NULL,
      slug            VARCHAR(200) NOT NULL,
      description     TEXT,
      category        VARCHAR(100),
      source_url      TEXT,
      thumbnail_url   TEXT,
      metadata        JSONB,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(brand_id, slug)
    )
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS product_variants_v2 (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      family_id       UUID NOT NULL REFERENCES product_families(id) ON DELETE CASCADE,
      brand_id        INTEGER NOT NULL REFERENCES brands(id),
      name            VARCHAR(500) NOT NULL,
      slug            VARCHAR(500) NOT NULL,
      description     TEXT,
      sku             VARCHAR(200),
      source_url      TEXT,
      thumbnail_url   TEXT,
      is_primary      BOOLEAN DEFAULT false,
      metadata        JSONB,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(family_id, slug)
    )
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS product_resources (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      family_id       UUID REFERENCES product_families(id) ON DELETE CASCADE,
      variant_id      UUID REFERENCES product_variants_v2(id) ON DELETE CASCADE,
      resource_type   VARCHAR(50) NOT NULL,
      title           VARCHAR(500),
      url             TEXT NOT NULL,
      file_size       VARCHAR(50),
      extracted_text  TEXT,
      metadata        JSONB,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT resource_must_have_parent CHECK (family_id IS NOT NULL OR variant_id IS NOT NULL)
    )
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS product_images (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      family_id       UUID REFERENCES product_families(id) ON DELETE CASCADE,
      variant_id      UUID REFERENCES product_variants_v2(id) ON DELETE CASCADE,
      image_url       TEXT NOT NULL,
      product_id_tag  VARCHAR(500),
      file_size       VARCHAR(50),
      image_type      VARCHAR(50) DEFAULT 'product',
      alt_text        TEXT,
      ai_description  TEXT,
      sort_order      INTEGER DEFAULT 0,
      metadata        JSONB,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT image_must_have_parent CHECK (family_id IS NOT NULL OR variant_id IS NOT NULL)
    )
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS technical_specs (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      family_id       UUID REFERENCES product_families(id) ON DELETE CASCADE,
      variant_id      UUID REFERENCES product_variants_v2(id) ON DELETE CASCADE,
      spec_category   VARCHAR(100),
      spec_name       VARCHAR(200) NOT NULL,
      spec_value      TEXT NOT NULL,
      unit            VARCHAR(50),
      metadata        JSONB,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT spec_must_have_parent CHECK (family_id IS NOT NULL OR variant_id IS NOT NULL)
    )
  `);

  // Indexes
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_product_families_brand ON product_families(brand_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_product_families_slug ON product_families(slug)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_product_families_category ON product_families(category)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_product_variants_v2_family ON product_variants_v2(family_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_product_variants_v2_brand ON product_variants_v2(brand_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_product_variants_v2_slug ON product_variants_v2(slug)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_product_resources_family ON product_resources(family_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_product_resources_variant ON product_resources(variant_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_product_resources_type ON product_resources(resource_type)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_product_images_family ON product_images(family_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_product_images_variant ON product_images(variant_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_product_images_type ON product_images(image_type)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_technical_specs_family ON technical_specs(family_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_technical_specs_variant ON technical_specs(variant_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_technical_specs_category ON technical_specs(spec_category)');
};

exports.down = async function (knex) {
  await knex.raw('DROP TABLE IF EXISTS technical_specs CASCADE');
  await knex.raw('DROP TABLE IF EXISTS product_images CASCADE');
  await knex.raw('DROP TABLE IF EXISTS product_resources CASCADE');
  await knex.raw('DROP TABLE IF EXISTS product_variants_v2 CASCADE');
  await knex.raw('DROP TABLE IF EXISTS product_families CASCADE');
};
