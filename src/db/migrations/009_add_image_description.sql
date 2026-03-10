-- Add image_description column to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_description TEXT;
