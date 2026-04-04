-- Add alternatives column to store top 5 candidate matches per item
ALTER TABLE rfp_session_items
  ADD COLUMN IF NOT EXISTS alternatives JSONB DEFAULT '[]';

-- Add selected_alternative index (which alternative the user picked, null = original match)
ALTER TABLE rfp_session_items
  ADD COLUMN IF NOT EXISTS selected_alternative INT DEFAULT NULL;
