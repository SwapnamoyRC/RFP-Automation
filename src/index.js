require('dotenv').config();
const app = require('./app');
const { testConnection } = require('./config/database');
const { runMigrations } = require('./db/migrate');
const { seed } = require('./db/seed');
const syncService = require('./services/sync.service');
const logger = require('./config/logger');

const PORT = process.env.PORT || 3000;

async function main() {
  try {
    // Test database connection
    logger.info('Testing database connection...');
    await testConnection();
    logger.info('Database connected successfully');

    // Run migrations
    logger.info('Running migrations...');
    await runMigrations();

    // Seed brands
    logger.info('Seeding brands...');
    await seed();

    // Start weekly sync cron
    syncService.startCronSchedule();

    // Start server
    const server = app.listen(PORT, () => {
      logger.info(`RFP Automation API running on port ${PORT}`);
      logger.info(`Health check: http://localhost:${PORT}/api/health`);
    });
    // RFP processing with full AI pipeline can take 10+ minutes
    server.timeout = 900000; // 15 min
    server.keepAliveTimeout = 900000;
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

main();
