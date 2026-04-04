-- RFP Sessions: tracks each RFP processing session per user
CREATE TABLE IF NOT EXISTS rfp_sessions (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  client_name VARCHAR(255),
  threshold FLOAT DEFAULT 0.55,
  file_name VARCHAR(255),
  file_base64 TEXT,
  status VARCHAR(50) DEFAULT 'awaiting_file',
  -- Status flow: awaiting_file → processing → reviewing → generating → completed
  total_items INT DEFAULT 0,
  approved_count INT DEFAULT 0,
  rejected_count INT DEFAULT 0,
  pptx_drive_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- RFP Session Items: individual product matches within a session
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
  -- Review status: pending → approved / rejected
  telegram_message_id BIGINT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rfp_sessions_user_id ON rfp_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_rfp_sessions_status ON rfp_sessions(status);
CREATE INDEX IF NOT EXISTS idx_rfp_session_items_session ON rfp_session_items(session_id);
CREATE INDEX IF NOT EXISTS idx_rfp_session_items_review ON rfp_session_items(session_id, review_status);
