require('dotenv').config();
const { pool } = require('../src/config/database');

async function main() {
  // 1. Hudson Coatstand — delete G-HM/G-Asari wrong images
  const hudsonDel = await pool.query(`
    DELETE FROM product_siglip_images
    WHERE product_id = (
      SELECT p.id FROM products p JOIN brands b ON b.id=p.brand_id
      WHERE b.slug='naughtone' AND p.name='Hudson Coatstand'
    )
    AND (
      image_url LIKE '%G-Asari%'
      OR image_url LIKE '%G-HM_lifestyle%'
      OR image_url LIKE '%G-HM_NurseRespite%'
      OR image_url LIKE '%G-HM_HCS%'
    )
  `);
  console.log(`Hudson Coatstand: deleted ${hudsonDel.rowCount} bad images`);

  // 2. Pullman Desk / Desk Pod — delete Pullman Booth images
  const deskDel = await pool.query(`
    DELETE FROM product_siglip_images
    WHERE product_id = (
      SELECT p.id FROM products p JOIN brands b ON b.id=p.brand_id
      WHERE b.slug='naughtone' AND p.name='Pullman Desk / Desk Pod'
    )
    AND (
      image_url LIKE '%pullman_booth_group%'
      OR image_url LIKE '%pullman_booths_library%'
      OR image_url LIKE '%Forbo_lino%'
    )
  `);
  console.log(`Pullman Desk: deleted ${deskDel.rowCount} bad images`);

  // 3. Dalby Table — delete the massive multi-product group shot
  const dalbyDel = await pool.query(`
    DELETE FROM product_siglip_images
    WHERE product_id = (
      SELECT p.id FROM products p JOIN brands b ON b.id=p.brand_id
      WHERE b.slug='naughtone' AND p.name='Dalby Table'
    )
    AND image_url LIKE '%NOTRFA_NOTFRB_ALLOBSL_DAL650DL_HLO2SFBWD%'
  `);
  console.log(`Dalby Table: deleted ${dalbyDel.rowCount} bad images`);

  // Check remaining counts for affected products
  const { rows } = await pool.query(`
    SELECT p.name, COUNT(psi.id) as imgs
    FROM products p
    JOIN brands b ON b.id=p.brand_id
    LEFT JOIN product_siglip_images psi ON psi.product_id=p.id
    WHERE b.slug='naughtone'
      AND p.name IN ('Hudson Coatstand','Pullman Desk / Desk Pod','Dalby Table','Lotti Chair','Pullman Modular Seating')
    GROUP BY p.id, p.name
    ORDER BY p.name
  `);
  console.log('\nImages remaining after cleanup:');
  rows.forEach(r => console.log(`  [${r.imgs}] ${r.name}`));

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
