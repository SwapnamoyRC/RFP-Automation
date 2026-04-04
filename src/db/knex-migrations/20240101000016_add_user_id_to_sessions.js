exports.up = async function (knex) {
  await knex.raw('ALTER TABLE rfp_sessions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_rfp_sessions_user_id ON rfp_sessions(user_id)');
};

exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_rfp_sessions_user_id');
  await knex.raw('ALTER TABLE rfp_sessions DROP COLUMN IF EXISTS user_id');
};
