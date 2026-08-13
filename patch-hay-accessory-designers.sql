-- HAY accessory designer patch — accessories whose designer is known from their parent product
-- (from scripts/patch-hay-accessory-designers.js)
-- Run on PROD DB in DBeaver
-- Generated: 2026-08-13

UPDATE products SET designer='Gudmundur Ludvik', updated_at=NOW() WHERE slug='backflip-wall-bracket'; -- accessory for Backflip Chair
UPDATE products SET designer='Philippe Malouin',  updated_at=NOW() WHERE slug='mimi-cushion';          -- accessory for Mimi Sofa
UPDATE products SET designer='Philippe Malouin',  updated_at=NOW() WHERE slug='mimi-ottoman';           -- accessory for Mimi Sofa
