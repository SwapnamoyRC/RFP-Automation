require('dotenv').config();
const { pool } = require('../src/config/database');
async function main() {
  const { rows } = await pool.query(`
    SELECT pr.name, pr.dimensions FROM products pr JOIN brands br ON br.id=pr.brand_id
    WHERE br.slug='hay' AND (pr.name ILIKE 'mags soft 2%low%' OR pr.name ILIKE 'mags soft%s01%')
    ORDER BY pr.name
  `);
  rows.forEach(r => console.log(`${r.name}\n  -> ${r.dimensions || 'null'}`));
  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
