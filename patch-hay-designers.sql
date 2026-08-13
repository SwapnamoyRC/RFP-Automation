-- HAY designer patch — extracted from product descriptions for the 27 new HAY products
-- scraped Aug 2026 (scripts/scrape-hay-new-products.js). Values pulled live from dev DB
-- on 2026-08-13 (scripts/patch-hay-designers.js used a NOW()-INTERVAL time window and
-- regex extraction, neither of which is portable as static SQL, so this reflects the
-- actual resulting values rather than re-deriving the logic).
--
-- 7 of the 27 products (the "Mags Soft ... with removable cover" variants) had no
-- extractable designer in their description and are intentionally omitted below.
-- backflip-wall-bracket / mimi-cushion / mimi-ottoman are omitted here — already
-- covered by patch-hay-accessory-designers.sql with the same values.
--
-- Run on PROD DB in DBeaver
-- Generated: 2026-08-13

UPDATE products SET designer='Jasper Morrison',     updated_at=NOW() WHERE slug='pack-chair-10';
UPDATE products SET designer='Jasper Morrison',     updated_at=NOW() WHERE slug='pack-chair-11';
UPDATE products SET designer='Philippe Malouin',    updated_at=NOW() WHERE slug='mimi-1-seater';
UPDATE products SET designer='Philippe Malouin',    updated_at=NOW() WHERE slug='mimi-2-seater';
UPDATE products SET designer='Philippe Malouin',    updated_at=NOW() WHERE slug='mimi-25-seater';
UPDATE products SET designer='Philippe Malouin',    updated_at=NOW() WHERE slug='mimi-3-seater';
UPDATE products SET designer='Gudmundur Ludvik',    updated_at=NOW() WHERE slug='backflip-chair';
UPDATE products SET designer='Andreas Bergsaker',   updated_at=NOW() WHERE slug='chisel-10-stool';
UPDATE products SET designer='Andreas Bergsaker',   updated_at=NOW() WHERE slug='chisel-20-table-round';
UPDATE products SET designer='Andreas Bergsaker',   updated_at=NOW() WHERE slug='chisel-25-table-round';
UPDATE products SET designer='Andreas Bergsaker',   updated_at=NOW() WHERE slug='chisel-29-table-round';
UPDATE products SET designer='Andreas Bergsaker',   updated_at=NOW() WHERE slug='chisel-30-bar-stool';
UPDATE products SET designer='Andreas Bergsaker',   updated_at=NOW() WHERE slug='chisel-30-table-rectangular';
UPDATE products SET designer='Andreas Bergsaker',   updated_at=NOW() WHERE slug='chisel-35-bar-stool';
UPDATE products SET designer='Andreas Bergsaker',   updated_at=NOW() WHERE slug='chisel-630-extendable-table-rectangular';
UPDATE products SET designer='Andreas Bergsaker',   updated_at=NOW() WHERE slug='chisel-65-chair';
UPDATE products SET designer='Andreas Bergsaker',   updated_at=NOW() WHERE slug='chisel-85-lounge-chair';

-- No designer could be extracted for these 7 (left NULL on dev too, nothing to patch):
--   mags-soft-25-seater-low-armrest-with-removable-cover-combination-1
--   mags-soft-25-seater-low-armrest-with-removable-cover-combination-3-left
--   mags-soft-25-seater-low-armrest-with-removable-cover-combination-3-right
--   mags-soft-3-seater-low-armrest-with-removable-cover-combination-1
--   mags-soft-3-seater-low-armrest-with-removable-cover-combination-4-left
--   mags-soft-3-seater-low-armrest-with-removable-cover-combination-4-right
--   mags-soft-with-removable-cover-s01rc
