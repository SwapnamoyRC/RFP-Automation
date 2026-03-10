const BaseScraper = require('./base.scraper');
const logger = require('../../config/logger');
const { slugify } = require('../../utils/text');

class HayScraper extends BaseScraper {
  /**
   * All HAY category sub-pages that contain product links.
   * Product URLs on these pages follow the pattern /hay/.../<product-slug>
   * Some parent categories (tables, sofas) don't render product links in headless
   * mode due to SPA behavior, so we target the deepest sub-category pages.
   */
  getCategoryPages() {
    return [
      // Seating
      { path: '/products/furniture/seating/chairs', category: 'chairs' },
      { path: '/products/furniture/seating/bar-stools', category: 'bar-stools' },
      { path: '/products/furniture/seating/lounge', category: 'lounge' },
      { path: '/products/furniture/seating/sofas', category: 'sofas' },
      { path: '/products/furniture/seating/stools', category: 'stools' },
      { path: '/products/furniture/seating/benches', category: 'benches' },
      // Tables
      { path: '/products/furniture/tables', category: 'tables' },
      { path: '/products/furniture/tables/dining-cafe', category: 'tables' },
      { path: '/products/furniture/tables/coffee-side', category: 'tables' },
      { path: '/products/furniture/tables/conference-high', category: 'tables' },
      { path: '/products/furniture/tables/desks', category: 'desks' },
      // Storage & Shelves
      { path: '/products/furniture/shelves', category: 'storage' },
      { path: '/products/furniture/storage', category: 'storage' },
      // Beds
      { path: '/products/furniture/beds', category: 'beds' },
      // Outdoor
      { path: '/products/furniture/outdoor/seating', category: 'outdoor' },
      { path: '/products/furniture/outdoor/tables', category: 'outdoor' },
      { path: '/products/furniture/outdoor', category: 'outdoor' },
      // Lighting
      { path: '/products/lighting/table', category: 'lighting' },
      { path: '/products/lighting/ceiling', category: 'lighting' },
      { path: '/products/lighting/floor', category: 'lighting' },
      { path: '/products/lighting/wall', category: 'lighting' },
      { path: '/products/lighting/portable-lamps', category: 'lighting' },
      { path: '/products/lighting/shade', category: 'lighting' },
      // Accessories
      { path: '/products/accessories/indoor-living/office', category: 'accessories' },
      { path: '/products/accessories/indoor-living/storage', category: 'accessories' },
      { path: '/products/accessories/indoor-living/mirrors', category: 'accessories' },
      { path: '/products/accessories/indoor-living/home-decor', category: 'accessories' },
      { path: '/products/accessories/indoor-living/vases-plant-pots', category: 'accessories' },
      { path: '/products/accessories/outdoor-living', category: 'accessories' },
    ];
  }

  getCategoryFromUrl(url) {
    if (url.includes('/outdoor-')) return 'outdoor';
    if (url.includes('/chair/') || url.includes('/seating/chair')) return 'chairs';
    if (url.includes('/bar-stool/')) return 'bar-stools';
    if (url.includes('/lounge/')) return 'lounge';
    if (url.includes('/sofa/')) return 'sofas';
    if (url.includes('/stool/')) return 'stools';
    if (url.includes('/bench/')) return 'benches';
    if (url.includes('/table/') || url.includes('/desk/')) return 'tables';
    if (url.includes('/bed/')) return 'beds';
    if (url.includes('/lighting/') || url.includes('/lamp/') || url.includes('/pendant')) return 'lighting';
    if (url.includes('/storage/') || url.includes('/cabinet/') || url.includes('/shelf/') || url.includes('/shelving/')) return 'storage';
    if (url.includes('/coatrack/')) return 'storage';
    return 'other';
  }

