require('dotenv').config();
const { Pool } = require('pg');
const { pool: devPool } = require('../src/config/database');
const fs = require('fs');

const PROD_DB_URL = process.env.PROD_DATABASE_URL;
if (!PROD_DB_URL) {
  console.error('ERROR: PROD_DATABASE_URL not set in .env');
  process.exit(1);
}

async function main() {
  const prodPool = new Pool({ connectionString: PROD_DB_URL, ssl: { rejectUnauthorized: false } });

  // Get all Muuto product names in prod
  const { rows: prodProducts } = await prodPool.query(`
    SELECT p.name FROM products p
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'muuto'
  `);
  const prodNames = new Set(prodProducts.map(r => r.name.toLowerCase().trim()));

  // Get all Muuto products from dev
  const { rows: devProducts } = await devPool.query(`
    SELECT p.name, p.slug, p.description, p.dimensions, p.materials,
           p.source_url, p.image_url, p.category, p.created_at
    FROM products p
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'muuto'
    ORDER BY p.name
  `);

  // Find products in dev that are NOT in prod
  const devOnly = devProducts.filter(p => !prodNames.has(p.name.toLowerCase().trim()));
  console.log(`Dev has ${devProducts.length} Muuto products`);
  console.log(`Prod has ${prodProducts.length} Muuto products`);
  console.log(`Products in dev but NOT in prod: ${devOnly.length}`);

  if (devOnly.length === 0) {
    console.log('Nothing to sync.');
    await prodPool.end();
    await devPool.end();
    return;
  }

  const lines = [];
  lines.push('-- Dev-only products sync to prod');
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push(`-- Inserts ${devOnly.length} products from dev into prod`);
  lines.push('');

  for (const p of devOnly) {
    const esc = s => s ? s.replace(/\r?\n/g, ' ').replace(/'/g, "''") : null;
    const name    = esc(p.name);
    // Generate slug from name if not present: lowercase, replace non-alphanumeric with hyphens
    const slugVal = p.slug || p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const slug    = esc(slugVal);
    const desc    = p.description ? `'${esc(p.description)}'` : 'NULL';
    const dims    = p.dimensions  ? `'${esc(p.dimensions)}'`  : 'NULL';
    const mats    = p.materials   ? `'${esc(p.materials)}'`   : 'NULL';
    const src     = p.source_url  ? `'${esc(p.source_url)}'`  : 'NULL';
    const img     = p.image_url   ? `'${esc(p.image_url)}'`   : 'NULL';
    const cat     = p.category    ? `'${esc(p.category)}'`    : 'NULL';

    lines.push(
      `INSERT INTO products (name, slug, brand_id, description, dimensions, materials, source_url, image_url, category, created_at, updated_at)` +
      ` SELECT '${name}', '${slug}', b.id, ${desc}, ${dims}, ${mats}, ${src}, ${img}, ${cat}, NOW(), NOW()` +
      ` FROM brands b WHERE b.slug='muuto'` +
      ` ON CONFLICT DO NOTHING;`
    );
  }

  lines.push('');
  lines.push(`-- ${devOnly.length} products listed above`);
  lines.push('-- Products:');
  devOnly.forEach(p => lines.push(`--   ${p.name}`));

  fs.writeFileSync('dev-only-products.sql', lines.join('\n'));
  console.log('\n✓ Written dev-only-products.sql');
  console.log('\nProducts to insert into prod:');
  devOnly.forEach(p => console.log(`  - ${p.name}`));

  await prodPool.end();
  await devPool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
