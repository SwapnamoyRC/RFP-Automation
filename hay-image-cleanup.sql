-- HAY editorial image cleanup
-- Removes /blocks/brandsite/ images that pollute SigLIP embeddings
-- Generated: 2026-08-11T06:35:06.961Z

DELETE FROM product_siglip_images
WHERE image_url LIKE '%/blocks/brandsite/%';

-- Verify:
-- SELECT COUNT(*) FROM product_siglip_images WHERE image_url LIKE '%/blocks/brandsite/%';
-- Should return 0
