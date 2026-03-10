const HayScraper = require('./hay.scraper');
const MuutoScraper = require('./muuto.scraper');
const NaughtoneScraper = require('./naughtone.scraper');

function createScraper(brand, options) {
  switch (brand.scraper_type) {
    case 'hay':       return new HayScraper(brand, options);
    case 'muuto':     return new MuutoScraper(brand, options);
    case 'naughtone': return new NaughtoneScraper(brand, options);
    default:
      throw new Error(`Unknown scraper type: ${brand.scraper_type}`);
  }
}

module.exports = { createScraper };
