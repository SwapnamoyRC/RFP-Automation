-- Store image/text weight per session (0.0 = full text, 1.0 = full image)
ALTER TABLE rfp_sessions
  ADD COLUMN IF NOT EXISTS image_weight FLOAT DEFAULT 0.7;
