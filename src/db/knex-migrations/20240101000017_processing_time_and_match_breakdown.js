exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE rfp_sessions
      ADD COLUMN IF NOT EXISTS started_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS processing_time_ms BIGINT
  `);

  await knex.raw(`
    ALTER TABLE rfp_session_items
      ADD COLUMN IF NOT EXISTS matched_points JSONB DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS mismatched_points JSONB DEFAULT '[]'
  `);
};

exports.down = async function (knex) {
  await knex.raw('ALTER TABLE rfp_session_items DROP COLUMN IF EXISTS mismatched_points');
  await knex.raw('ALTER TABLE rfp_session_items DROP COLUMN IF EXISTS matched_points');
  await knex.raw('ALTER TABLE rfp_sessions DROP COLUMN IF EXISTS processing_time_ms');
  await knex.raw('ALTER TABLE rfp_sessions DROP COLUMN IF EXISTS completed_at');
  await knex.raw('ALTER TABLE rfp_sessions DROP COLUMN IF EXISTS started_at');
};
