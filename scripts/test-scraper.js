require('dotenv').config();
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  console.log('Navigating to naughtone.com/products/...');
  await page.goto('https://www.naughtone.com/products/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  await page.waitForTimeout(3000);

  const title = await page.title();
  console.log('Page title:', title);

  // Get all links on the page
  const allLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.href);
  });
  console.log('Total links on page:', allLinks.length);

  // Filter for product links
  const productLinks = allLinks.filter(href => {
    try {
      const path = new URL(href).pathname;
      return path.startsWith('/products/') &&
        path !== '/products/' &&
        /^\/products\/[a-z0-9-]+\/?$/.test(path);
    } catch {
      return false;
    }
  });

  const unique = [...new Set(productLinks)];
  console.log('Product page links:', unique.length);
  console.log('Sample links:', unique.slice(0, 10));

  // If no product links found, dump some page content for debugging
  if (unique.length === 0) {
    console.log('\nAll /products/ links:');
    const prodLinks = allLinks.filter(h => h.includes('/products/'));
    console.log(prodLinks.slice(0, 20));

    console.log('\nPage HTML snippet (first 2000 chars):');
    const html = await page.content();
    console.log(html.substring(0, 2000));
  }

  await browser.close();
  console.log('\nDone!');
})().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
