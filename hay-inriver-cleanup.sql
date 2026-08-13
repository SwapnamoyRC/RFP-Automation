-- ============================================================
-- HAY Inriver cross-product contamination cleanup
-- Run on PROD DB in DBeaver
-- Deletes 5 specific wrong product images that were
-- embedded into hundreds of HAY products by the first
-- (broken) network-interception scraper run.
-- ============================================================

-- Preview count first (run this first to verify):
SELECT
  SUM(CASE WHEN psi.image_url LIKE '%tin-container_910x1100%'
            AND LOWER(p.name) NOT LIKE '%tin container%' THEN 1 ELSE 0 END) AS tin_container,
  SUM(CASE WHEN psi.image_url LIKE '%bella_910x1100_brandmodel%'
            AND LOWER(p.name) NOT LIKE '%bella%' THEN 1 ELSE 0 END) AS bella,
  SUM(CASE WHEN psi.image_url LIKE '%cph-90-desk_910x1100%'
            AND LOWER(p.name) NOT LIKE '%cph 90%' THEN 1 ELSE 0 END) AS cph90desk,
  SUM(CASE WHEN psi.image_url LIKE '%terrazza-parasol_910x1100%'
            AND LOWER(p.name) NOT LIKE '%terrazza%' THEN 1 ELSE 0 END) AS terrazza,
  SUM(CASE WHEN psi.image_url LIKE '%arcs-salt--pepper-grinder_910x1100%'
            AND LOWER(p.name) NOT LIKE '%arcs%' THEN 1 ELSE 0 END) AS arcs_salt,
  SUM(CASE WHEN psi.image_url LIKE '%aal-87-soft_910x1100%'
            AND p.name != 'AAL 87 Soft' THEN 1 ELSE 0 END) AS aal87soft_wrong,
  COUNT(*) AS total_to_delete
FROM product_siglip_images psi
JOIN products p ON p.id = psi.product_id
JOIN brands b ON b.id = p.brand_id
WHERE b.slug = 'hay'
AND (
  (psi.image_url LIKE '%tin-container_910x1100%' AND LOWER(p.name) NOT LIKE '%tin container%')
  OR (psi.image_url LIKE '%bella_910x1100_brandmodel%' AND LOWER(p.name) NOT LIKE '%bella%')
  OR (psi.image_url LIKE '%cph-90-desk_910x1100%' AND LOWER(p.name) NOT LIKE '%cph 90%')
  OR (psi.image_url LIKE '%terrazza-parasol_910x1100%' AND LOWER(p.name) NOT LIKE '%terrazza%')
  OR (psi.image_url LIKE '%arcs-salt--pepper-grinder_910x1100%' AND LOWER(p.name) NOT LIKE '%arcs%')
  OR (psi.image_url LIKE '%aal-87-soft_910x1100%' AND p.name != 'AAL 87 Soft')
);

-- ============================================================
-- EXECUTE DELETE (run after verifying count above looks right)
-- ============================================================
DELETE FROM product_siglip_images psi
USING products p, brands b
WHERE psi.product_id = p.id
  AND p.brand_id = b.id
  AND b.slug = 'hay'
  AND (
    (psi.image_url LIKE '%tin-container_910x1100%' AND LOWER(p.name) NOT LIKE '%tin container%')
    OR (psi.image_url LIKE '%bella_910x1100_brandmodel%' AND LOWER(p.name) NOT LIKE '%bella%')
    OR (psi.image_url LIKE '%cph-90-desk_910x1100%' AND LOWER(p.name) NOT LIKE '%cph 90%')
    OR (psi.image_url LIKE '%terrazza-parasol_910x1100%' AND LOWER(p.name) NOT LIKE '%terrazza%')
    OR (psi.image_url LIKE '%arcs-salt--pepper-grinder_910x1100%' AND LOWER(p.name) NOT LIKE '%arcs%')
    OR (psi.image_url LIKE '%aal-87-soft_910x1100%' AND p.name != 'AAL 87 Soft')
  );
-- Expected: ~807 rows deleted (similar to dev)
