require('dotenv').config();
const { pool } = require('../src/config/database');
pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'product_siglip_images' ORDER BY ordinal_position")
  .then(r => { r.rows.forEach(c => console.log(c.column_name + ' - ' + c.data_type)); return pool.end(); })
  .catch(e => { console.error('ERR:', e.message); return pool.end(); });
