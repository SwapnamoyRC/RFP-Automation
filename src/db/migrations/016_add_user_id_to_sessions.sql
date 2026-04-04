-- Already handled in 008_create_rfp_sessions.sql
-- This migration is a no-op for fresh installs.
-- For existing installs, ensure user_id column exists.
ALTER TABLE rfp_sessions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_rfp_sessions_user_id ON rfp_sessions (user_id);
