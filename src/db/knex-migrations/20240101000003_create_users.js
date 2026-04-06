exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      role VARCHAR(50) DEFAULT 'user',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
};

exports.down = async function (knex) {
  await knex.raw('DROP TABLE IF EXISTS users CASCADE');
};
