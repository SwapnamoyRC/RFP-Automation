exports.up = async function (knex) {
  await knex.raw("ALTER TABLE rfp_session_items ADD COLUMN IF NOT EXISTS alternatives JSONB DEFAULT '[]'");
  await knex.raw('ALTER TABLE rfp_session_items ADD COLUMN IF NOT EXISTS selected_alternative INT DEFAULT NULL');
};

exports.down = async function (knex) {
  await knex.raw('ALTER TABLE rfp_session_items DROP COLUMN IF EXISTS selected_alternative');
  await knex.raw('ALTER TABLE rfp_session_items DROP COLUMN IF EXISTS alternatives');
};
