require('dotenv').config();
const { pool } = require('../src/config/database');
async function main() {
  const { rows } = await pool.query(`
    SELECT pr.name, pr.description
    FROM products pr JOIN brands br ON br.id = pr.brand_id
    WHERE br.slug = 'hay'
      AND pr.created_at > NOW() - INTERVAL '2 hours'
      AND pr.name LIKE 'Chisel%'
    LIMIT 2
  `);
  rows.forEach(r => {
    console.log(`[${r.name}]`);
    console.log(JSON.stringify(r.description.substring(0, 200)));
    console.log();
  });
  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
