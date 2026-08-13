-- Muuto final cleanup — remaining cross-product contaminations
-- (from scripts/cleanup-muuto-final.js)
-- Run on PROD DB in DBeaver
-- Generated: 2026-08-13

DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%dots ceramic%' AND psi.image_url ILIKE '%dots-metal%';

DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%dots metal%' AND psi.image_url ILIKE '%dots-ceramic%';

DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%rime pendant cluster%' AND psi.image_url ILIKE '%rime-wall-lamp%';

DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%rime wall lamp%' AND psi.image_url ILIKE '%rime-pendant%';

DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%dedicate wall lamp%' AND psi.image_url ILIKE '%dedicate-floor-lamp%';

DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%leaf floor lamp%' AND psi.image_url ILIKE '%leaf%table%';

DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%coltre%2-seater%'
  AND (
    psi.image_url ILIKE '%coltre-4-seater%'
    OR psi.image_url ILIKE '%coltre-6-seater%'
    OR psi.image_url ILIKE '%coltre-7-seater%'
  );

-- Verify:
-- SELECT SUM(CASE WHEN c>=4 THEN 1 ELSE 0 END) good, SUM(CASE WHEN c<4 AND c>0 THEN 1 ELSE 0 END) partial,
--   SUM(CASE WHEN c=0 THEN 1 ELSE 0 END) zero, COUNT(*) total
-- FROM (SELECT p.id, COUNT(psi.id) c FROM products p JOIN brands b ON b.id=p.brand_id
--       LEFT JOIN product_siglip_images psi ON psi.product_id=p.id WHERE b.slug='muuto' GROUP BY p.id) sub;
