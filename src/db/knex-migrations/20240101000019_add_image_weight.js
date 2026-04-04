exports.up = async function (knex) {
  await knex.raw('ALTER TABLE rfp_sessions ADD COLUMN IF NOT EXISTS image_weight FLOAT DEFAULT 0.7');
};

exports.down = async function (knex) {
  await knex.raw('ALTER TABLE rfp_sessions DROP COLUMN IF EXISTS image_weight');
};
