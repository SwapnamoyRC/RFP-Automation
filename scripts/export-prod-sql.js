require('dotenv').config();
const { pool } = require('../src/config/database');
const fs = require('fs');

async function main() {
  const lines = [];
  lines.push('-- Production DB patch generated from local dev DB');
  lines.push('-- Run this in DBeaver against production');
  lines.push('-- Generated: ' + new Date().toISOString());
  lines.push('');

  // All Muuto products that have dimensions/materials — export as UPDATE by name
  const { rows } = await pool.query(`
    SELECT p.name, p.dimensions, p.materials, p.source_url, p.image_url, p.category
    FROM products p
    JOIN brands b ON b.id = p.brand_id
    WHERE b.slug = 'muuto'
      AND (p.dimensions IS NOT NULL AND p.dimensions != '')
    ORDER BY p.name
  `);

  lines.push(`-- === DIMENSIONS + MATERIALS (${rows.length} products) ===`);
  lines.push('');

  for (const r of rows) {
    // Strip newlines so each UPDATE stays on one line — DBeaver mis-parses multi-line strings
    const dims = r.dimensions.replace(/\r?\n/g, ' ').replace(/'/g, "''");
    const mats = r.materials ? r.materials.replace(/\r?\n/g, ' ').replace(/'/g, "''") : null;
    const matSql = mats ? `'${mats}'` : 'NULL';
    lines.push(`UPDATE products SET dimensions='${dims}', materials=${matSql} WHERE name='${r.name.replace(/'/g, "''")}';`);
  }

  lines.push('');
  lines.push('-- === SOURCE URL FIXES ===');
  lines.push('');

  // All products with updated source URLs (new format)
  const urlFixes = [
    { name: 'Portable Lamp Charging Station',           url: 'https://www.muuto.com/product/Lamp-Charging-Station--PLCSEU/PLCSEU01/' },
    { name: 'Linear Steel Chair/Lounge Chair Seat Pad', url: 'https://www.muuto.com/product/Linear-Steel-Lounge-Chair-Seat-Pad/' },
    { name: 'Cover and Visu Chair Transport Trolley',   url: 'https://www.muuto.com/product/Transport-Trolley--COVTRO/COVTRO01/' },
    { name: 'Midst Power Units',                        url: 'https://www.muuto.com/product/Power-Units--PWCENCFG/PWCENCFGUS01V1/' },
    { name: 'Mini Stacked Storage System Shelving - Configuration 8', url: 'https://www.muuto.com/product/Mini-Stacked-Storage-System--MSTMBBLR/MSTMBBLR03/' },
    { name: 'Oslo Sofa 1 Seater',                       url: 'https://www.muuto.com/product/Oslo-Sofa-1-Seater/' },
  ];
  for (const f of urlFixes) {
    lines.push(`UPDATE products SET source_url='${f.url}' WHERE name='${f.name.replace(/'/g, "''")}';`);
  }

  lines.push('');
  lines.push('-- === IMAGE URL FIXES (Cylindo → occtoo) ===');
  lines.push('');

  // Products whose image_url was fixed from Cylindo
  const imgNames = [
    'Oslo Sofa 1 Seater',
    'In Situ Modular Sofa 2-Seater Configurations - Frame and Module - Ocean 80/Black - 2-Seater - Configuration 7',
    'In Situ Modular Sofa 3-Seater Configurations - Frame and Module - Clay 12/Black - 3-Seater - Configuration 9',
    'In Situ Modular Sofa 4-Seater Configurations - Frame and Module - Clay 15/Black - 4-Seater - Configuration 5',
    'In Situ Modular Sofa Corner Configurations - Frame and Module - Ocean 80/Black - Corner - Configuration 9',
  ];
  const { rows: imgRows } = await pool.query(
    `SELECT p.name, p.image_url FROM products p JOIN brands b ON b.id=p.brand_id
     WHERE b.slug='muuto' AND p.name=ANY($1)`, [imgNames]
  );
  for (const r of imgRows) {
    lines.push(`UPDATE products SET image_url='${r.image_url.replace(/'/g, "''")}' WHERE name='${r.name.replace(/'/g, "''")}';`);
  }

  lines.push('');
  lines.push('-- === DELETIONS ===');
  lines.push('');
  const deleteNames = [
    'Piton Portable Lamp','Outline Corner Sofa Vidar 733/Black',
    'Avail Coat Hook','Cable Management Solution','Chair Hanger',
    'Color Card','Mini Stacked Storage System Wall Mount',
    'Stacked Storage System Acoustic Panel - Aqua Mélange - Medium',
  ];
  lines.push(`DELETE FROM product_siglip_images WHERE product_id IN (`);
  lines.push(`  SELECT p.id FROM products p JOIN brands b ON b.id=p.brand_id`);
  lines.push(`  WHERE b.slug='muuto' AND p.name IN (${deleteNames.map(n => `'${n.replace(/'/g, "''")}'`).join(',')})`)
  lines.push(`);`);
  lines.push(`DELETE FROM products p USING brands b`);
  lines.push(`WHERE b.id=p.brand_id AND b.slug='muuto' AND p.name IN (${deleteNames.map(n => `'${n.replace(/'/g, "''")}'`).join(',')});`);

  const sql = lines.join('\n');
  fs.writeFileSync('prod-patch.sql', sql);
  console.log(`Written prod-patch.sql — ${rows.length} dimension updates + ${urlFixes.length} URL fixes + ${imgRows.length} image fixes + ${deleteNames.length} deletions`);
  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
