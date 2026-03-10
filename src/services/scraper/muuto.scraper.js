const BaseScraper = require('./base.scraper');
const logger = require('../../config/logger');
const { slugify } = require('../../utils/text');

class MuutoScraper extends BaseScraper {
  // Main category pages to scan for sub-categories
  getTopCategoryUrls() {
    return [
      '/products/seating/',
      '/products/sofas/',
      '/products/tables/',
      '/products/storage/',
      '/products/lighting/',
      '/products/accessories/',
      '/products/outdoor/'
    ];
  }

  getCategoryFromUrl(url) {
    if (url.includes('/seating/')) return 'chairs';
    if (url.includes('/sofas/') || url.includes('/lounge-chairs/') || url.includes('/poufs/') || url.includes('/daybeds/')) return 'sofas';
    if (url.includes('/tables/')) return 'tables';
    if (url.includes('/storage/')) return 'storage';
    if (url.includes('/lighting/')) return 'lighting';
    if (url.includes('/accessories/')) return 'accessories';
    if (url.includes('/outdoor/')) return 'outdoor';
    return 'other';
  }

  async getProductListUrls() {
    const allProductUrls = new Map(); // url -> category

    for (const categoryPath of this.getTopCategoryUrls()) {
      const page = await this.context.newPage();
      try {
        const fullUrl = `${this.brand.base_url}${categoryPath}`;
        logger.info(`[Muuto] Scanning category: ${fullUrl}`);
        await this.navigateWithRetry(page, fullUrl);
        await page.waitForTimeout(4000);

        // Scroll to load lazy content
        await this.scrollToBottom(page);
        await page.waitForTimeout(2000);

        // Extract product tile links - these use /product/ (singular) URL pattern
        const tileLinks = await page.evaluate(() => {
          const tiles = document.querySelectorAll('.product-tile a[href*="/product/"]');
          return Array.from(tiles).map(a => a.href).filter(href =>
            href.includes('/product/') && !href.includes('cookienotice')
          );
        });

        const category = this.getCategoryFromUrl(categoryPath);
        tileLinks.forEach(url => {
          if (!allProductUrls.has(url)) {
            allProductUrls.set(url, category);
          }
        });

        logger.info(`[Muuto] Found ${tileLinks.length} product tiles in ${categoryPath}`);

        // ALWAYS scan sub-category pages to find size/variant products
        // (e.g., /products/sofas/2-seater/ has different products than /products/sofas/)
        {
          const subCatLinks = await page.evaluate((base) => {
            const links = document.querySelectorAll('a[href]');
            return Array.from(links)
              .map(a => a.href)
              .filter(href => {
                try {
                  const path = new URL(href).pathname;
                  const segments = path.split('/').filter(Boolean);
                  return segments.length >= 3 &&
                    segments[0] === 'products' &&
                    !path.includes('cookienotice') &&
                    href.startsWith(base) &&
                    href !== base + categoryPath;  // skip self
                } catch { return false; }
              });
          }, this.brand.base_url);

          const uniqueSubCats = [...new Set(subCatLinks)];
          logger.info(`[Muuto] Found ${uniqueSubCats.length} sub-categories in ${categoryPath}`);

          for (const subCatUrl of uniqueSubCats) {
            const subPage = await this.context.newPage();
            try {
              logger.info(`[Muuto] Scanning sub-category: ${subCatUrl}`);
              await this.navigateWithRetry(subPage, subCatUrl);
              await subPage.waitForTimeout(4000);
              await this.scrollToBottom(subPage);
              await subPage.waitForTimeout(1000);

              const subTileLinks = await subPage.evaluate(() => {
                const tiles = document.querySelectorAll('.product-tile a[href*="/product/"]');
                return Array.from(tiles).map(a => a.href).filter(href =>
                  href.includes('/product/') && !href.includes('cookienotice')
                );
              });

              const subCategory = this.getCategoryFromUrl(subCatUrl);
              subTileLinks.forEach(url => {
                if (!allProductUrls.has(url)) {
                  allProductUrls.set(url, subCategory);
                }
              });

              logger.info(`[Muuto] Found ${subTileLinks.length} product tiles in sub-category`);
            } catch (err) {
              logger.warn(`[Muuto] Error scanning sub-category ${subCatUrl}: ${err.message}`);
            } finally {
              await subPage.close();
            }
          }
        }
      } catch (err) {
        logger.error(`[Muuto] Error scanning ${categoryPath}:`, err.message);
      } finally {
        await page.close();
      }
    }

    // Store the category map for later use during scraping
    this._categoryMap = allProductUrls;
    const urls = [...allProductUrls.keys()];
    logger.info(`[Muuto] Found ${urls.length} unique product URLs total`);
    return urls;
  }

