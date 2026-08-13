require('dotenv').config();
const { pool } = require('../src/config/database');
async function main() {
  const { rows } = await pool.query(`
    SELECT conname, contype, pg_get_constraintdef(oid) def
    FROM pg_constraint
    WHERE conrelid = 'products'::regclass
    ORDER BY contype, conname
  `);
  console.log('Constraints on products table:');
  rows.forEach(r => console.log(`  [${r.contype}] ${r.conname}: ${r.def}`));
  await pool.end();
}
main().catch(e => { console.error(e.message); pool.end(); });
