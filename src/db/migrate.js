require('dotenv').config();
const knex = require('knex');
const knexConfig = require('../../knexfile');
const logger = require('../config/logger');

const env = process.env.NODE_ENV || 'development';

async function runMigrations() {
  const db = knex(knexConfig[env]);

  try {
    logger.info('Running Knex migrations...');
    const [batchNo, log] = await db.migrate.latest();

    if (log.length === 0) {
      logger.info('Database is already up to date');
    } else {
      logger.info(`Migration batch ${batchNo} applied: ${log.length} migrations`);
      log.forEach(file => logger.info(`  - ${file}`));
    }
  } finally {
    await db.destroy();
  }
}

async function rollbackMigrations() {
  const db = knex(knexConfig[env]);

  try {
    logger.info('Rolling back last migration batch...');
    const [batchNo, log] = await db.migrate.rollback();

    if (log.length === 0) {
      logger.info('Nothing to rollback');
    } else {
      logger.info(`Rolled back batch ${batchNo}: ${log.length} migrations`);
      log.forEach(file => logger.info(`  - ${file}`));
    }
  } finally {
    await db.destroy();
  }
}

async function migrationStatus() {
  const db = knex(knexConfig[env]);

  try {
    const [completed, pending] = await db.migrate.list();
    logger.info(`Completed migrations: ${completed.length}`);
    completed.forEach(file => logger.info(`  [done] ${file}`));
    logger.info(`Pending migrations: ${pending.length}`);
    pending.forEach(file => logger.info(`  [pending] ${file}`));
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  const command = process.argv[2] || 'latest';

  const commands = { latest: runMigrations, rollback: rollbackMigrations, status: migrationStatus };

  if (!commands[command]) {
    console.error(`Unknown command: ${command}. Use: latest, rollback, status`);
    process.exit(1);
  }

  commands[command]()
    .then(() => process.exit(0))
    .catch(err => {
      logger.error(`Migration ${command} failed:`, { error: err.message });
      process.exit(1);
    });
}

module.exports = { runMigrations, rollbackMigrations, migrationStatus };
