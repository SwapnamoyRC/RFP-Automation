exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE rfp_session_items
    ADD COLUMN IF NOT EXISTS override_product_image_url TEXT
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE rfp_session_items
    DROP COLUMN IF EXISTS override_product_image_url
  `);
};
