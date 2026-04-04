exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE rfp_session_items
      ADD COLUMN IF NOT EXISTS override_product_url TEXT,
      ADD COLUMN IF NOT EXISTS override_product_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS override_product_brand VARCHAR(100),
      ADD COLUMN IF NOT EXISTS is_overridden BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS override_note TEXT
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS product_submissions (
      id SERIAL PRIMARY KEY,
      submitted_by UUID REFERENCES users(id),
      product_url TEXT NOT NULL,
      product_name VARCHAR(255),
      brand VARCHAR(100),
      category VARCHAR(100),
      description TEXT,
      dimensions TEXT,
      materials TEXT,
      image_url TEXT,
      notes TEXT,
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_product_submissions_status ON product_submissions(status)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_product_submissions_user ON product_submissions(submitted_by)');
};

exports.down = async function (knex) {
  await knex.raw('DROP TABLE IF EXISTS product_submissions CASCADE');
  await knex.raw('ALTER TABLE rfp_session_items DROP COLUMN IF EXISTS override_note');
  await knex.raw('ALTER TABLE rfp_session_items DROP COLUMN IF EXISTS is_overridden');
  await knex.raw('ALTER TABLE rfp_session_items DROP COLUMN IF EXISTS override_product_brand');
  await knex.raw('ALTER TABLE rfp_session_items DROP COLUMN IF EXISTS override_product_name');
  await knex.raw('ALTER TABLE rfp_session_items DROP COLUMN IF EXISTS override_product_url');
};
