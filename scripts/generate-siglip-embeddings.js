/**
 * Generate SigLIP image embeddings for all products with image_url but no embedding.
 *
 * SigLIP is an open-source vision model (runs locally, FREE).
 * Generates 768-dimensional image embeddings directly from URLs.
 *
 * Usage:
 *   node --require sharp scripts/generate-siglip-embeddings.js
 *   node --require sharp scripts/generate-siglip-embeddings.js --brand=muuto
 *   node --require sharp scripts/generate-siglip-embeddings.js --dry-run
 */

require('dotenv').config();
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');
const { toSql } = require('pgvector/pg');
const siglipService = require('../src/services/siglip-embedding.service');
const logger = require('../src/config/logger');

const args = process.argv.slice(2);
const BRAND_FILTER = args.find(a => a.startsWith('--brand='))?.split('=')[1] || null;
const DRY_RUN = args.includes('--dry-run');

/**
 * Download image from URL
 */
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, { timeout: 10000 }, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      let data = Buffer.alloc(0);
      response.on('data', chunk => {
        data = Buffer.concat([data, chunk]);
      });

      response.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function generateSigLIPEmbeddings() {
  try {
    console.log('\n=== SigLIP Image Embedding Generator ===\n');
    if (DRY_RUN) console.log('DRY RUN MODE\n');

    // Get products with image_url but no siglip_embedding
    let query = `
      SELECT p.id, p.name, p.image_url, b.name as brand_name, b.slug as brand_slug
      FROM products p
      JOIN brands b ON b.id = p.brand_id
      WHERE p.image_url IS NOT NULL
        AND p.image_url != ''
        AND p.siglip_embedding IS NULL
      ORDER BY b.name, p.name
    `;

    if (BRAND_FILTER) {
      query = query.replace(
        'ORDER BY',
        `AND b.slug = '${BRAND_FILTER}' ORDER BY`
      );
    }

    const { rows: products } = await pool.query(query);

    console.log(`Found ${products.length} products needing SigLIP embeddings`);
    if (BRAND_FILTER) console.log(`Filter: brand=${BRAND_FILTER}`);
    console.log();

    if (products.length === 0) {
      console.log('✅ All products have embeddings!');
      process.exit(0);
    }

    let success = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const progress = `[${i + 1}/${products.length}]`;

      try {
        // Download image
        let imageBuffer;
        try {
          imageBuffer = await downloadImage(product.image_url);
        } catch (err) {
          console.log(`${progress} ${product.brand_name.padEnd(15)} ${product.name.padEnd(50)} ❌ Download failed: ${err.message}`);
          failed++;
          continue;
        }

        if (!imageBuffer || imageBuffer.length === 0) {
          console.log(`${progress} ${product.brand_name.padEnd(15)} ${product.name.padEnd(50)} ⊘ Empty image`);
          skipped++;
          continue;
        }

        // Generate embedding
        const embedding = await siglipService.getImageEmbeddingFromBuffer(imageBuffer);

        if (!DRY_RUN) {
          // Store in database
          await pool.query(
            `UPDATE products SET siglip_embedding = $1, updated_at = NOW() WHERE id = $2`,
            [toSql(embedding), product.id]
          );
        }

        success++;
        console.log(`${progress} ${product.brand_name.padEnd(15)} ${product.name.padEnd(50)} ✓`);

        // Rate limiting
        if ((success + failed) % 10 === 0) {
          await new Promise(r => setTimeout(r, 500));
        }

      } catch (err) {
        failed++;
        console.log(`${progress} ${product.brand_name.padEnd(15)} ${product.name.padEnd(50)} ✗ ${err.message}`);
      }
    }

    console.log('\n========================================');
    console.log('SigLIP embedding generation complete!');
    console.log(`  Generated: ${success}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  Skipped: ${skipped}`);
    console.log('========================================\n');

    process.exit(0);

  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

generateSigLIPEmbeddings();
