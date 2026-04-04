/**
 * Regenerate ALL embeddings after upgrading to text-embedding-3-large (3072 dims).
 *
 * Steps:
 *   1. Run migration 013 (truncate + alter vector columns)
 *   2. Regenerate legacy product_embeddings (product_description, product_name, image_description)
 *   3. Regenerate product_family_embeddings (family_description, image_description, search_optimized)
 *
 * Usage: node scripts/regenerate-all-embeddings.js
 *        node scripts/regenerate-all-embeddings.js --skip-migration
 *        node scripts/regenerate-all-embeddings.js --families-only
 *        node scripts/regenerate-all-embeddings.js --legacy-only
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');
const openaiConfig = require('../src/config/openai');
const { toSql } = require('pgvector/pg');

const args = process.argv.slice(2);
const SKIP_MIGRATION = args.includes('--skip-migration');
const FAMILIES_ONLY = args.includes('--families-only');
const LEGACY_ONLY = args.includes('--legacy-only');

console.log(`Embedding model: ${openaiConfig.EMBEDDING_MODEL}`);
console.log(`Embedding dimensions: ${openaiConfig.EMBEDDING_DIMENSIONS}\n`);

async function generateBatch(texts) {
  const truncated = texts.map(t => t.slice(0, 32000));
  const response = await openaiConfig.openai.embeddings.create({
    model: openaiConfig.EMBEDDING_MODEL,
    input: truncated,
    dimensions: openaiConfig.EMBEDDING_DIMENSIONS
  });
  return response.data.map(d => d.embedding);
}

async function withRetry(fn, label) {
  try {
    return await fn();
  } catch (err) {
    if (err.message && (err.message.includes('429') || err.message.includes('rate'))) {
      console.log(`  [${label}] Rate limited, waiting 30s...`);
      await new Promise(r => setTimeout(r, 30000));
      return await fn();
    }
    throw err;
  }
}

// Step 1: Migration
async function runMigration() {
  if (SKIP_MIGRATION) { console.log('Skipping migration\n'); return; }
  console.log('=== Running migration 013 ===');
  const sql = fs.readFileSync(
    path.join(__dirname, '../src/db/migrations/013_upgrade_embedding_dimensions.sql'), 'utf-8'
  );
  await pool.query(sql);
  console.log('Done: vector columns upgraded to 3072\n');
}

// Step 2: Legacy product embeddings
async function regenerateLegacy() {
  console.log('=== Regenerating legacy product embeddings ===\n');

  const { rows: products } = await pool.query(`
    SELECT p.id, p.name, p.description, p.category, p.designer,
           p.dimensions, p.materials, p.weight, p.certifications,
           p.image_description, p.pdf_text, b.name AS brand_name
    FROM products p JOIN brands b ON b.id = p.brand_id ORDER BY b.name, p.name
  `);
  const { rows: allVariants } = await pool.query(`SELECT product_id, variant_name FROM product_variants`);
  const varMap = {};
  for (const v of allVariants) {
    if (!varMap[v.product_id]) varMap[v.product_id] = [];
    varMap[v.product_id].push(v.variant_name);
  }

  console.log(`${products.length} products to process\n`);
  const BATCH = 100;

  // product_name
  console.log('--- product_name ---');
  for (let i = 0; i < products.length; i += BATCH) {
    const batch = products.slice(i, i + BATCH);
    const texts = batch.map(p => `${p.brand_name} ${p.name}`);
    const embs = await withRetry(() => generateBatch(texts), 'name');
    for (let j = 0; j < batch.length; j++) {
      await pool.query(
        `INSERT INTO product_embeddings (product_id, embedding_type, embedding, input_text, model)
         VALUES ($1, 'product_name', $2, $3, $4)
         ON CONFLICT (product_id, embedding_type) DO UPDATE SET embedding=$2, input_text=$3, model=$4, created_at=NOW()`,
        [batch[j].id, toSql(embs[j]), texts[j], openaiConfig.EMBEDDING_MODEL]
      );
    }
    console.log(`  ${Math.min(i + BATCH, products.length)}/${products.length}`);
  }

  // product_description
  console.log('--- product_description ---');
  for (let i = 0; i < products.length; i += BATCH) {
    const batch = products.slice(i, i + BATCH);
    const texts = batch.map(p => {
      const vars = varMap[p.id] || [];
      return [
        `Brand: ${p.brand_name}`, `Product: ${p.name}`,
        p.description ? `Description: ${p.description}` : null,
        p.category ? `Category: ${p.category}` : null,
        p.designer ? `Designer: ${p.designer}` : null,
        p.dimensions ? `Dimensions: ${p.dimensions}` : null,
        p.materials ? `Materials: ${p.materials}` : null,
        p.weight ? `Weight: ${p.weight}` : null,
        p.certifications ? `Certifications: ${p.certifications}` : null,
        vars.length > 0 ? `Variants: ${vars.filter(Boolean).join(', ')}` : null
      ].filter(Boolean).join('\n');
    });
    const embs = await withRetry(() => generateBatch(texts), 'desc');
    for (let j = 0; j < batch.length; j++) {
      await pool.query(
        `INSERT INTO product_embeddings (product_id, embedding_type, embedding, input_text, model)
         VALUES ($1, 'product_description', $2, $3, $4)
         ON CONFLICT (product_id, embedding_type) DO UPDATE SET embedding=$2, input_text=$3, model=$4, created_at=NOW()`,
        [batch[j].id, toSql(embs[j]), texts[j], openaiConfig.EMBEDDING_MODEL]
      );
    }
    console.log(`  ${Math.min(i + BATCH, products.length)}/${products.length}`);
  }

  // image_description
  const withImg = products.filter(p => p.image_description);
  console.log(`--- image_description (${withImg.length} products) ---`);
  for (let i = 0; i < withImg.length; i += BATCH) {
    const batch = withImg.slice(i, i + BATCH);
    const texts = batch.map(p => p.image_description);
    const embs = await withRetry(() => generateBatch(texts), 'img');
    for (let j = 0; j < batch.length; j++) {
      await pool.query(
        `INSERT INTO product_embeddings (product_id, embedding_type, embedding, input_text, model)
         VALUES ($1, 'image_description', $2, $3, $4)
         ON CONFLICT (product_id, embedding_type) DO UPDATE SET embedding=$2, input_text=$3, model=$4, created_at=NOW()`,
        [batch[j].id, toSql(embs[j]), texts[j], openaiConfig.EMBEDDING_MODEL]
      );
    }
    console.log(`  ${Math.min(i + BATCH, withImg.length)}/${withImg.length}`);
  }

  // pdf_content + full_spec
  const withPdf = products.filter(p => p.pdf_text);
  if (withPdf.length > 0) {
    console.log(`--- pdf_content + full_spec (${withPdf.length} products) ---`);
    for (let i = 0; i < withPdf.length; i += 20) {
      const batch = withPdf.slice(i, i + 20);
      const pdfTexts = batch.map(p => p.pdf_text);
      const fullTexts = batch.map(p => `Brand: ${p.brand_name}\nProduct: ${p.name}\n${p.description || ''}\n\nSpec Sheet:\n${p.pdf_text}`);
      const pdfEmbs = await withRetry(() => generateBatch(pdfTexts), 'pdf');
      const fullEmbs = await withRetry(() => generateBatch(fullTexts), 'full');
      for (let j = 0; j < batch.length; j++) {
        await pool.query(
          `INSERT INTO product_embeddings (product_id, embedding_type, embedding, input_text, model)
           VALUES ($1, 'pdf_content', $2, $3, $4)
           ON CONFLICT (product_id, embedding_type) DO UPDATE SET embedding=$2, input_text=$3, model=$4, created_at=NOW()`,
          [batch[j].id, toSql(pdfEmbs[j]), pdfTexts[j], openaiConfig.EMBEDDING_MODEL]
        );
        await pool.query(
          `INSERT INTO product_embeddings (product_id, embedding_type, embedding, input_text, model)
           VALUES ($1, 'full_spec', $2, $3, $4)
           ON CONFLICT (product_id, embedding_type) DO UPDATE SET embedding=$2, input_text=$3, model=$4, created_at=NOW()`,
          [batch[j].id, toSql(fullEmbs[j]), fullTexts[j], openaiConfig.EMBEDDING_MODEL]
        );
      }
      console.log(`  ${Math.min(i + 20, withPdf.length)}/${withPdf.length}`);
    }
  }

  console.log('Legacy embeddings done.\n');
}

// Step 3: Family embeddings — re-embed existing input_text with new model
async function regenerateFamilies() {
  console.log('=== Regenerating product family embeddings ===\n');

  const { rows: embs } = await pool.query(`
    SELECT pfe.family_id, pfe.embedding_type, pfe.input_text, pf.name
    FROM product_family_embeddings pfe
    JOIN product_families pf ON pf.id = pfe.family_id
    ORDER BY pf.name, pfe.embedding_type
  `);

  if (embs.length === 0) {
    console.log('Table is empty — run these scripts to rebuild:');
    console.log('  node scripts/generate-naughtone-embeddings.js');
    console.log('  node scripts/generate-search-optimized-embeddings.js --force');
    console.log('  node scripts/fix-fiji-data.js');
    return;
  }

  console.log(`Re-embedding ${embs.length} family embeddings...\n`);
  const BATCH = 20;
  let success = 0;

  for (let i = 0; i < embs.length; i += BATCH) {
    const batch = embs.slice(i, i + BATCH);
    const texts = batch.map(e => e.input_text);
    const embeddings = await withRetry(() => generateBatch(texts), 'family');
    for (let j = 0; j < batch.length; j++) {
      await pool.query(
        `INSERT INTO product_family_embeddings (family_id, embedding_type, embedding, input_text, model)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (family_id, embedding_type) DO UPDATE SET embedding=$3, input_text=$4, model=$5, created_at=NOW()`,
        [batch[j].family_id, batch[j].embedding_type, toSql(embeddings[j]), batch[j].input_text, openaiConfig.EMBEDDING_MODEL]
      );
      success++;
    }
    console.log(`  [${success}/${embs.length}] ${batch[batch.length-1].name} (${batch[batch.length-1].embedding_type})`);
  }
  console.log(`Family embeddings: ${success}/${embs.length}\n`);
}

// Main
async function main() {
  await runMigration();

  if (!FAMILIES_ONLY) await regenerateLegacy();
  if (!LEGACY_ONLY) await regenerateFamilies();

  // Summary
  const { rows: lc } = await pool.query(`SELECT embedding_type, COUNT(*) as c FROM product_embeddings GROUP BY embedding_type ORDER BY 1`);
  const { rows: fc } = await pool.query(`SELECT embedding_type, COUNT(*) as c FROM product_family_embeddings GROUP BY embedding_type ORDER BY 1`);

  console.log('\n========================================');
  console.log(`Model: ${openaiConfig.EMBEDDING_MODEL} (${openaiConfig.EMBEDDING_DIMENSIONS} dims)`);
  console.log('\nLegacy:');
  for (const r of lc) console.log(`  ${r.embedding_type}: ${r.c}`);
  console.log('Families:');
  for (const r of fc) console.log(`  ${r.embedding_type}: ${r.c}`);
  console.log('========================================');
}

main()
  .then(() => { console.log('\nDone.'); pool.end(); })
  .catch(err => { console.error('Failed:', err); pool.end(); process.exit(1); });
