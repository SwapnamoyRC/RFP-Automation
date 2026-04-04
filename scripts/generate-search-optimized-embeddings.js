/**
 * Generate search-optimized embeddings for all product families.
 *
 * Uses GPT-4o to create natural-language product descriptions that mimic
 * how a human would describe furniture in an RFP — closing the semantic gap
 * between structured catalog data and RFP search queries.
 *
 * Creates a new embedding type: 'search_optimized'
 *
 * Usage:
 *   node scripts/generate-search-optimized-embeddings.js
 *   node scripts/generate-search-optimized-embeddings.js --force    # regenerate all
 *   node scripts/generate-search-optimized-embeddings.js --dry-run  # preview descriptions only
 */

require('dotenv').config();
const { pool } = require('../src/config/database');
const openaiConfig = require('../src/config/openai');
const { toSql } = require('pgvector/pg');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

async function generateEmbedding(text) {
  const truncated = text.slice(0, 32000);
  const response = await openaiConfig.openai.embeddings.create({
    model: openaiConfig.EMBEDDING_MODEL,
    input: truncated,
    dimensions: openaiConfig.EMBEDDING_DIMENSIONS
  });
  return response.data[0].embedding;
}

async function upsertFamilyEmbedding(familyId, embeddingType, embedding, inputText) {
  await pool.query(
    `INSERT INTO product_family_embeddings (family_id, embedding_type, embedding, input_text)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (family_id, embedding_type) DO UPDATE SET
       embedding = $3, input_text = $4, created_at = NOW()`,
    [familyId, embeddingType, toSql(embedding), inputText]
  );
}

/**
 * Use GPT-4o to generate a natural-language, search-optimized product description.
 * This description is written the way a human would describe the furniture,
 * matching the language used in RFP documents.
 */
async function generateSearchDescription(family, variants, specs, imageDescription) {
  const specsByCategory = {};
  for (const s of specs) {
    if (!specsByCategory[s.spec_category]) specsByCategory[s.spec_category] = [];
    specsByCategory[s.spec_category].push(s);
  }

  const context = [
    `Brand: NaughtOne`,
    `Product Family: ${family.name}`,
    variants.length > 0 ? `Variants: ${variants.map(v => v.name).join(', ')}` : null,
    imageDescription ? `Visual Description: ${imageDescription}` : null,
    specsByCategory.dimensions
      ? `Dimensions: ${specsByCategory.dimensions.map(s => s.spec_value).join('; ')}`
      : null,
    specsByCategory.materials
      ? `Materials: ${specsByCategory.materials.map(s => s.spec_value).join('; ')}`
      : null,
    specsByCategory.certifications
      ? `Certifications: ${specsByCategory.certifications.map(s => `${s.spec_name}: ${s.spec_value}`).join('; ')}`
      : null,
    specsByCategory.options
      ? `Options: ${specsByCategory.options.map(s => `${s.spec_name}: ${s.spec_value}`).join('; ')}`
      : null,
    family.description ? `Description: ${family.description}` : null,
    family.category ? `Category: ${family.category}` : null,
  ].filter(Boolean).join('\n');

  const response = await openaiConfig.openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.4,
    max_tokens: 500,
    messages: [
      {
        role: 'system',
        content: `You are a furniture catalog expert. Given structured product data, write a natural-language description that mimics how someone would describe this furniture when specifying it in an RFP (Request for Proposal) or FF&E schedule.

Your description should include:
1. EXACT product type using common furniture terminology (e.g., "high-back acoustic lounge chair" not just "chair")
2. Distinctive shape, silhouette, and form (e.g., "mushroom-shaped", "cantilevered", "pod-like enclosure")
3. Key materials and finish options
4. Intended use context (e.g., "open-plan offices", "reception areas", "breakout spaces", "collaborative zones")
5. Alternative names someone might use to search for this product (e.g., a "phone booth" might also be called "privacy pod", "acoustic booth", "focus booth")
6. Style descriptors (e.g., "Scandinavian", "minimalist", "contemporary", "organic")
7. Seating capacity or size category if applicable (e.g., "2-person sofa", "large meeting table")

Rules:
- Write as flowing prose, NOT bullet points or structured data
- Use 80-150 words
- Do NOT include specific dimensions or measurements
- Do NOT include certification codes
- DO include the brand name "NaughtOne" and product family name
- Focus on visual and functional characteristics that someone would use to search for this product`
      },
      {
        role: 'user',
        content: context
      }
    ]
  });

  return response.choices[0]?.message?.content?.trim() || null;
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------

