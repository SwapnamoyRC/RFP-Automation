/**
 * Create or promote an admin user.
 *
 * Usage:
 *   node scripts/create-admin.js <email> <password> [name]
 *
 * Examples:
 *   node scripts/create-admin.js admin@company.com MyPass@123 "Admin User"
 *   node scripts/create-admin.js admin@company.com MyPass@123
 *
 * If the email already exists, the script promotes that user to admin
 * without changing their password.
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const [,, email, password, name] = process.argv;

if (!email || !password) {
  console.error('Usage: node scripts/create-admin.js <email> <password> [name]');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const existing = await pool.query('SELECT id, email, role FROM users WHERE email = $1', [email.toLowerCase()]);

  if (existing.rows.length > 0) {
    const user = existing.rows[0];
    if (user.role === 'admin') {
      console.log(`✓ ${email} is already an admin.`);
    } else {
      await pool.query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', ['admin', user.id]);
      console.log(`✓ Promoted existing user ${email} to admin.`);
    }
  } else {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1, $2, $3, 'admin')
       RETURNING id, email, name, role`,
      [email.toLowerCase(), passwordHash, name || null]
    );
    const u = result.rows[0];
    console.log(`✓ Admin user created:`);
    console.log(`  ID:    ${u.id}`);
    console.log(`  Email: ${u.email}`);
    console.log(`  Name:  ${u.name || '(none)'}`);
    console.log(`  Role:  ${u.role}`);
  }
}

run()
  .catch(err => { console.error('Error:', err.message); process.exit(1); })
  .finally(() => pool.end());
