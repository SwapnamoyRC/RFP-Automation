-- Herman Miller cleanup — wrong-product images on Eames Folding Screen
-- (from scripts/cleanup-hm.js)
-- Run on PROD DB in DBeaver
-- Generated: 2026-08-13

SELECT COUNT(*) FROM product_siglip_images psi
JOIN products p ON p.id = psi.product_id
JOIN brands b ON b.id = p.brand_id
WHERE b.slug = 'herman-miller'
  AND p.name ILIKE '%folding screen%'
  AND (psi.image_url ILIKE '%hang_it_all%' OR psi.image_url ILIKE '%girard_environmental%');
-- Preview above, then:

DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'herman-miller'
  AND p.name ILIKE '%folding screen%'
  AND (psi.image_url ILIKE '%hang_it_all%' OR psi.image_url ILIKE '%girard_environmental%');
