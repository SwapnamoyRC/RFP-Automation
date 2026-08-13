/**
 * Patch designer field for the 27 new HAY products by extracting from descriptions.
 */
require('dotenv').config();
const { pool } = require('../src/config/database');

// Patterns to extract designer name from HAY description text
// Use \s+ to handle non-breaking spaces ( ) from HTML content
const PATTERNS = [
  /Designed\s+(?:for\s+HAY\s+)?by\s+(?:\w+\s+designer\s+)?([A-Z][a-zÀ-ÿ]+(?:\s+[A-Z][a-zÀ-ÿ]+)+)/,
  /designer\s+([A-Z][a-zÀ-ÿ]+(?:\s+[A-Z][a-zÀ-ÿ]+)+)[,\.]/,
];

function extractDesigner(description) {
  if (!description) return null;
  for (const pat of PATTERNS) {
    const m = description.match(pat);
    if (m) return m[1].trim();
  }
  return null;
}

async function main() {
  // Get new products with description but missing designer
  const { rows } = await pool.query(`
    SELECT pr.id, pr.name, pr.description, pr.designer
    FROM products pr
    JOIN brands br ON br.id = pr.brand_id
    WHERE br.slug = 'hay'
      AND pr.created_at > NOW() - INTERVAL '2 hours'
    ORDER BY pr.name
  `);

  console.log(`Checking ${rows.length} new HAY products for designer extraction...\n`);

  let updated = 0;
  for (const r of rows) {
    const extracted = extractDesigner(r.description);
    if (extracted && !r.designer) {
      await pool.query(
        `UPDATE products SET designer = $1, updated_at = NOW() WHERE id = $2`,
        [extracted, r.id]
      );
      console.log(`  ✓ ${r.name}`);
      console.log(`    → ${extracted}`);
      updated++;
    } else if (r.designer) {
      console.log(`  ✓ ${r.name} (already had: ${r.designer})`);
    } else {
      console.log(`  ✗ ${r.name} — could not extract designer`);
    }
  }

  console.log(`\nUpdated: ${updated}/${rows.length} products`);
  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
