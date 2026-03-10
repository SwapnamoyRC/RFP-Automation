const scraperManager = require('../services/scraper/scraper.manager');
const ScrapeLogModel = require('../models/scrape-log.model');
const BrandModel = require('../models/brand.model');

async function startScrape(req, res) {
  const { brand, generateEmbeddings } = req.body;

  if (brand === 'all') {
    const brands = await BrandModel.findAll();
    const jobs = [];
    for (const b of brands) {
      const job = await scraperManager.startScrape(b.slug, { generateEmbeddings });
      jobs.push(job);
    }
    return res.json({ jobs, message: 'Scraping all brands...' });
  }

  const job = await scraperManager.startScrape(brand, { generateEmbeddings });
  res.json(job);
}

async function getScrapeStatus(req, res) {
  const { jobId } = req.params;
  const job = scraperManager.getJobStatus(parseInt(jobId));

  if (!job) {
    // Check database
    const log = await ScrapeLogModel.findById(parseInt(jobId));
    if (!log) return res.status(404).json({ error: 'Job not found' });
    return res.json(log);
  }

  res.json({ jobId: parseInt(jobId), ...job });
}

async function getScrapeLogs(req, res) {
  const { brand, limit = 10 } = req.query;

  if (brand) {
    const brandRecord = await BrandModel.findBySlug(brand);
    if (!brandRecord) return res.status(404).json({ error: 'Brand not found' });
    const logs = await ScrapeLogModel.findByBrand(brandRecord.id, parseInt(limit));
    return res.json(logs);
  }

  res.status(400).json({ error: 'brand query parameter required' });
}

module.exports = { startScrape, getScrapeStatus, getScrapeLogs };
