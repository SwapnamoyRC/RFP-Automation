exports.up = async function (knex) {
  await knex.raw('ALTER TABLE products ADD COLUMN IF NOT EXISTS image_description TEXT');
};

exports.down = async function (knex) {
  await knex.raw('ALTER TABLE products DROP COLUMN IF EXISTS image_description');
};
