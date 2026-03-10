require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const logger = require('../config/logger');

async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  logger.info(`Found ${files.length} migration files`);

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    try {
      await pool.query(sql);
      logger.info(`Migration applied: ${file}`);
    } catch (err) {
      logger.error(`Migration failed: ${file}`, { error: err.message });
      throw err;
    }
  }

  logger.info('All migrations applied successfully');
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { runMigrations };
