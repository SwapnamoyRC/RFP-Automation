-- Muuto second-pass contamination cleanup — fixes re-introduced by Cylindo re-scrape
-- (from scripts/cleanup-muuto-second.js)
-- Run on PROD DB in DBeaver
-- Generated: 2026-08-13

-- 1. Gaze Mirror — org-copy lifestyle images
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%gaze mirror%' AND psi.image_url ILIKE '%-org%20-%20Copy%';

-- 2. Fine Wall/Ceiling Lamp — lifestyle + fine-suspension-lamp images
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%fine wall%'
  AND (
    psi.image_url ILIKE '%-org%20-%20Copy%'
    OR psi.image_url ILIKE '%fine-suspension-lamp%'
    OR psi.image_url ILIKE '%stacked-seat-cushion%'
  );

-- 3. Oslo Lounge Chair — Oslo Bench image
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%oslo lounge chair%' AND psi.image_url ILIKE '%oslo-bench%';

-- 4. Ambit cross-contamination
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND (p.name ILIKE '%ambit rail lamp%' OR p.name ILIKE '%ambit pendant cluster%')
  AND psi.image_url ILIKE '%ambit-wall-lamp-grey%';

DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%ambit rail lamp%' AND psi.image_url ILIKE '%ambit-%C3%B840%';

DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%ambit pendant cluster%' AND psi.image_url ILIKE '%ambit_rail_black%';

-- 5. Outline Highback Sofa 100/120 1-Seater — 3-seater divina detail image
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND (p.name ILIKE '%outline highback sofa 100 1-seater%' OR p.name ILIKE '%outline highback sofa 120 1-seater%')
  AND psi.image_url ILIKE '%outline-high-back-3-seater-divina%';

-- 6. In Situ 3/4-Seater + Corner — 2-seater config-1 image
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND (
    p.name ILIKE '%in situ modular sofa 3-seater%'
    OR p.name ILIKE '%in situ modular sofa 4-seater%'
    OR p.name ILIKE '%in situ modular sofa corner%'
  )
  AND psi.image_url ILIKE '%in-situ-sofa-2-seater-config-1%';

-- 7. Strand Pendant Lamp — strand-table-lamp image
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%strand pendant lamp%' AND psi.image_url ILIKE '%strand-table-lamp%';

-- 8. Beam Table + Portable Lamp — beam-wall-lamp images
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND (p.name ILIKE '%beam table lamp%' OR p.name ILIKE '%beam portable lamp%')
  AND psi.image_url ILIKE '%beam-wall-lamp%';

-- 9. Rest Sofa 3-Seater — rest-corner-sofa image
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%rest sofa 3-seater%' AND psi.image_url ILIKE '%rest-corner-sofa%';

-- 10. Corky Carafe — glasses image
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%corky carafe%' AND psi.image_url ILIKE '%corky%glass%';

-- 11. Cluster Canopy + Rime Pendant Cluster — coltre-center lifestyle (re-added)
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND (p.name ILIKE '%cluster canopy%' OR p.name ILIKE '%rime pendant cluster%')
  AND psi.image_url ILIKE '%coltre-center%';

-- 12. Linear Mounted + Table Lamp — linear-pendant-lamp image
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND (p.name ILIKE '%linear mounted lamp%' OR p.name ILIKE '%linear table lamp%')
  AND psi.image_url ILIKE '%linear-pendant-lamp%';

-- 13. Linear Pendant Lamp — linear-mounted-lamp image (cross-type)
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%linear pendant lamp%' AND psi.image_url ILIKE '%linear-mounted-lamp%';

-- 14. Tip Floor Lamp / Tip Wall Lamp cross-contamination
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%tip floor lamp%' AND psi.image_url ILIKE '%tip-wall-lamp%';

DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%tip wall lamp%' AND psi.image_url ILIKE '%tip-floor-lamp%';

-- Verify:
-- SELECT COUNT(*) AS total, SUM(CASE WHEN img_count=0 THEN 1 ELSE 0 END) zero,
--   SUM(CASE WHEN img_count BETWEEN 1 AND 3 THEN 1 ELSE 0 END) partial,
--   SUM(CASE WHEN img_count>=4 THEN 1 ELSE 0 END) good
-- FROM (SELECT p.id, COUNT(psi.id) img_count FROM products p JOIN brands b ON b.id=p.brand_id
--       LEFT JOIN product_siglip_images psi ON psi.product_id=p.id WHERE b.slug='muuto' GROUP BY p.id) sub;
