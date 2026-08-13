require('dotenv').config();
const { pool } = require('../src/config/database');

async function main() {
  // 1. Rows in product_siglip_images with NULL embedding
  const { rows: [nullEmb] } = await pool.query(`
    SELECT COUNT(*) n FROM product_siglip_images WHERE siglip_embedding IS NULL
  `);
  console.log(`Rows with NULL siglip_embedding: ${nullEmb.n}`);

  // 2. Per-brand breakdown of null embeddings
  if (parseInt(nullEmb.n) > 0) {
    const { rows: byBrand } = await pool.query(`
      SELECT b.name, COUNT(*) n
      FROM product_siglip_images psi
      JOIN products p ON p.id = psi.product_id
      JOIN brands b ON b.id = p.brand_id
      WHERE psi.siglip_embedding IS NULL
      GROUP BY b.name ORDER BY n DESC
    `);
    console.log('\nBy brand:');
    byBrand.forEach(r => console.log(`  ${r.n.toString().padStart(5)}  ${r.name}`));
  }

  // 3. Overall coverage per brand
  console.log('\n=== Coverage per brand ===');
  const { rows: brands } = await pool.query(`
    SELECT b.name,
      COUNT(DISTINCT p.id) products,
      COUNT(psi.id) total_imgs,
      SUM(CASE WHEN psi.siglip_embedding IS NULL THEN 1 ELSE 0 END) missing_emb,
      SUM(CASE WHEN psi.id IS NULL THEN 1 ELSE 0 END) no_imgs
    FROM brands b
    JOIN products p ON p.brand_id = b.id
    LEFT JOIN product_siglip_images psi ON psi.product_id = p.id
    GROUP BY b.name
    HAVING COUNT(p.id) > 0
    ORDER BY COUNT(DISTINCT p.id) DESC
  `);
  brands.forEach(r =>
    console.log(`  ${r.name.padEnd(25)} ${r.products} prods | ${r.total_imgs} imgs | ${r.missing_emb} missing emb | ${r.no_imgs} no-img prods`)
  );

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
