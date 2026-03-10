require('dotenv').config();
const { pool } = require('../config/database');
const logger = require('../config/logger');

const brands = [
  {
    name: 'HAY',
    slug: 'hay',
    base_url: 'https://www.hay.com',
    scraper_type: 'hay'
  },
  {
    name: 'Muuto',
    slug: 'muuto',
    base_url: 'https://www.muuto.com',
    scraper_type: 'muuto'
  },
  {
    name: 'NaughtOne',
    slug: 'naughtone',
    base_url: 'https://www.naughtone.com',
    scraper_type: 'naughtone'
  }
];

async function seed() {
  for (const brand of brands) {
    await pool.query(
      `INSERT INTO brands (name, slug, base_url, scraper_type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET
         name = $1, base_url = $3, scraper_type = $4, updated_at = NOW()`,
      [brand.name, brand.slug, brand.base_url, brand.scraper_type]
    );
    logger.info(`Seeded brand: ${brand.name}`);
  }

  logger.info('Seed complete');
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('Seed failed:', err);
      process.exit(1);
    });
}

module.exports = { seed };
