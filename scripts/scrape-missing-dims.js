require('dotenv').config();
const { chromium } = require('playwright');
const { pool } = require('../src/config/database');
const fs = require('fs');

// The 20 products missing dims in both dev and prod, with their Muuto source URLs
const TARGETS = [
  { name: '70/70 Outdoor Table',           url: 'https://www.muuto.com/product/70-70-Outdoor-Table--p114146/p114146/' },
  { name: 'Adjustable Feet',               url: 'https://www.muuto.com/product/Adjustable-Feet--p33182/p33182/' },
  { name: 'Ceiling Cap',                   url: 'https://www.muuto.com/product/Ceiling-Cap--p33155/p33155/' },
  { name: 'Compile Shelving System Essential Pack', url: 'https://www.muuto.com/product/Compile-Shelving-System-Essential-Pack-p48437/p48437/' },
  { name: 'Connect Modular Sofa 3-Seater - Configuration 4 - Acca 731', url: 'https://www.muuto.com/product/Connect-Modular-Sofa-3-Seater-p19382/x133007/' },
  { name: 'Connect Modular Sofa 6-Seater', url: 'https://www.muuto.com/product/Connect-Modular-Sofa-6-Seater-p133301/p133301/' },
  { name: 'Cover and Visu Chair Transport Trolley', url: 'https://www.muuto.com/product/Transport-Trolley--COVTRO/COVTRO01/' },
  { name: 'Fiber Chair Seat Pad',          url: 'https://www.muuto.com/product/Fiber-Chair-Seat-Pad--p33207/p33207/' },
  { name: 'Fiber Lounge Chair Seat Pad',   url: 'https://www.muuto.com/product/Fiber-Lounge-Chair-Seat-Pad--p33208/p33208/' },
  { name: 'Linear Steel Chair/Lounge Chair Seat Pad', url: 'https://www.muuto.com/product/Linear-Steel-Lounge-Chair-Seat-Pad/' },
  { name: 'Linear Steel Cover Outdoor Cover for Linear Steel Table 140 x 75 CM / 55.1 x 29.5 - 140 x 75 cm', url: 'https://www.muuto.com/product/Linear-Steel-Cover--p24950/30976/' },
  { name: 'Linear System Cable Tray',      url: 'https://www.muuto.com/product/Linear-System-Cable-Tray--p32124/p32124/' },
  { name: 'Linear System Power Configuration', url: 'https://www.muuto.com/product/Linear-System-Power-Configuration--p32128/p32128/' },
  { name: 'Linear System Power Starter Kit',   url: 'https://www.muuto.com/product/Linear-System-Power-Starter-Kit--p90713/p90713/' },
  { name: 'Linear System Table Power Outlet',  url: 'https://www.muuto.com/product/Linear-System-Table-Power-Outlet--p32117/p32117/' },
  { name: 'Midst Power Units',             url: 'https://www.muuto.com/product/Power-Units--PWCENCFG/PWCENCFGUS01V1/' },
  { name: 'Portable Lamp Charging Station', url: 'https://www.muuto.com/product/Lamp-Charging-Station--PLCSEU/PLCSEU01/' },
  { name: 'Power Extension Kit',           url: 'https://www.muuto.com/product/Power-Extension-Kit--p32125/p32125/' }, // guessed — update if wrong
  { name: 'The Dots Metal',               url: 'https://www.muuto.com/product/The-Dots-Metal--p33179/p33179/' },
  { name: 'Tub Jug',                      url: 'https://www.muuto.com/product/Tub-Jug--p33183/p33183/' },
];

// Selectors to try for dimensions on the Muuto product page
async function scrapeDimensions(page) {
  // Try JSON-LD structured data first
  const jsonLd = await page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
    for (const s of scripts) {
      try {
        const d = JSON.parse(s.textContent);
        if (d.height || d.width || d.depth || d.weight) return d;
      } catch {}
    }
    return null;
  });

  // Try accordion/detail sections for dimensions text
  const dimText = await page.evaluate(() => {
    // Look for sections with "Dimensions" heading
    const headings = [...document.querySelectorAll('h2, h3, h4, h5, button, dt, summary')];
    for (const h of headings) {
      if (/dimensions?/i.test(h.textContent)) {
        // Get adjacent/sibling content
        const next = h.nextElementSibling || h.parentElement?.nextElementSibling;
        if (next) return next.textContent.trim();
        return h.parentElement?.textContent?.trim() || null;
      }
    }
    return null;
  });

  // Try product spec table
  const specText = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('table tr, dl dt, [class*="spec"] li')];
    const dims = [];
    for (const row of rows) {
      const text = row.textContent;
      if (/height|width|depth|length|diameter/i.test(text)) {
        dims.push(text.replace(/\s+/g, ' ').trim());
      }
    }
    return dims.length ? dims.join('; ') : null;
  });

  // Try muuto-specific product details section
  const muutoDims = await page.evaluate(() => {
    const allText = document.body.innerText;
    const match = allText.match(/Height[:\s][\d,\.]+\s*cm[^.]*(?:\n[^H][^\n]*)*/) ||
                  allText.match(/(?:H|W|D|L):\s*[\d,\.]+\s*(?:cm|mm)[^\n]*/g);
    if (match) return Array.isArray(match) ? match.join('; ') : match[0];
    return null;
  });

  return dimText || muutoDims || specText;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  const failed = [];

  for (const target of TARGETS) {
    console.log(`\nScraping: ${target.name}`);
    console.log(`  URL: ${target.url}`);

    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });
    const page = await ctx.newPage();

    try {
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(4000);

      const dims = await scrapeDimensions(page);
      if (dims) {
        console.log(`  ✓ Dims: ${dims.substring(0, 80)}`);
        results.push({ ...target, dimensions: dims });
      } else {
        console.log(`  ✗ No dimensions found`);
        failed.push(target);
      }
    } catch (err) {
      console.log(`  ✗ FAILED: ${err.message}`);
      failed.push(target);
    } finally {
      await page.close();
      await ctx.close();
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  await browser.close();

  // Generate SQL for prod and update dev directly
  const lines = [];
  lines.push('-- Missing dimensions patch (scraped from Muuto)');
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push('');

  for (const r of results) {
    const dims = r.dimensions.replace(/\r?\n/g, ' ').trim().replace(/'/g, "''");
    lines.push(`UPDATE products SET dimensions='${dims}' WHERE name='${r.name.replace(/'/g, "''")}';`);
  }

  fs.writeFileSync('scraped-dims-patch.sql', lines.join('\n'));
  console.log(`\n✓ Written scraped-dims-patch.sql (${results.length} products)`);

  // Also update dev DB directly
  if (results.length > 0) {
    console.log('\nUpdating local dev DB...');
    for (const r of results) {
      await pool.query(
        `UPDATE products SET dimensions=$1, updated_at=NOW() WHERE name=$2`,
        [r.dimensions, r.name]
      );
      console.log(`  ✓ Updated dev: ${r.name}`);
    }
  }

  if (failed.length > 0) {
    console.log(`\n✗ Could not scrape ${failed.length} products:`);
    failed.forEach(f => console.log(`  - ${f.name}`));
  }

  console.log(`\nSummary: ${results.length} scraped, ${failed.length} failed`);
  console.log('Run scraped-dims-patch.sql in DBeaver against prod.');

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
