-- Muuto third-pass cleanup — fixes re-introduced by second re-scrape
-- Issue: lifestyle filter missed the "org - Copy" (decoded spaces) pattern.
-- (from scripts/cleanup-muuto-third.js)
-- Run on PROD DB in DBeaver
-- Generated: 2026-08-13

-- 1. All remaining org-copy lifestyle images (decoded/encoded space variants)
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND (
    psi.image_url ILIKE '%org%20-%20Copy%'
    OR psi.image_url ILIKE '%org - Copy%'
    OR psi.image_url ILIKE '%org%20%25%25%20Copy%'
  );

-- 2. Linear System furniture images in Linear Table/Mounted/Pendant Lamp
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND (
    p.name ILIKE '%linear table lamp%'
    OR p.name ILIKE '%linear mounted lamp%'
    OR p.name ILIKE '%linear pendant lamp%'
  )
  AND psi.image_url ILIKE '%linear-system%';

-- Verify:
-- SELECT COUNT(*) AS total, SUM(CASE WHEN img_count=0 THEN 1 ELSE 0 END) zero,
--   SUM(CASE WHEN img_count BETWEEN 1 AND 3 THEN 1 ELSE 0 END) partial,
--   SUM(CASE WHEN img_count>=4 THEN 1 ELSE 0 END) good
-- FROM (SELECT p.id, COUNT(psi.id) img_count FROM products p JOIN brands b ON b.id=p.brand_id
--       LEFT JOIN product_siglip_images psi ON psi.product_id=p.id WHERE b.slug='muuto' GROUP BY p.id) sub;