async function main() {
  console.log('=== Search-Optimized Embedding Generator ===\n');
  if (DRY_RUN) console.log('DRY RUN MODE — no embeddings will be saved\n');

  // Get all families (all brands)
  const { rows: families } = await pool.query(`
    SELECT pf.id, pf.name, pf.slug, pf.description, pf.category, b.name as brand_name, b.slug as brand_slug
    FROM product_families pf
    JOIN brands b ON b.id = pf.brand_id
    ORDER BY b.name, pf.name
  `);
  console.log(`Found ${families.length} product families\n`);

  // If --force, delete existing search_optimized embeddings
  if (FORCE && !DRY_RUN) {
    console.log('--force: Deleting existing search_optimized embeddings...');
    await pool.query(`DELETE FROM product_family_embeddings WHERE embedding_type = 'search_optimized'`);
  }

  // Check which families already have search_optimized embeddings
  const { rows: existing } = await pool.query(`
    SELECT family_id FROM product_family_embeddings WHERE embedding_type = 'search_optimized'
  `);
  const existingSet = new Set(existing.map(r => r.family_id));

  // Pre-fetch all data
  const { rows: allVariants } = await pool.query(`
    SELECT family_id, name FROM product_variants_v2 ORDER BY is_primary DESC, name
  `);
  const { rows: allSpecs } = await pool.query(`
    SELECT family_id, spec_category, spec_name, spec_value FROM technical_specs
  `);
  const { rows: allImageDescs } = await pool.query(`
    SELECT family_id, input_text FROM product_family_embeddings WHERE embedding_type = 'image_description'
  `);

  // Group by family_id
  const variantsByFamily = {};
  for (const v of allVariants) {
    if (!variantsByFamily[v.family_id]) variantsByFamily[v.family_id] = [];
    variantsByFamily[v.family_id].push(v);
  }
  const specsByFamily = {};
  for (const s of allSpecs) {
    if (!specsByFamily[s.family_id]) specsByFamily[s.family_id] = [];
    specsByFamily[s.family_id].push(s);
  }
  const imageDescByFamily = {};
  for (const d of allImageDescs) {
    imageDescByFamily[d.family_id] = d.input_text;
  }

  let success = 0, skipped = 0, failed = 0;

  for (let i = 0; i < families.length; i++) {
    const family = families[i];

    if (existingSet.has(family.id) && !FORCE) {
      skipped++;
      console.log(`  [${i + 1}/${families.length}] ${family.brand_name} ${family.name} — already done, skipping`);
      continue;
    }

    try {
      const variants = variantsByFamily[family.id] || [];
      const specs = specsByFamily[family.id] || [];
      const imageDesc = imageDescByFamily[family.id] || null;

      // Generate natural-language description via GPT-4o
      const description = await generateSearchDescription(family, variants, specs, imageDesc);

      if (!description) {
        console.log(`  [${i + 1}/${families.length}] ${family.name} — no description generated`);
        failed++;
        continue;
      }

      console.log(`  [${i + 1}/${families.length}] ${family.brand_name} ${family.name}`);
      console.log(`    "${description.substring(0, 120)}..."`);

      if (!DRY_RUN) {
        // Generate embedding from the search-optimized description
        const embedding = await generateEmbedding(description);
        await upsertFamilyEmbedding(family.id, 'search_optimized', embedding, description);
      }

      success++;

      // Rate limit: pause every 5 families
      if (success > 0 && success % 5 === 0) {
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (err) {
      failed++;
      console.error(`  [${i + 1}/${families.length}] ${family.name} — FAILED: ${err.message}`);
      if (err.message.includes('429') || err.message.includes('rate')) {
        console.log('  Rate limited, waiting 30s...');
        await new Promise(r => setTimeout(r, 30000));
        i--; // retry
      }
    }
  }

  // Summary
  const { rows: counts } = await pool.query(`
    SELECT embedding_type, COUNT(*) as count
    FROM product_family_embeddings
    GROUP BY embedding_type
    ORDER BY embedding_type
  `);

  console.log('\n========================================');
  console.log(`Search-optimized generation complete!`);
  console.log(`  ${success} generated, ${skipped} skipped, ${failed} failed`);
  console.log('\nAll embedding types:');
  for (const row of counts) {
    console.log(`  ${row.embedding_type}: ${row.count}`);
  }
  console.log('========================================');
}

main()
  .then(() => {
    console.log('\nDone.');
    process.exit(0);
  })
  .catch(err => {
    console.error('Failed:', err);
    process.exit(1);
  });