  async getProductListUrls() {
    const allProductUrls = new Map(); // url -> category

    for (const { path, category } of this.getCategoryPages()) {
      const page = await this.context.newPage();
      try {
        const fullUrl = `${this.brand.base_url}${path}`;
        logger.info(`[HAY] Scanning category: ${fullUrl}`);

        // Use networkidle for SPA pages that need more time to render
        try {
          await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 30000 });
        } catch {
          // Fallback to domcontentloaded if networkidle times out
          await this.navigateWithRetry(page, fullUrl);
        }
        await page.waitForTimeout(4000);

        // Scroll to load lazy content
        await this.scrollToBottom(page);
        await page.waitForTimeout(2000);

        // Extract product links — HAY product URLs contain /hay/ and do NOT start with /products/
        const productLinks = await page.evaluate((baseUrl) => {
          return [...new Set(
            Array.from(document.querySelectorAll('a[href]'))
              .map(a => {
                try {
                  const url = new URL(a.href);
                  if (url.hostname.includes('hay.com') && url.pathname.startsWith('/hay/')) {
                    return url.origin + url.pathname;
                  }
                } catch {}
                return null;
              })
              .filter(Boolean)
          )];
        }, this.brand.base_url);

        for (const url of productLinks) {
          if (!allProductUrls.has(url)) {
            // Prefer category from URL path, fallback to page category
            allProductUrls.set(url, this.getCategoryFromUrl(url) || category);
          }
        }

        logger.info(`[HAY] Found ${productLinks.length} product links in ${path}`);
      } catch (err) {
        logger.warn(`[HAY] Error scanning ${path}: ${err.message}`);
      } finally {
        await page.close();
      }
    }

    // Store category map for product scraping
    this._categoryMap = allProductUrls;
    const urls = [...allProductUrls.keys()];
    logger.info(`[HAY] Found ${urls.length} unique product URLs total`);
    return urls;
  }

  async scrapeProductPage(url) {
    const page = await this.context.newPage();
    try {
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      } catch {
        await this.navigateWithRetry(page, url);
      }
      await page.waitForTimeout(3000);

      // Extract JSON-LD structured data (HAY has rich Product and ProductModel data)
      const jsonLdData = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        const parsed = scripts.map(s => {
          try { return JSON.parse(s.textContent); } catch { return null; }
        }).filter(Boolean);

        const product = parsed.find(d => d['@type'] === 'Product');
        const variants = parsed.filter(d => d['@type'] === 'ProductModel');
        return { product, variants };
      });

      // Extract product name from JSON-LD or DOM
      const name = jsonLdData.product?.name
        || await this.safeText(page, 'h1')
        || await this.safeText(page, '[data-product-name]');

      if (!name) {
        logger.warn(`[HAY] No product name found at ${url}`);
        return null;
      }

      // Description from JSON-LD or page
      const description = jsonLdData.product?.description
        || await this.safeText(page, '.product-description, .description, [data-product-description]');

      // Image from JSON-LD or DOM
      let imageUrl = null;
      if (jsonLdData.product?.image) {
        const imgPath = jsonLdData.product.image;
        imageUrl = imgPath.startsWith('http') ? imgPath : `${this.brand.base_url}${imgPath}`;
      }
      if (!imageUrl) {
        imageUrl = await page.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll('img[src]'));
          const productImg = imgs.find(img =>
            img.src.includes('globalassets') &&
            !img.src.includes('logo') &&
            !img.src.includes('flag') &&
            !img.src.includes('{{')  // skip template placeholders
          );
          return productImg ? productImg.src : null;
        });
      }

      // Extract page text for spec extraction
      const pageText = await page.evaluate(() => document.body.innerText.substring(0, 4000));

      // Extract designer from page text
      const designer = this.extractDesigner(pageText);

      // Extract dimensions from page text
      const dimensions = this.parseDimensions(pageText);

      // Extract materials from page text
      const materials = this.parseMaterials(pageText);

      // Find PDF / fact sheet link (prefer fact sheets over random PDFs)
      const pdfUrl = await page.evaluate(() => {
        const allLinks = Array.from(document.querySelectorAll('a[href]'));
        // 1. Look for fact sheet / product sheet links
        const factSheet = allLinks.find(a => {
          const text = (a.textContent || '').toLowerCase();
          const href = (a.href || '').toLowerCase();
          return (text.includes('fact sheet') || text.includes('product sheet') || text.includes('data sheet') ||
                  href.includes('fact-sheet') || href.includes('factsheet') || href.includes('product-sheet'));
        });
        if (factSheet) return factSheet.href;
        // 2. Direct PDF link
        const pdfLink = allLinks.find(a => a.href && a.href.endsWith('.pdf'));
        return pdfLink ? pdfLink.href : null;
      });

      // Extract variants from JSON-LD ProductModel data
      const variants = (jsonLdData.variants || []).map(v => ({
        variant_name: v.name || null,
        color: this.extractColor(v.name),
        material: this.extractMaterial(v.name),
        sku: null,
        image_url: v.image ? (v.image.startsWith('http') ? v.image : `${this.brand.base_url}${v.image}`) : null
      }));

      // Category from URL map or URL path
      const category = (this._categoryMap && this._categoryMap.get(url)) || this.getCategoryFromUrl(url);

      return {
        name,
        slug: slugify(name),
        description,
        dimensions,
        materials,
        image_url: imageUrl,
        pdf_url: pdfUrl,
        source_url: url,
        designer,
        category,
        variants,
        raw_data: {
          json_ld: jsonLdData.product || null,
          variant_count: (jsonLdData.variants || []).length,
          page_text: pageText ? pageText.substring(0, 2000) : null
        }
      };
    } finally {
      await page.close();
    }
  }

  parseDimensions(text) {
    if (!text) return null;
    const patterns = [
      /(?:width|height|depth|length|diameter|W|H|D|L|Ø)\s*[:=]\s*[\d.,]+\s*(?:cm|mm|in|")/gi,
      /\d+[\s]*[xX×][\s]*\d+[\s]*(?:[xX×][\s]*\d+)?\s*(?:cm|mm|in)?/g
    ];
    const matches = [];
    for (const pattern of patterns) {
      const found = text.match(pattern);
      if (found) matches.push(...found);
    }
    return matches.length > 0 ? [...new Set(matches)].join('; ') : null;
  }

  parseMaterials(text) {
    if (!text) return null;
    const materialKeywords = /(?:oak|beech|walnut|steel|aluminium|aluminum|plastic|polypropylene|fabric|leather|wood|lacquered|upholster|foam|recycled|veneer|plywood)/gi;
    const matches = text.match(materialKeywords);
    return matches ? [...new Set(matches.map(m => m.toLowerCase()))].join(', ') : null;
  }

  extractDesigner(text) {
    if (!text) return null;
    // Look for "DESIGNER" section header followed by a name
    // HAY pages have the full bio after the name, so extract just the name
    // e.g. "DESIGNER\n\nNiels Jørgen Haugesen (1936-2013) was a leading..."
    const designerMatch = text.match(/DESIGNER\s*\n\s*(.+?)(?:\n|$)/i);
    if (designerMatch) {
      let name = designerMatch[1].trim();
      // Extract just the name: stop at parenthesis, " was ", " is ", or period followed by space
      const nameEnd = name.match(/^(.+?)(?:\s*\(|\s+was\s|\s+is\s|\.\s)/);
      if (nameEnd) name = nameEnd[1].trim();
      // Truncate to 250 chars as safety
      return name.length > 250 ? name.substring(0, 250) : name;
    }

    // Look for "designed by" pattern
    const byMatch = text.match(/designed\s+by\s+(.+?)(?:\.|,|\n)/i);
    if (byMatch) {
      const name = byMatch[1].trim();
      return name.length > 250 ? name.substring(0, 250) : name;
    }

    return null;
  }

  extractColor(variantName) {
    if (!variantName) return null;
    const colorMatch = variantName.match(/-([\w\s]+?)(?:\s+water-based|-None|$)/i);
    return colorMatch ? colorMatch[1].trim() : null;
  }

  extractMaterial(variantName) {
    if (!variantName) return null;
    const matMatch = variantName.match(/(?:lacquered\s+)?(\w+)(?:-None|-\w+)?$/i);
    return matMatch ? matMatch[1].trim() : null;
  }
}

module.exports = HayScraper;
