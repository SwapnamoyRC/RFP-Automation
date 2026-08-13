-- NaughtOne contamination cleanup — wrong-product images confirmed by filename analysis
-- (from scripts/cleanup-naughtone.js)
-- Run on PROD DB in DBeaver
-- Generated: 2026-08-13

-- 1. Truffle images on Pippin Chair
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'naughtone'
  AND p.name ILIKE '%pippin%' AND psi.image_url ILIKE '%NTO_TUF_%';

-- 2. Viv-wood material images on Ruby Wood Chair / Barstool
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'naughtone'
  AND p.name ILIKE '%ruby wood%'
  AND (psi.image_url ILIKE '%viv-wood%' OR psi.image_url ILIKE '%VIVBSWD%');

-- 3. Viv-wood material images on Polly Wood Chair / Barstool
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'naughtone'
  AND p.name ILIKE '%polly wood%' AND psi.image_url ILIKE '%viv-wood%';

-- 4. Sofa-copy image on Pullman Desk
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'naughtone'
  AND p.name ILIKE '%pullman desk%' AND psi.image_url ILIKE '%sofa%';

-- 5. Copy lifestyle images on Rhyme Modular Seating
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'naughtone'
  AND p.name ILIKE '%rhyme%' AND psi.image_url ILIKE '%-copy%';

-- Verify:
-- SELECT COUNT(*) total, SUM(CASE WHEN c=0 THEN 1 ELSE 0 END) zero,
--   SUM(CASE WHEN c BETWEEN 1 AND 3 THEN 1 ELSE 0 END) partial, SUM(CASE WHEN c>=4 THEN 1 ELSE 0 END) good
-- FROM (SELECT p.id, COUNT(psi.id) c FROM products p JOIN brands b ON b.id=p.brand_id
--       LEFT JOIN product_siglip_images psi ON psi.product_id=p.id WHERE b.slug='naughtone' GROUP BY p.id) sub;
