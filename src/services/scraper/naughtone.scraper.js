const BaseScraper = require('./base.scraper');
const logger = require('../../config/logger');
const { slugify } = require('../../utils/text');

class NaughtoneScraper extends BaseScraper {
  /**
   * Category CSS class to clean category name mapping.
   * NaughtOne uses CSS classes like "cat-soft-seating" on product tiles.
   */
  static CATEGORY_MAP = {
    'soft-seating': 'sofas',
    'chairs': 'chairs',
    'tables': 'tables',
    'low-tables': 'tables',
    'stools': 'stools',
    'modular-seating': 'sofas',
    'storage': 'storage',
    'booths': 'booths',
    'task-table': 'tables',
    'desk': 'desks',
  };

  async getProductListUrls() {
    const page = await this.context.newPage();
    try {
      const fullUrl = `${this.brand.base_url}/products/`;
      logger.info(`[NaughtOne] Scanning product listing: ${fullUrl}`);
      await this.navigateWithRetry(page, fullUrl);
      await page.waitForTimeout(3000);

      // Multi-cycle scroll to load all lazy-loaded products
      let previousHeight = 0;
      for (let i = 0; i < 15; i++) {
        await this.scrollToBottom(page);
        await page.waitForTimeout(2000);
        const currentHeight = await page.evaluate(() => document.body.scrollHeight);
        const productCount = await page.evaluate(() => document.querySelectorAll('.col-product-index-item').length);
        logger.info(`[NaughtOne] Scroll ${i + 1}: height=${currentHeight}, products found=${productCount}`);
        if (currentHeight === previousHeight) break;
        previousHeight = currentHeight;
      }

      // Extract products with their categories from CSS classes
      // Each product tile has class like "col-product-index-item cat-soft-seating"
      const productsWithCategories = await page.evaluate(() => {
        const items = document.querySelectorAll('.col-product-index-item');
        const productMap = {};

        for (const item of items) {
          const link = item.querySelector('a[href*="/products/"]');
          if (!link) continue;

          try {
            const url = new URL(link.href);
            const path = url.pathname;
            if (!path.startsWith('/products/') || path === '/products/' ||
                path.includes('cookie') || !path.match(/^\/products\/[a-z0-9-]+\/?$/)) {
              continue;
            }

            const fullUrl = url.origin + path;
            // Don't overwrite if already found (keep first category)
            if (productMap[fullUrl]) continue;

            // Extract category from CSS class like "cat-soft-seating"
            const catMatch = item.className.match(/cat-([a-z-]+)/);
            const category = catMatch ? catMatch[1] : 'other';

            productMap[fullUrl] = category;
          } catch {}
        }

        return productMap;
      });

      // Store category map for later use
      this._categoryMap = {};
      const urls = [];
      for (const [url, cat] of Object.entries(productsWithCategories)) {
        this._categoryMap[url] = cat;
        urls.push(url);
      }

      logger.info(`[NaughtOne] Found ${urls.length} unique product URLs`);

      // Log category breakdown
      const catCounts = {};
      Object.values(this._categoryMap).forEach(cat => {
        catCounts[cat] = (catCounts[cat] || 0) + 1;
      });
      logger.info(`[NaughtOne] Category breakdown: ${JSON.stringify(catCounts)}`);

      return urls;
    } finally {
      await page.close();
    }
  }

  getCategory(url) {
    // Look up from our scraped category map
    const rawCat = this._categoryMap?.[url];
    if (rawCat && NaughtoneScraper.CATEGORY_MAP[rawCat]) {
      return NaughtoneScraper.CATEGORY_MAP[rawCat];
    }
    if (rawCat) return rawCat;
    return 'other';
  }

  async scrapeProductPage(url) {
    const page = await this.context.newPage();
    try {
      await this.navigateWithRetry(page, url);
      await page.waitForTimeout(2000);

      // Scroll to load all content
      await this.scrollToBottom(page);
      await page.waitForTimeout(1000);

      // Extract product name
      const name = await this.safeText(page, 'h1')
        || await this.safeText(page, '.product-title, [data-product-name]');

      if (!name) {
        logger.warn(`[NaughtOne] No product name found at ${url}`);
        return null;
      }

      // Extract subtitle / product type (e.g., "Lounge Chair", "Sofa", "Coffee Table")
      const subtitle = await page.evaluate(() => {
        const h1 = document.querySelector('h1');
        if (!h1) return null;
        // Look for text immediately after h1 or sibling element
        const sibling = h1.nextElementSibling;
        if (sibling && sibling.textContent.trim().length < 50) {
          return sibling.textContent.trim();
        }
        return null;
      });

      // Extract description
      const description = await this.safeText(page, '.product-description, .description, .entry-content p');

      // Extended description from page content
      if (!description) {
        const fallbackDesc = await page.evaluate(() => {
          const ps = document.querySelectorAll('p');
          for (const p of ps) {
            const text = p.textContent.trim();
            if (text.length > 50 && text.length < 1000 &&
                !text.includes('cookie') && !text.includes('Cookie') &&
                !text.includes('privacy') && !text.includes('©')) {
              return text;
            }
          }
          return null;
        });
        if (fallbackDesc) {
          // Use fallbackDesc but don't reassign const
          var descriptionText = fallbackDesc;
        }
      }

      // Extract designer
      const designer = await this.safeText(page, '.designer, .product-designer');

      // Extract hero image (skip logos and loading gifs)
      const imageUrl = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img[src]'));
        const hero = imgs.find(img =>
          img.src.includes('/uploads/') &&
          !img.src.includes('logo') &&
          !img.src.includes('loading') &&
          !img.src.includes('.svg')
        );
        return hero ? hero.src : null;
      });

