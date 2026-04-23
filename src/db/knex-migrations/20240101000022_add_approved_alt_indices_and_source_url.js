exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE rfp_session_items
    ADD COLUMN IF NOT EXISTS approved_alternative_indices JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS product_source_url TEXT DEFAULT NULL
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE rfp_session_items
    DROP COLUMN IF EXISTS approved_alternative_indices,
    DROP COLUMN IF EXISTS product_source_url
  `);
};
