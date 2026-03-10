const { v4: uuid } = require('uuid');
const cron = require('node-cron');
const logger = require('../config/logger');
const scraperManager = require('./scraper/scraper.manager');

class SyncService {
  constructor() {
    this.activeSyncs = new Map();
  }

  async startSync(brandSlugs = ['hay', 'muuto', 'naughtone'], options = {}) {
    const syncId = uuid();
    const syncState = {
      status: 'running',
      brands: {},
      startedAt: new Date()
    };

    for (const slug of brandSlugs) {
      syncState.brands[slug] = { status: 'pending', products: 0 };
    }
    this.activeSyncs.set(syncId, syncState);

    // Run in background
    this._executeSync(syncId, brandSlugs, options).catch(err => {
      logger.error(`Sync ${syncId} failed:`, err);
      syncState.status = 'failed';
    });

    return { syncId, status: 'started', brands: brandSlugs };
  }

  async _executeSync(syncId, brandSlugs, options) {
    const syncState = this.activeSyncs.get(syncId);

    for (const slug of brandSlugs) {
      syncState.brands[slug].status = 'running';
      try {
        const result = await scraperManager.startScrapeAndWait(slug, {
          ...options,
          triggeredBy: options.triggeredBy || 'sync'
        });
        syncState.brands[slug] = {
          status: 'completed',
          products: result.products_found
        };
      } catch (err) {
        syncState.brands[slug] = {
          status: 'failed',
          error: err.message
        };
        logger.error(`Sync failed for ${slug}:`, err.message);
      }
    }

    syncState.status = Object.values(syncState.brands).some(b => b.status === 'failed')
      ? 'partial'
      : 'completed';

    logger.info(`Sync ${syncId} finished with status: ${syncState.status}`);
  }

  getSyncStatus(syncId) {
    return this.activeSyncs.get(syncId) || null;
  }

  startCronSchedule() {
    // Every Sunday at 2 AM
    cron.schedule('0 2 * * 0', () => {
      logger.info('Starting scheduled weekly sync');
      this.startSync(['hay', 'muuto', 'naughtone'], { triggeredBy: 'scheduled' });
    });
    logger.info('Weekly sync cron scheduled (Sundays at 2 AM)');
  }
}

module.exports = new SyncService();
