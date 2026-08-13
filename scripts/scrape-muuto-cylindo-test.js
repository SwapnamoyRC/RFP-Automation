/**
 * Quick 3-product test of scrape-muuto-cylindo.js logic
 * Temporarily overrides the product query to just 3 products
 */
process.argv.push('--dry-run');  // force dry-run

// Patch pool.query to return only 3 test products on first call
const originalRequire = require;
const Module = require('module');
const orig = Module.prototype.require;
Module.prototype.require = function(id) {
  const m = orig.apply(this, arguments);
  if (id.includes('database') && m.pool) {
    const origQuery = m.pool.query.bind(m.pool);
    let first = true;
    m.pool.query = function(sql, params) {
      if (first && sql.includes('muuto') && sql.includes('COUNT(psi.id)')) {
        first = false;
        // Return 3 specific test products
        return origQuery(`
          SELECT p.id, p.name, p.source_url, COUNT(psi.id) as existing_images
          FROM products p JOIN brands b ON b.id = p.brand_id
          LEFT JOIN product_siglip_images psi ON psi.product_id = p.id
          WHERE b.slug = 'muuto' AND p.source_url IS NOT NULL
          GROUP BY p.id, p.name, p.source_url HAVING COUNT(psi.id) < 4
          ORDER BY p.name LIMIT 3
        `);
      }
      return origQuery(sql, params);
    };
  }
  return m;
};

require('./scrape-muuto-cylindo.js');
