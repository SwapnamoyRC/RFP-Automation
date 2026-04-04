exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS brands (
      id              SERIAL PRIMARY KEY,
      name            VARCHAR(100) NOT NULL UNIQUE,
      slug            VARCHAR(100) NOT NULL UNIQUE,
      base_url        TEXT NOT NULL,
      scraper_type    VARCHAR(50) NOT NULL,
      is_active       BOOLEAN DEFAULT true,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.down = async function (knex) {
  await knex.raw('DROP TABLE IF EXISTS brands CASCADE');
};