      // Extract dimensions from spec table
      const dimensions = await this.extractDimensions(page);

      // Extract materials
      const materials = await this.extractMaterials(page);

      // Extract weight
      const weight = await this.extractWeight(page);

      // Extract certifications
      const certifications = await this.extractCertifications(page);

      // Extract sustainability data
      const sustainability = await this.extractSustainability(page);

      // Find PDF spec sheet
      const pdfUrl = await this.findPdfLink(page);

      // Extract variants
      const variants = await this.extractVariants(page);

      // Get category from our category map
      const category = this.getCategory(url);

      const fullName = subtitle ? `${name} ${subtitle}` : name;

      return {
        name: fullName,
        slug: slugify(fullName),
        description: description || descriptionText || null,
        dimensions,
        materials,
        weight,
        certifications,
        sustainability,
        image_url: imageUrl,
        pdf_url: pdfUrl,
        source_url: url,
        designer,
        category,
        variants,
        raw_data: null
      };
    } finally {
      await page.close();
    }
  }

  async extractDimensions(page) {
    try {
      // NaughtOne has spec tables with variant-specific dimensions
      const tableData = await page.$$eval('table tr, .spec-row, .dimensions-row', rows =>
        rows.map(row => {
          const cells = row.querySelectorAll('td, th');
          return Array.from(cells).map(c => c.textContent.trim());
        }).filter(r => r.length > 0)
      );

      if (tableData.length > 0) {
        return tableData.map(row => row.join(' | ')).join('\n');
      }

      // Fallback: try text content with dimension keywords
      const dimText = await page.$$eval('*', els => {
        for (const el of els) {
          const text = el.textContent;
          if (text && text.match(/\d+\s*(?:mm|cm)\s*(?:x|\|)\s*\d+/i) && text.length < 200) {
            return text.trim();
          }
        }
        return null;
      });

      return dimText;
    } catch {
      return null;
    }
  }

  async extractMaterials(page) {
    try {
      const materialsText = await page.$$eval('*', els => {
        for (const el of els) {
          const text = el.textContent;
          if (text && text.match(/\d+\.?\d*%/) && text.match(/foam|steel|wood|plywood|fabric/i) && text.length < 500) {
            return text.trim();
          }
        }
        return null;
      });
      return materialsText;
    } catch {
      return null;
    }
  }

  async extractWeight(page) {
    try {
      const weight = await page.$$eval('*', els => {
        for (const el of els) {
          const match = el.textContent.match(/(\d+\.?\d*)\s*kg/i);
          if (match && el.children.length === 0) {
            return match[0];
          }
        }
        return null;
      });
      return weight;
    } catch {
      return null;
    }
  }

  async extractCertifications(page) {
    try {
      const certs = await page.$$eval('*', els => {
        const found = [];
        for (const el of els) {
          const matches = el.textContent.match(/(?:BS EN|ANSI|BIFMA|ISO)\s*[\d:.-]+/g);
          if (matches && el.children.length === 0) {
            found.push(...matches);
          }
        }
        return [...new Set(found)];
      });
      return certs.length > 0 ? certs.join(', ') : null;
    } catch {
      return null;
    }
  }

  async extractSustainability(page) {
    try {
      const data = await page.$$eval('*', els => {
        for (const el of els) {
          const text = el.textContent;
          if (text && text.match(/recyclable|recycled content|co2/i) && text.length < 500) {
            return text.trim();
          }
        }
        return null;
      });
      return data;
    } catch {
      return null;
    }
  }

  async findPdfLink(page) {
    try {
      // Look for product sheet PDFs
      const pdfLinks = await page.$$eval('a[href$=".pdf"]', els =>
        els.map(el => ({
          href: el.href,
          text: el.textContent.trim()
        }))
      );

      // Prefer product_sheet links
      const productSheet = pdfLinks.find(l =>
        l.href.includes('product_sheet') || l.text.toLowerCase().includes('product sheet')
      );
      if (productSheet) return productSheet.href;

      // Fall back to first PDF
      return pdfLinks.length > 0 ? pdfLinks[0].href : null;
    } catch {
      return null;
    }
  }

  async extractVariants(page) {
    try {
      // NaughtOne has base styles, RAL colors, wood finishes
      const variants = [];

      // Try to extract base style options
      const baseStyles = await this.safeAllTexts(page,
        '.base-option, .variant-option, [data-base-style], .option-item');
      for (const style of baseStyles) {
        if (style) {
          variants.push({ variant_name: style, material: 'base style' });
        }
      }

      return variants;
    } catch {
      return [];
    }
  }
}

module.exports = NaughtoneScraper;
