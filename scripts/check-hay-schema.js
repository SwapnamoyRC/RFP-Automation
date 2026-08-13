require('dotenv').config();
const { pool } = require('../src/config/database');

async function main() {
  // Get table schema
  const { rows: cols } = await pool.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'products'
    ORDER BY ordinal_position
  `);
  console.log('=== products table columns ===');
  cols.forEach(c => console.log(`  ${c.column_name.padEnd(30)} ${c.data_type.padEnd(20)} nullable=${c.is_nullable}`));

  // Sample a few HAY products to see what data they have
  const { rows: samples } = await pool.query(`
    SELECT p.id, p.name, p.slug, p.description, p.source_url, p.category,
           p.dimensions, p.materials, p.created_at,
           b.slug as brand_slug
    FROM products p
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'hay'
    ORDER BY p.created_at DESC
    LIMIT 5
  `);
  console.log('\n=== Sample HAY products (most recent 5) ===');
  samples.forEach(r => {
    console.log(`\n  name: ${r.name}`);
    console.log(`  slug: ${r.slug}`);
    console.log(`  source_url: ${r.source_url}`);
    console.log(`  category: ${r.category}`);
    console.log(`  description: ${(r.description || '').substring(0, 80)}...`);
    console.log(`  dimensions: ${r.dimensions ? r.dimensions.substring(0, 60) : 'null'}`);
    console.log(`  materials: ${r.materials ? r.materials.substring(0, 60) : 'null'}`);
  });

  // Get brand id for hay
  const { rows: [brand] } = await pool.query(`SELECT id, name FROM brands WHERE slug='hay'`);
  console.log(`\n=== HAY brand id: ${brand.id} ===`);

  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
