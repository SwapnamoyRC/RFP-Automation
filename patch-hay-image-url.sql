-- HAY products.image_url patch — sets the primary listing image for the 27 new HAY
-- products scraped Aug 2026 (scripts/scrape-hay-new-products.js / patch-hay-image-url.js).
-- Values pulled live from dev DB on 2026-08-13 (the original script picked the first
-- 'product'-type image via a NOW()-INTERVAL time window + DISTINCT ON, neither of
-- which is portable as static SQL — this reflects the actual resulting values).
--
-- Run AFTER hay-new-products-insert.sql (these products must exist on prod first).
-- Run on PROD DB in DBeaver
-- Generated: 2026-08-13

UPDATE products SET image_url='https://www.hay.com/img_20260629022248/globalassets/inriver/integration/service/backflip-chair_910x1100_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='backflip-chair';
UPDATE products SET image_url='https://www.hay.com/img_20260629022415/globalassets/inriver/integration/service/backflip-wall-bracket_910x1100_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='backflip-wall-bracket';
UPDATE products SET image_url='https://www.hay.com/img_20260629023348/globalassets/inriver/integration/service/chisel-10-stool_910x1100_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='chisel-10-stool';
UPDATE products SET image_url='https://www.hay.com/img_20260630013312/globalassets/inriver/integration/service/chisel-20-table-round_910x1100_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='chisel-20-table-round';
UPDATE products SET image_url='https://www.hay.com/img_20260630013441/globalassets/inriver/integration/service/chisel-25-table-round_910x1100_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='chisel-25-table-round';
UPDATE products SET image_url='https://www.hay.com/img_20260629023513/img_20260629023513/globalassets/inriver/integration/service/chisel-29-table-round_910x1100_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='chisel-29-table-round';
UPDATE products SET image_url='https://www.hay.com/img_20260629024442/globalassets/inriver/integration/service/chisel-30-bar-stool_910x1100_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='chisel-30-bar-stool';
UPDATE products SET image_url='https://www.hay.com/img_20260629024809/globalassets/inriver/integration/service/chisel-30-table-rectangular_1220x1220_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='chisel-30-table-rectangular';
UPDATE products SET image_url='https://www.hay.com/img_20260629025741/globalassets/inriver/integration/service/chisel-35-bar-stool_910x1100_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='chisel-35-bar-stool';
UPDATE products SET image_url='https://www.hay.com/img_20260629031137/globalassets/inriver/integration/service/chisel-630-extendable-table-rectangular_1220x1220_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='chisel-630-extendable-table-rectangular';
UPDATE products SET image_url='https://www.hay.com/img_20260629030655/img_20260629030655/globalassets/inriver/integration/service/chisel-65-chair_910x1100_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='chisel-65-chair';
UPDATE products SET image_url='https://www.hay.com/img_20260811090355/globalassets/inriver/integration/service/chisel-85-lounge-chair_910x1100_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='chisel-85-lounge-chair';
UPDATE products SET image_url='https://www.hay.com/img_20260629054803/globalassets/inriver/integration/service/mags-soft-25-seater-low-armrest-with-removable-cover-combination-1_1380x900_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='mags-soft-25-seater-low-armrest-with-removable-cover-combination-1';
UPDATE products SET image_url='https://www.hay.com/img_20260629055402/globalassets/inriver/integration/service/mags-soft-25-seater-low-armrest-with-removable-cover-combination-3-left_1380x900_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='mags-soft-25-seater-low-armrest-with-removable-cover-combination-3-left';
UPDATE products SET image_url='https://www.hay.com/img_20260629060102/globalassets/inriver/integration/service/mags-soft-25-seater-low-armrest-with-removable-cover-combination-3-right_1380x900_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='mags-soft-25-seater-low-armrest-with-removable-cover-combination-3-right';
UPDATE products SET image_url='https://www.hay.com/img_20260629060703/globalassets/inriver/integration/service/mags-soft-3-seater-low-armrest-with-removable-cover-combination-1_1390x800_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='mags-soft-3-seater-low-armrest-with-removable-cover-combination-1';
UPDATE products SET image_url='https://www.hay.com/img_20260629045232/globalassets/inriver/integration/service/mags-soft-3-seater-low-armrest-with-removable-cover-combination-4-left_1220x1220_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='mags-soft-3-seater-low-armrest-with-removable-cover-combination-4-left';
UPDATE products SET image_url='https://www.hay.com/img_20260629061302/globalassets/inriver/integration/service/mags-soft-3-seater-low-armrest-with-removable-cover-combination-4-right_1380x900_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='mags-soft-3-seater-low-armrest-with-removable-cover-combination-4-right';
UPDATE products SET image_url='https://www.hay.com/img_20260811025134/globalassets/inriver/integration/service/mags-soft-with-removable-cover-s01rc_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='mags-soft-with-removable-cover-s01rc';
UPDATE products SET image_url='https://www.hay.com/img_20260629040111/globalassets/inriver/integration/service/mimi-1-seater_910x1100_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='mimi-1-seater';
UPDATE products SET image_url='https://www.hay.com/img_20260629041243/globalassets/inriver/integration/service/mimi-25-seater_910x1100_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='mimi-25-seater';
UPDATE products SET image_url='https://www.hay.com/img_20260629040643/globalassets/inriver/integration/service/mimi-2-seater_910x1100_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='mimi-2-seater';
UPDATE products SET image_url='https://www.hay.com/img_20260629041853/globalassets/inriver/integration/service/mimi-3-seater_910x1100_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='mimi-3-seater';
UPDATE products SET image_url='https://www.hay.com/img_20260629043648/globalassets/inriver/integration/service/mimi-cushion_910x1100_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='mimi-cushion';
UPDATE products SET image_url='https://www.hay.com/img_20260629044345/globalassets/inriver/integration/service/mimi-ottoman_910x1100_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='mimi-ottoman';
UPDATE products SET image_url='https://www.hay.com/img_20260629034949/globalassets/inriver/integration/service/pack-chair-10_910x1100_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='pack-chair-10';
UPDATE products SET image_url='https://www.hay.com/img_20260629035442/globalassets/inriver/integration/service/pack-chair-11_1220x1220_brandmodel.jpg?w=600', updated_at=NOW() WHERE slug='pack-chair-11';
