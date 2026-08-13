-- NaughtOne wide landscape image cleanup
-- Removes 1920x980 shots that are bad for visual search (room/group lifestyle scenes)
-- These have near-zero product match accuracy vs clean variant shots
-- Generated: 2026-08-11

DELETE FROM product_siglip_images
WHERE image_url LIKE '%naughtone%'
  AND image_url LIKE '%1920x%';

-- Verify:
-- SELECT COUNT(*) FROM product_siglip_images WHERE image_url LIKE '%naughtone%' AND image_url LIKE '%1920x%';
-- Should return 0
