-- Herman Miller second pass — 4 wrong-product/UI-icon images
-- (from scripts/cleanup-hm-second.js)
-- Run on PROD DB in DBeaver
-- Generated: 2026-08-13

SELECT COUNT(*) FROM product_siglip_images psi
JOIN products p ON p.id = psi.product_id
JOIN brands b ON b.id = p.brand_id
WHERE b.slug = 'herman-miller'
  AND (
    (p.name ILIKE '%aluminum group chairs outdoor%' AND psi.image_url ILIKE '%wire_chairs%')
    OR (p.name ILIKE '%sabha%' AND psi.image_url ILIKE '%eames_molded_plywood_chairs%')
    OR (p.name ILIKE '%tone personal light%' AND psi.image_url ILIKE '%nelson_bubble_lamps%')
    OR (p.name ILIKE '%ello%' AND (
          psi.image_url ILIKE '%find_a_dealer%'
          OR psi.image_url ILIKE '%find_a_showroom%'
          OR psi.image_url ILIKE '%get_help%'
        ))
  );
-- Preview above, then:

DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id AND p.brand_id = b.id AND b.slug = 'herman-miller'
  AND (
    (p.name ILIKE '%aluminum group chairs outdoor%' AND psi.image_url ILIKE '%wire_chairs%')
    OR (p.name ILIKE '%sabha%' AND psi.image_url ILIKE '%eames_molded_plywood_chairs%')
    OR (p.name ILIKE '%tone personal light%' AND psi.image_url ILIKE '%nelson_bubble_lamps%')
    OR (p.name ILIKE '%ello%' AND (
          psi.image_url ILIKE '%find_a_dealer%'
          OR psi.image_url ILIKE '%find_a_showroom%'
          OR psi.image_url ILIKE '%get_help%'
        ))
  );
