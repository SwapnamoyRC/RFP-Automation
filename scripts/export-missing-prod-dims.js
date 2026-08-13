require('dotenv').config();
const { Pool } = require('pg');
const { pool: devPool } = require('../src/config/database');
const fs = require('fs');

// Prod DB connection — set PROD_DATABASE_URL in your .env (copy from EC2's .env)
const PROD_DB_URL = process.env.PROD_DATABASE_URL;
if (!PROD_DB_URL) {
  console.error('ERROR: PROD_DATABASE_URL not set in .env');
  console.error('Copy the DATABASE_URL from EC2 .env and add it as PROD_DATABASE_URL in your local .env');
  process.exit(1);
}

async function main() {
  const prodPool = new Pool({ connectionString: PROD_DB_URL, ssl: { rejectUnauthorized: false } });

  // 1. Get all Muuto products missing dimensions in prod
  const { rows: missing } = await prodPool.query(`
    SELECT p.id, p.name, p.source_url
    FROM products p
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'muuto'
      AND (p.dimensions IS NULL OR p.dimensions = '')
    ORDER BY p.name
  `);
  console.log(`Found ${missing.length} prod products missing dimensions`);

  // 2. Get ALL Muuto products with dimensions from dev
  const { rows: devProducts } = await devPool.query(`
    SELECT p.name, p.source_url, p.dimensions, p.materials
    FROM products p
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'muuto'
      AND p.dimensions IS NOT NULL AND p.dimensions != ''
  `);
  console.log(`Dev DB has ${devProducts.length} Muuto products with dimensions`);

  // Build lookup maps (name lowercase + source_url)
  const devByName = new Map(devProducts.map(p => [p.name.toLowerCase().trim(), p]));
  const devByUrl  = new Map(devProducts.filter(p => p.source_url).map(p => [p.source_url.trim(), p]));

  const lines = [];
  lines.push('-- Missing dimensions patch for prod');
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push(`-- Targets ${missing.length} prod products that have no dimensions`);
  lines.push('');

  let matched = 0;
  const unmatched = [];

  for (const prod of missing) {
    // Try exact name match first (case-insensitive)
    let dev = devByName.get(prod.name.toLowerCase().trim());
    // Fallback: match by source_url
    if (!dev && prod.source_url) dev = devByUrl.get(prod.source_url.trim());

    if (dev) {
      // Strip newlines so each UPDATE stays on one line — DBeaver mis-parses multi-line strings
      const dims = dev.dimensions.replace(/\r?\n/g, ' ').replace(/'/g, "''");
      const mats = dev.materials ? dev.materials.replace(/\r?\n/g, ' ').replace(/'/g, "''") : null;
      const matSql = mats ? `'${mats}'` : 'NULL';
      lines.push(`UPDATE products SET dimensions='${dims}', materials=${matSql} WHERE name='${prod.name.replace(/'/g, "''")}';`);
      matched++;
    } else {
      unmatched.push({ name: prod.name, source_url: prod.source_url });
    }
  }

  lines.push('');
  lines.push(`-- Summary: ${matched} matched, ${unmatched.length} unmatched`);

  if (unmatched.length > 0) {
    lines.push('');
    lines.push('-- Products NOT found in dev DB (need separate scraping):');
    unmatched.forEach(p => lines.push(`--   ${p.name}  [${p.source_url || 'no source_url'}]`));
  }

  fs.writeFileSync('missing-dims-patch.sql', lines.join('\n'));

  console.log('\n✓ Written missing-dims-patch.sql');
  console.log(`  Matched and exported: ${matched}`);
  console.log(`  Could not match (need scraping): ${unmatched.length}`);

  if (unmatched.length > 0) {
    console.log('\nUnmatched products:');
    unmatched.forEach(p => console.log(`  - ${p.name}`));
  }

  await prodPool.end();
  await devPool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
