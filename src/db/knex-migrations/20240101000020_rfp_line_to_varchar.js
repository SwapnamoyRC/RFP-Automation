exports.up = function (knex) {
  return knex.schema.alterTable('rfp_session_items', (table) => {
    table.string('rfp_line', 20).alter();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('rfp_session_items', (table) => {
    table.integer('rfp_line').alter();
  });
};
