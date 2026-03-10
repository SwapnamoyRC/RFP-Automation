const { chromium } = require('playwright');
const logger = require('../../config/logger');
const { retry } = require('../../utils/retry');

class BaseScraper {
  constructor(brand, options = {}) {
    this.brand = brand;
    this.browser = null;
    this.context = null;
    this.concurrency = options.concurrency || parseInt(process.env.SCRAPE_CONCURRENCY) || 3;
    this.delayMs = options.delayMs || parseInt(process.env.SCRAPE_DELAY_MS) || 2000;
    this.headless = process.env.PLAYWRIGHT_HEADLESS !== 'false';
  }

  async init() {
    logger.info(`Initializing ${this.brand.name} scraper`);
    this.browser = await chromium.launch({ headless: this.headless });
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
    }
  }

  // Subclasses MUST implement
  async getProductListUrls() {
    throw new Error('getProductListUrls() not implemented');
  }

  async scrapeProductPage(_url) {
    throw new Error('scrapeProductPage() not implemented');
  }

  // Shared utilities
  async navigateWithRetry(page, url, maxRetries = 3) {
    return retry(
      () => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }),
      { maxRetries, delayMs: 2000 }
    );
  }

  async scrollToBottom(page) {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 500;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 200);
      });
    });
    await page.waitForTimeout(1000);
  }

  async safeText(page, selector) {
    try {
      const el = await page.$(selector);
      if (!el) return null;
      return (await el.textContent()).trim();
    } catch {
      return null;
    }
  }

  async safeAttribute(page, selector, attr) {
    try {
      const el = await page.$(selector);
      if (!el) return null;
      return await el.getAttribute(attr);
    } catch {
      return null;
    }
  }

  async safeAllTexts(page, selector) {
    try {
      return await page.$$eval(selector, els => els.map(el => el.textContent.trim()));
    } catch {
      return [];
    }
  }

  delay(ms) {
    return new Promise(r => setTimeout(r, ms || this.delayMs));
  }

  // Main orchestration
  async scrapeAll() {
    await this.init();
    try {
      logger.info(`[${this.brand.name}] Discovering product URLs...`);
      const urls = await this.getProductListUrls();
      logger.info(`[${this.brand.name}] Found ${urls.length} product URLs`);

      const results = [];
      const errors = [];

      for (let i = 0; i < urls.length; i++) {
        try {
          logger.info(`[${this.brand.name}] Scraping ${i + 1}/${urls.length}: ${urls[i]}`);
          const product = await this.scrapeProductPage(urls[i]);
          if (product) {
            results.push(product);
          }
        } catch (err) {
          logger.error(`[${this.brand.name}] Error scraping ${urls[i]}:`, err.message);
          errors.push({ url: urls[i], error: err.message });
        }
        await this.delay();
      }

      logger.info(`[${this.brand.name}] Scrape complete: ${results.length} products, ${errors.length} errors`);
      return { products: results, errors };
    } finally {
      await this.close();
    }
  }
}

module.exports = BaseScraper;
