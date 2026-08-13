-- HAY remaining contamination cleanup (from scripts/cleanup-hay-remaining.js)
-- Run on PROD DB in DBeaver
-- Generated: 2026-08-13

-- ============================================================
-- 1. Terrazza sub-products carrying the Terrazza Parasol image
--    (previous cleanup excluded ALL 'terrazza'-named products;
--     should only keep the parasol image for 'Terrazza Parasol' itself)
-- ============================================================
SELECT p.name, psi.image_url
FROM product_siglip_images psi
JOIN products p ON p.id = psi.product_id
JOIN brands b ON b.id = p.brand_id
WHERE b.slug = 'hay'
  AND psi.image_url LIKE '%terrazza-parasol_910x1100_brandmodel%'
  AND p.name != 'Terrazza Parasol';
-- Preview above, then:

DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'hay'
  AND psi.image_url LIKE '%terrazza-parasol_910x1100_brandmodel%'
  AND p.name != 'Terrazza Parasol';

-- ============================================================
-- 2. AAL family soft/non-soft cross-contamination
--    (AAL 81/82/83/91/93 having their "Soft" sibling's image, or vice versa)
-- ============================================================
SELECT p.name AS product, split_part(psi.image_url, '?', 1) AS image_url
FROM product_siglip_images psi
JOIN products p ON p.id = psi.product_id
JOIN brands b ON b.id = p.brand_id
WHERE b.slug = 'hay'
  AND p.name ~ '^AAL \d'
  AND (
    (p.name = 'AAL 82' AND psi.image_url LIKE '%aal-82-soft%')
    OR (p.name = 'AAL 82 Soft' AND psi.image_url LIKE '%aal-82%' AND psi.image_url NOT LIKE '%aal-82-soft%')
    OR (p.name = 'AAL 81' AND psi.image_url LIKE '%aal-81-soft%')
    OR (p.name = 'AAL 81 Soft' AND psi.image_url LIKE '%aal-81[_-]%' AND psi.image_url NOT LIKE '%aal-81-soft%')
    OR (p.name = 'AAL 83' AND psi.image_url LIKE '%aal-83-soft%')
    OR (p.name = 'AAL 83 Soft' AND psi.image_url LIKE '%aal-83[_-]%' AND psi.image_url NOT LIKE '%aal-83-soft%')
    OR (p.name = 'AAL 91' AND psi.image_url LIKE '%aal-91-soft%')
    OR (p.name = 'AAL 91 Soft' AND psi.image_url LIKE '%aal-91[_-]%' AND psi.image_url NOT LIKE '%aal-91-soft%')
    OR (p.name = 'AAL 93' AND psi.image_url LIKE '%aal-93-soft%')
    OR (p.name = 'AAL 93 Soft' AND psi.image_url LIKE '%aal-93[_-]%' AND psi.image_url NOT LIKE '%aal-93-soft%')
  );
-- Preview above, then:

DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'hay'
  AND p.name ~ '^AAL \d'
  AND (
    (p.name = 'AAL 82' AND psi.image_url LIKE '%aal-82-soft%')
    OR (p.name = 'AAL 82 Soft' AND psi.image_url LIKE '%aal-82%' AND psi.image_url NOT LIKE '%aal-82-soft%')
    OR (p.name = 'AAL 81' AND psi.image_url LIKE '%aal-81-soft%')
    OR (p.name = 'AAL 81 Soft' AND psi.image_url LIKE '%aal-81[_-]%' AND psi.image_url NOT LIKE '%aal-81-soft%')
    OR (p.name = 'AAL 83' AND psi.image_url LIKE '%aal-83-soft%')
    OR (p.name = 'AAL 83 Soft' AND psi.image_url LIKE '%aal-83[_-]%' AND psi.image_url NOT LIKE '%aal-83-soft%')
    OR (p.name = 'AAL 91' AND psi.image_url LIKE '%aal-91-soft%')
    OR (p.name = 'AAL 91 Soft' AND psi.image_url LIKE '%aal-91[_-]%' AND psi.image_url NOT LIKE '%aal-91-soft%')
    OR (p.name = 'AAL 93' AND psi.image_url LIKE '%aal-93-soft%')
    OR (p.name = 'AAL 93 Soft' AND psi.image_url LIKE '%aal-93[_-]%' AND psi.image_url NOT LIKE '%aal-93-soft%')
  );
