exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS rfp_sessions (
      id SERIAL PRIMARY KEY,
      client_name VARCHAR(255),
      threshold FLOAT DEFAULT 0.55,
      file_name VARCHAR(255),
      status VARCHAR(50) DEFAULT 'awaiting_file',
      total_items INT DEFAULT 0,
      approved_count INT DEFAULT 0,
      rejected_count INT DEFAULT 0,
      pptx_drive_url TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
      file_base64 TEXT,
      user_id UUID REFERENCES users(id),
      started_at TIMESTAMP DEFAULT NOW(),
      completed_at TIMESTAMP DEFAULT NOW(),
      processing_time_ms BIGINT,
      image_weight DOUBLE PRECISION
    ) 
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS rfp_session_items (
      id SERIAL PRIMARY KEY,
      session_id INT NOT NULL REFERENCES rfp_sessions(id) ON DELETE CASCADE,
      item_index INT NOT NULL,
      rfp_line INT,
      query VARCHAR(500),
      description TEXT,
      quantity INT,
      location VARCHAR(255),
      image_description TEXT,
      match_source VARCHAR(50),
      confidence FLOAT DEFAULT 0,
      product_name VARCHAR(255),
      product_brand VARCHAR(100),
      product_image_url TEXT,
      product_specs TEXT,
      rfp_image_base64 TEXT,
      review_status VARCHAR(20) DEFAULT 'pending',
      telegram_message_id BIGINT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_rfp_sessions_user_id ON rfp_sessions(user_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_rfp_sessions_status ON rfp_sessions(status)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_rfp_session_items_session ON rfp_session_items(session_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_rfp_session_items_review ON rfp_session_items(session_id, review_status)');
};

exports.down = async function (knex) {
  await knex.raw('DROP TABLE IF EXISTS rfp_session_items CASCADE');
  await knex.raw('DROP TABLE IF EXISTS rfp_sessions CASCADE');
};