  async scrapeProductPage(url) {
    const page = await this.context.newPage();
    try {
      await this.navigateWithRetry(page, url);
      await page.waitForTimeout(4000);

      // Extract product name - Muuto uses a specific structure
      // The product name is typically in an h3 or a specific product-name element
      const nameData = await page.evaluate(() => {
        // Try product line section first
        const productLine = document.querySelector('.product-line__product-name, .product-configurator__name');
        if (productLine) return productLine.textContent.trim();

        // Try to find product name near the price/configurator area
        const mainContent = document.querySelector('.product-page, .pdp, [class*="product-detail"]');
        if (mainContent) {
          const h3s = mainContent.querySelectorAll('h3');
          for (const h3 of h3s) {
            const text = h3.textContent.trim();
            if (text.length > 2 && text.length < 100 &&
                !text.includes('Explore') && !text.includes('Related') &&
                !text.includes('More') && !text.includes('Contract')) {
              return text;
            }
          }
        }

        // Fallback: get product name from page title
        const title = document.title;
        if (title && title.includes('|')) {
          return title.split('|')[0].trim();
        }

        // Fallback: first meaningful h3 on the page (skip nav/menu h3s)
        const allH3s = document.querySelectorAll('h3');
        for (const h3 of allH3s) {
          const text = h3.textContent.trim();
          const rect = h3.getBoundingClientRect();
          // Must be visible and in the main content area
          if (rect.top > 100 && rect.top < 800 && text.length > 2 && text.length < 80 &&
              !text.includes('Explore') && !text.includes('Contract') &&
              !text.includes('No product') && !text.includes('newsletter')) {
            return text;
          }
        }

        return null;
      });

      if (!nameData) {
        logger.warn(`[Muuto] No product name found at ${url}`);
        return null;
      }

      // Also get the base/variant subtitle
      const subtitle = await page.evaluate(() => {
        // Try multiple selectors for variant name
        const selectors = [
          '.product-line__variant-name',
          '.product-configurator__variant',
          '.product-configurator__variant-name',
          '[class*="variant-name"]',
          '[class*="product-variant"]'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const text = el.textContent.trim();
            if (text && text.length < 100) return text;
          }
        }
        return null;
      });

      // If no subtitle found from DOM, extract variant info from URL
      // e.g., "Oslo-Sofa-2-Seater-p2358" → compare with nameData "Oslo Sofa" → extract "2 Seater"
      let urlVariant = null;
      if (!subtitle) {
        const urlMatch = url.match(/\/product\/(.+?)(?:-p\d+)/);
        if (urlMatch) {
          const urlName = urlMatch[1].replace(/-/g, ' ').trim();
          // If URL name is longer than extracted name, the extra part is the variant
          const nameNorm = nameData.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
          const urlNorm = urlName.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
          if (urlNorm.length > nameNorm.length && urlNorm.startsWith(nameNorm)) {
            urlVariant = urlName.substring(nameData.replace(/[^a-zA-Z0-9\s]/g, '').length).trim();
            if (urlVariant) {
              // Capitalize each word
              urlVariant = urlVariant.replace(/\b\w/g, c => c.toUpperCase());
              logger.info(`[Muuto] Extracted variant from URL: "${nameData}" + "${urlVariant}"`);
            }
          }
        }
      }

      const variantSuffix = subtitle || urlVariant;
      const fullName = variantSuffix ? `${nameData} ${variantSuffix}` : nameData;

      // Click "Product information" to expand specs
      await page.evaluate(() => {
        const buttons = document.querySelectorAll('button.accordion__trigger');
        for (const btn of buttons) {
          if (btn.textContent.trim() === 'Product information') {
            btn.click();
            break;
          }
        }
      });
      await page.waitForTimeout(1000);

      // Extract product info content
      const productInfo = await page.evaluate(() => {
        const sections = document.querySelectorAll('.accordion');
        for (const section of sections) {
          const trigger = section.querySelector('.accordion__trigger');
          if (trigger && trigger.textContent.trim() === 'Product information') {
            const content = section.querySelector('.accordion__content');
            return content ? content.textContent.trim() : null;
          }
        }
        return null;
      });

      // Click "Material information" to expand
      await page.evaluate(() => {
        const buttons = document.querySelectorAll('button.accordion__trigger');
        for (const btn of buttons) {
          if (btn.textContent.trim() === 'Material information') {
            btn.click();
            break;
          }
        }
      });
      await page.waitForTimeout(1000);

      const materialInfo = await page.evaluate(() => {
        const sections = document.querySelectorAll('.accordion');
        for (const section of sections) {
          const trigger = section.querySelector('.accordion__trigger');
          if (trigger && trigger.textContent.trim() === 'Material information') {
            const content = section.querySelector('.accordion__content');
            return content ? content.textContent.trim() : null;
          }
        }
        return null;
      });

      // Click "Certificates and tests"
      await page.evaluate(() => {
        const buttons = document.querySelectorAll('button.accordion__trigger');
        for (const btn of buttons) {
          if (btn.textContent.trim() === 'Certificates and tests') {
            btn.click();
            break;
          }
        }
      });
      await page.waitForTimeout(1000);

      const certInfo = await page.evaluate(() => {
        const sections = document.querySelectorAll('.accordion');
        for (const section of sections) {
          const trigger = section.querySelector('.accordion__trigger');
          if (trigger && trigger.textContent.trim() === 'Certificates and tests') {
            const content = section.querySelector('.accordion__content');
            return content ? content.textContent.trim() : null;
          }
        }
        return null;
      });

      // Extract description
      const description = await page.evaluate(() => {
        const el = document.querySelector('.usp-spot__description, .product-description, [class*="product-text"]');
        if (el) return el.textContent.trim();

        // Try from the product info section
        const descEl = document.querySelector('[class*="product-desc"]');
        return descEl ? descEl.textContent.trim() : null;
      });

      // Extract designer
      const designer = await page.evaluate(() => {
        const tiles = document.querySelectorAll('.product-tile__master-label');
        if (tiles.length > 0) return tiles[0].textContent.trim();

        // Look in the page for designer name
        const designerEl = document.querySelector('[class*="designer"]');
        if (designerEl) {
          const text = designerEl.textContent.trim();
          if (text.length < 100) return text;
        }
        return null;
      });

      // Extract main product image
      const imageUrl = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img[src]'));
        const productImg = imgs.find(img =>
          img.src.includes('digitalassets') &&
          !img.src.includes('logo') &&
          !img.src.includes('flag') &&
          img.naturalWidth > 100
        );
        return productImg ? productImg.src : null;
      });

      // Extract PDF / fact sheet link
      // Muuto has: direct PDF links, digitalshowroom downloads, and "Download product fact sheet" buttons
      const pdfUrl = await page.evaluate(() => {
        // 1. Look for fact sheet / product sheet links specifically
        const allLinks = Array.from(document.querySelectorAll('a[href]'));
        const factSheetLink = allLinks.find(a => {
          const text = (a.textContent || '').toLowerCase();
          const href = (a.href || '').toLowerCase();
          return (text.includes('fact sheet') || text.includes('product sheet') || text.includes('data sheet') ||
                  href.includes('fact-sheet') || href.includes('factsheet') || href.includes('product-sheet'));
        });
        if (factSheetLink) return factSheetLink.href;

        // 2. Look for direct PDF links
        const pdfLink = allLinks.find(a => a.href && a.href.endsWith('.pdf'));
        if (pdfLink) return pdfLink.href;

        // 3. Look for digitalshowroom download links
        const dsLink = allLinks.find(a => a.href && a.href.includes('digitalshowroom'));
        if (dsLink) return dsLink.href;

        return null;
      });

      // Parse dimensions from product info
      const dimensions = this.parseDimensions(productInfo);

      // Parse materials
      const materials = materialInfo ? materialInfo.substring(0, 500) : null;

      // Parse certifications
      const certifications = certInfo ? certInfo.substring(0, 500) : null;

      // Get category from our URL map
      const category = (this._categoryMap && this._categoryMap.get(url)) || this.getCategoryFromUrl(url);

      return {
        name: fullName,
        slug: slugify(fullName),
        description: description || (productInfo ? productInfo.substring(0, 500) : null),
        dimensions,
        materials,
        image_url: imageUrl,
        pdf_url: pdfUrl,
        source_url: url,
        designer,
        category,
        certifications,
        variants: [],
        raw_data: {
          product_info: productInfo ? productInfo.substring(0, 2000) : null,
          material_info: materialInfo ? materialInfo.substring(0, 2000) : null,
          cert_info: certInfo ? certInfo.substring(0, 1000) : null
        }
      };
    } finally {
      await page.close();
    }
  }

  parseDimensions(text) {
    if (!text) return null;
    // Look for dimension patterns like "Width: 52 cm" or "H: 78 cm" or "52 x 36 cm"
    const patterns = [
      /(?:width|height|depth|length|diameter|W|H|D|L|Ø)\s*[:=]\s*[\d.,]+\s*(?:cm|mm|in|")/gi,
      /\d+[\s]*[xX×][\s]*\d+[\s]*(?:[xX×][\s]*\d+)?\s*(?:cm|mm|in)?/g
    ];

    const matches = [];
    for (const pattern of patterns) {
      const found = text.match(pattern);
      if (found) matches.push(...found);
    }

    return matches.length > 0 ? matches.join('; ') : null;
  }
}

module.exports = MuutoScraper;
