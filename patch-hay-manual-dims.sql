-- HAY manual dimension patch — 2 products where dimensions weren't captured by scraping
-- (from scripts/patch-hay-manual-dims.js)
-- Run on PROD DB in DBeaver
-- Generated: 2026-08-13

UPDATE products SET dimensions='H8 x W53 x L17',       updated_at=NOW() WHERE slug='backflip-wall-bracket';
UPDATE products SET dimensions='H74 x W180 x L95',      updated_at=NOW() WHERE slug='chisel-630-extendable-table-rectangular';
