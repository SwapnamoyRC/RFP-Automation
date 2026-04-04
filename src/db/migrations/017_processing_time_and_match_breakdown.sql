-- Add processing time tracking to rfp_sessions
ALTER TABLE rfp_sessions
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS processing_time_ms BIGINT;

-- Add match breakdown (structured tick/cross points) to rfp_session_items
ALTER TABLE rfp_session_items
  ADD COLUMN IF NOT EXISTS matched_points JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS mismatched_points JSONB DEFAULT '[]';
