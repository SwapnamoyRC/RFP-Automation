require('dotenv').config();
const { runMigrations } = require('../src/db/migrate');
const { seed } = require('../src/db/seed');
const scraperManager = require('../src/services/scraper/scraper.manager');
const logger = require('../src/config/logger');

const brand = process.argv[2] || 'all';

async function main() {
  await runMigrations();
  await seed();

  if (brand === 'all') {
    for (const slug of ['hay', 'muuto', 'naughtone']) {
      logger.info(`Starting scrape for ${slug}...`);
      try {
        const result = await scraperManager.startScrapeAndWait(slug, { triggeredBy: 'cli' });
        logger.info(`${slug} complete:`, result);
      } catch (err) {
        logger.error(`${slug} failed:`, err.message);
      }
    }
  } else {
    const result = await scraperManager.startScrapeAndWait(brand, { triggeredBy: 'cli' });
    logger.info(`${brand} complete:`, result);
  }

  process.exit(0);
}

main().catch(err => {
  logger.error('Scrape failed:', err);
  process.exit(1);
});
