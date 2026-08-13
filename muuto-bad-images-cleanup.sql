-- Muuto contamination cleanup — first pass (16 fixes)
-- (from scripts/cleanup-muuto-bad-images.js)
-- Run on PROD DB in DBeaver
-- Generated: 2026-08-13

-- 1. cas.png tracking pixel / UI element
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND psi.image_url LIKE '%cas.png';

-- 2. Lifestyle/editorial shots (org-copy, Stregtegninger, low-res, lifestyle-image, showroom)
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND (
    psi.image_url LIKE '%-org%25-%25Copy%'
    OR psi.image_url LIKE '%Stregtegninger%'
    OR psi.image_url ILIKE '%-low-res.%'
    OR psi.image_url ILIKE '%lifestyle-image%'
    OR psi.image_url ILIKE '%showroom-2023%'
    OR psi.image_url ILIKE '%-org%20-%20Copy%'
  );

-- 3. Oslo Bar Stool images in Oslo Lounge Chair / Oslo Sofa
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND (p.name ILIKE '%oslo lounge chair%' OR p.name ILIKE '%oslo sofa%')
  AND psi.image_url ILIKE '%oslo-bar-stool%';

-- 4. Linear System furniture images in Linear Lamp products
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND (p.name ILIKE '%linear pendant lamp%' OR p.name ILIKE '%linear table lamp%' OR p.name ILIKE '%linear mounted lamp%')
  AND (
    psi.image_url ILIKE '%linear-system-screen%'
    OR psi.image_url ILIKE '%linear-system-high-table%'
    OR psi.image_url ILIKE '%linear-system-table-oak%'
    OR psi.image_url ILIKE '%linear-system-cable-tray%'
    OR psi.image_url ILIKE '%linear-system-power%'
    OR psi.image_url ILIKE '%linear-system-connecting-legs%'
  );

-- 5. Workshop Chair cross-contamination (Coffee Table / Table 200 / Bench images)
-- NOTE: this exact condition was re-run once more by scripts/fix-workshop-recontam.js after
-- a later re-scrape reintroduced it. Running this DELETE is idempotent (no-op if already clean),
-- so no separate patch file was made for that script — this statement covers both.
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%workshop chair%'
  AND (
    psi.image_url ILIKE '%workshop-coffee-table%'
    OR psi.image_url ILIKE '%workshop-table-200%'
    OR psi.image_url ILIKE '%workshop-bench%'
  );

-- 6. Beam / Gaze cross-contamination
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%workshop bench%'
  AND psi.image_url ILIKE '%beam-wall-lamp%';

DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%gaze mirror%'
  AND (
    psi.image_url ILIKE '%beam-table-lamp%'
    OR psi.image_url ILIKE '%rest-sofa%'
    OR psi.image_url ILIKE '%outline-sofa%'
  );

-- 7. Coltre lifestyle shot in Cluster Canopy / Verso Rug
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND (p.name ILIKE '%cluster canopy%' OR p.name ILIKE '%verso rug%')
  AND psi.image_url ILIKE '%coltre-center%';

-- 8. Base High Table lifestyle in Sketch Toolbox
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%sketch toolbox%'
  AND psi.image_url ILIKE '%base-high%';

-- 9. Calm Wall Lamp lifestyle in Outline Daybed
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%outline daybed%'
  AND psi.image_url ILIKE '%calm-wall-lamp%';

-- 11. Oslo showroom shots in Fiber Soft Armchair
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%fiber soft armchair%'
  AND psi.image_url ILIKE '%oslo-showroom%';

-- 12. Editorial/concept-page embeddings (not real products)
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name IN ('Modern lines', 'Warm materiality', 'A modern light');

-- 13. Ambit Pendant Cluster image in Rail Lamp / Wall Lamp
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND (p.name ILIKE '%ambit rail lamp%' OR p.name ILIKE '%ambit wall lamp%')
  AND (
    psi.image_url ILIKE '%ambit-%C3%B840%'
    OR psi.image_url ILIKE '%Ambit_rail_black%'
  );

-- 14. Fine Suspension Lamp image in Fine Wall/Ceiling Lamp
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND p.name ILIKE '%fine wall%'
  AND psi.image_url ILIKE '%fine-suspension-lamp%';

-- 15. Dedicate Table Lamp image in Dedicate Floor/Wall Lamp
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND (p.name ILIKE '%dedicate floor lamp%' OR p.name ILIKE '%dedicate wall lamp%')
  AND psi.image_url ILIKE '%dedicate-table-lamp%';

-- 16. Linear Lamp images in Linear System accessories (Tray/Screen/Power/Cable Tray)
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'muuto'
  AND (
    p.name ILIKE '%linear system tray%'
    OR p.name ILIKE '%linear system screen%'
    OR p.name ILIKE '%linear system power%'
    OR p.name ILIKE '%linear system cable tray%'
  )
  AND (
    psi.image_url ILIKE '%linear-pendant-lamp%'
    OR psi.image_url ILIKE '%linear-table-lamp%'
    OR psi.image_url ILIKE '%linear-mounted-lamp%'
  );

-- Verify:
-- SELECT COUNT(*) AS total, SUM(CASE WHEN c=0 THEN 1 ELSE 0 END) zero,
--   SUM(CASE WHEN c BETWEEN 1 AND 3 THEN 1 ELSE 0 END) partial, SUM(CASE WHEN c>=4 THEN 1 ELSE 0 END) good
-- FROM (SELECT p.id, COUNT(psi.id) c FROM products p JOIN brands b ON b.id=p.brand_id
--       LEFT JOIN product_siglip_images psi ON psi.product_id=p.id WHERE b.slug='muuto' GROUP BY p.id) sub;
