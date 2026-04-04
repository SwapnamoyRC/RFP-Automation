require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');
const ProductModel = require('../src/models/product.model');

async function importMuutoProducts() {
  try {
    // Read the JSON file
    const jsonPath = path.join(process.env.HOME || process.env.USERPROFILE, 'Downloads', 'muuto_products.json');
    console.log(`Reading products from: ${jsonPath}`);

    if (!fs.existsSync(jsonPath)) {
      console.error(`File not found: ${jsonPath}`);
      process.exit(1);
    }

    const fileContent = fs.readFileSync(jsonPath, 'utf-8');
    const scrapedProducts = JSON.parse(fileContent);
    console.log(`Found ${scrapedProducts.length} products in JSON`);

    // Get Muuto brand ID
    const brandResult = await pool.query(
      "SELECT id FROM brands WHERE slug = 'muuto' LIMIT 1"
    );

    if (brandResult.rows.length === 0) {
      console.error('Muuto brand not found in database');
      process.exit(1);
    }

    const muutoBrandId = brandResult.rows[0].id;
    console.log(`Muuto brand ID: ${muutoBrandId}`);

    // Get existing Muuto products
    const existingResult = await pool.query(
      'SELECT slug FROM products WHERE brand_id = $1',
      [muutoBrandId]
    );

    const existingSlugs = new Set(existingResult.rows.map(p => p.slug));
    console.log(`Found ${existingSlugs.size} existing Muuto products in DB`);

    // Filter new products - only ones with a slug and not already in DB
    const newProducts = scrapedProducts.filter(p => p.slug && !existingSlugs.has(p.slug));
    console.log(`${newProducts.length} new products to add`);

    if (newProducts.length === 0) {
      console.log('No new products to add');
      process.exit(0);
    }

    // Insert new products
    let addedCount = 0;
    let skippedCount = 0;

    for (const product of newProducts) {
      try {
        // Skip if no slug
        if (!product.slug) {
          skippedCount++;
          console.log(`⊘ Skipped "${product.name}" (no slug)`);
          continue;
        }

        const result = await ProductModel.upsert(muutoBrandId, {
          name: product.name,
          slug: product.slug,
          description: product.description,
          dimensions: product.dimensions || '',
          materials: product.materials || '',
          image_url: product.image_url,
          source_url: product.source_url,
          category: product.category,
          designer: product.designer,
          raw_data: product
        });

        if (result.is_new) {
          addedCount++;
          console.log(`+ ${product.name} [${product.slug}]`);
        } else {
          console.log(`~ ${product.name} [${product.slug}] (updated)`);
        }
      } catch (err) {
        console.error(`✗ Error importing product "${product.name}":`, err.message);
      }
    }

    console.log(`\nImport complete:`);
    console.log(`  Added: ${addedCount}`);
    console.log(`  Skipped: ${skippedCount}`);
    console.log(`  Total processed: ${addedCount + skippedCount}`);

    process.exit(0);
  } catch (error) {
    console.error('Import failed:', error.message);
    process.exit(1);
  }
}

importMuutoProducts();
