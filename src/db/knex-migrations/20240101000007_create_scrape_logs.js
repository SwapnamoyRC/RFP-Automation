exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS scrape_logs (
      id              SERIAL PRIMARY KEY,
      brand_id        INTEGER REFERENCES brands(id),
      status          VARCHAR(20) NOT NULL DEFAULT 'running',
      products_found  INTEGER DEFAULT 0,
      products_new    INTEGER DEFAULT 0,
      products_updated INTEGER DEFAULT 0,
      errors          JSONB DEFAULT '[]'::jsonb,
      started_at      TIMESTAMPTZ DEFAULT NOW(),
      completed_at    TIMESTAMPTZ,
      duration_ms     INTEGER,
      triggered_by    VARCHAR(50) DEFAULT 'manual'
    )
  `);
};

exports.down = async function (knex) {
  await knex.raw('DROP TABLE IF EXISTS scrape_logs CASCADE');
};
