-- Muuto lifestyle/editorial image cleanup
-- Removes org_ in-situ shots from product_siglip_images
-- These are room/lifestyle scenes that degrade visual search accuracy
-- Clean hi-res product shots (5000x5000-hi-res, angle_1-4) are kept
-- Generated: 2026-08-11

DELETE FROM product_siglip_images
WHERE product_id IN (
  SELECT p.id FROM products p
  JOIN brands b ON b.id = p.brand_id
  WHERE b.slug = 'muuto'
)
AND (
  image_url LIKE '%-org\_%' ESCAPE '\'
  OR image_url LIKE '%\_org\_%' ESCAPE '\'
  OR image_url LIKE '%in-situ%'
);

-- Verify:
-- SELECT COUNT(*) FROM product_siglip_images
-- WHERE product_id IN (SELECT p.id FROM products p JOIN brands b ON b.id=p.brand_id WHERE b.slug='muuto')
-- AND (image_url LIKE '%-org_%' OR image_url LIKE '%_org_%' OR image_url LIKE '%in-situ%');
-- Should return 0
