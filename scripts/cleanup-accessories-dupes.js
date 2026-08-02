require('dotenv').config();
const { pool } = require('../src/config/database');
const logger = require('../src/config/logger');

async function main() {
  // Delete "Attach Coat Hook Set of 2" with NULL dims (dupe of "Set Of 2" which has dims)
  const { rows: hook } = await pool.query(`
    SELECT p.id, p.name FROM products p JOIN brands b ON b.id=p.brand_id
    WHERE b.slug='muuto' AND p.name ILIKE 'Attach Coat Hook Set of 2'
      AND (p.dimensions IS NULL OR p.dimensions='')
  `);
  for (const r of hook) {
    await pool.query(`DELETE FROM product_siglip_images WHERE product_id=$1`, [r.id]);
    await pool.query(`DELETE FROM products WHERE id=$1`, [r.id]);
    logger.info(`✓ Deleted: "${r.name}" (NULL dims dupe)`);
  }
  if (!hook.length) logger.info('No matching Attach Coat Hook NULL-dims entry found');

  // Show final state
  const { rows: remaining } = await pool.query(`
    SELECT p.name FROM products p JOIN brands b ON b.id=p.brand_id
    WHERE b.slug='muuto' AND p.category='accessories'
      AND (p.dimensions IS NULL OR p.dimensions='')
    ORDER BY p.name
  `);
  logger.info(`\nAccessories still without dims (${remaining.length}):`);
  remaining.forEach(r => logger.info(`  - ${r.name}`));

  await pool.end();
}

main().catch(err => { logger.error('Fatal:', err); pool.end(); process.exit(1); });
