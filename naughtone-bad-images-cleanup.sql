-- NaughtOne bad-images cleanup — Hudson Coatstand, Pullman Desk, Dalby Table
-- (from scripts/cleanup-naughtone-bad-images.js)
-- Run on PROD DB in DBeaver
-- Generated: 2026-08-13

-- 1. Hudson Coatstand — wrong G-HM/G-Asari images
DELETE FROM product_siglip_images
WHERE product_id = (
  SELECT p.id FROM products p JOIN brands b ON b.id = p.brand_id
  WHERE b.slug = 'naughtone' AND p.name = 'Hudson Coatstand'
)
AND (
  image_url LIKE '%G-Asari%'
  OR image_url LIKE '%G-HM_lifestyle%'
  OR image_url LIKE '%G-HM_NurseRespite%'
  OR image_url LIKE '%G-HM_HCS%'
);

-- 2. Pullman Desk / Desk Pod — Pullman Booth images
DELETE FROM product_siglip_images
WHERE product_id = (
  SELECT p.id FROM products p JOIN brands b ON b.id = p.brand_id
  WHERE b.slug = 'naughtone' AND p.name = 'Pullman Desk / Desk Pod'
)
AND (
  image_url LIKE '%pullman_booth_group%'
  OR image_url LIKE '%pullman_booths_library%'
  OR image_url LIKE '%Forbo_lino%'
);

-- 3. Dalby Table — massive multi-product group shot
DELETE FROM product_siglip_images
WHERE product_id = (
  SELECT p.id FROM products p JOIN brands b ON b.id = p.brand_id
  WHERE b.slug = 'naughtone' AND p.name = 'Dalby Table'
)
AND image_url LIKE '%NOTRFA_NOTFRB_ALLOBSL_DAL650DL_HLO2SFBWD%';

-- Verify:
-- SELECT p.name, COUNT(psi.id) as imgs
-- FROM products p JOIN brands b ON b.id=p.brand_id
-- LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
-- WHERE b.slug='naughtone'
--   AND p.name IN ('Hudson Coatstand','Pullman Desk / Desk Pod','Dalby Table','Lotti Chair','Pullman Modular Seating')
-- GROUP BY p.id, p.name ORDER BY p.name;
