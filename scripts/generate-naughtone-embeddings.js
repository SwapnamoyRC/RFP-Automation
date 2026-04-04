/**
 * Generate embeddings for NaughtOne product families.
 *
 * Creates two embedding types per family:
 *   1. family_description  — rich text from name + variants + specs
 *   2. image_description   — vision AI description of a representative image
 *
 * Usage: node scripts/generate-naughtone-embeddings.js [--text-only] [--images-only]
 */

require('dotenv').config();
const { pool } = require('../src/config/database');
const openaiConfig = require('../src/config/openai');
const { toSql } = require('pgvector/pg');

const args = process.argv.slice(2);
const TEXT_ONLY = args.includes('--text-only');
const IMAGES_ONLY = args.includes('--images-only');

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

async function generateBatchEmbeddings(texts) {
  const truncated = texts.map(t => t.slice(0, 32000));
  const response = await openaiConfig.openai.embeddings.create({
    model: openaiConfig.EMBEDDING_MODEL,
    input: truncated,
    dimensions: openaiConfig.EMBEDDING_DIMENSIONS
  });
  return response.data.map(d => d.embedding);
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
 * Build rich text for a product family by combining all its data.
 */
function composeEmbeddingText(family, variants, specs, imageDescription = null) {
  const parts = [
    `Brand: NaughtOne`,
    `Product Family: ${family.name}`,
  ];

  if (variants.length > 0) {
    parts.push(`Variants: ${variants.map(v => v.name).join(', ')}`);
  }

  // Include visual description from image embedding if available
  // This helps the text channel capture visual features (shape, form, distinctive details)
  if (imageDescription) {
    parts.push(`Visual Description: ${imageDescription}`);
  }

  // Group specs by category
  const specsByCategory = {};
  for (const spec of specs) {
    if (!specsByCategory[spec.spec_category]) specsByCategory[spec.spec_category] = [];
    specsByCategory[spec.spec_category].push(spec);
  }

  if (specsByCategory.dimensions) {
    parts.push(`Dimensions: ${specsByCategory.dimensions.map(s => s.spec_value).join('\n')}`);
  }

  if (specsByCategory.materials) {
    parts.push(`Materials: ${specsByCategory.materials.map(s => s.spec_value).join('\n')}`);
  }

  if (specsByCategory.sustainability) {
    parts.push(`Sustainability: ${specsByCategory.sustainability.map(s => `${s.spec_name}: ${s.spec_value}`).join('\n')}`);
  }

  if (specsByCategory.certifications) {
    parts.push(`Certifications: ${specsByCategory.certifications.map(s => `${s.spec_name}: ${s.spec_value}`).join('\n')}`);
  }

  if (specsByCategory.options) {
    parts.push(`Options: ${specsByCategory.options.map(s => `${s.spec_name}: ${s.spec_value}`).join('\n')}`);
  }

  return parts.join('\n\n');
}

/**
 * Smart image selection: pick the best N product shots from a family's images.
 * Prioritizes clean product shots (FRONT, 3QTR angles) on white backgrounds.
 * Excludes lifestyle/project photos (GROUP shots, client-named photos).
 */
function selectBestImages(images, maxCount = 3) {
  // Known client/project prefixes to deprioritize (these are lifestyle photos)
  const CLIENT_PREFIXES = [
    'AIRC_', 'ASCENTIAL_', 'CITYBUILDING_', 'ELEMENTS_', 'I2IEVENTS_',
    'JAMAICABANK_', 'LARGE_ONLINE_', 'MICROSOFT_', 'ORACLE_', 'SHOWGB_',
    'WSP_', 'YOUTHSCAPE_', 'POLSTBT_'
  ];

  // Score each image based on its product_id_tag
  const scored = images.map(img => {
    const tag = (img.product_id_tag || '').toUpperCase();
    let score = 0;

    // Strongly prefer FRONT views (best for product identification)
    if (tag.includes('_FRONT_')) score += 100;
    // 3QTR (three-quarter) views are also great
    else if (tag.includes('_3QTR_')) score += 90;
    // REAR views are useful as supplementary
    else if (tag.includes('_REAR_')) score += 40;
    // DETAIL views (close-ups)
    else if (tag.includes('_DETAIL_')) score += 30;

    // Penalize GROUP shots (multiple products, confuses Vision AI)
    if (tag.includes('_GROUP_') || tag.includes('_GROUP')) score -= 200;

    // Penalize client/project photos (lifestyle settings)
    for (const prefix of CLIENT_PREFIXES) {
      if (tag.startsWith(prefix)) { score -= 150; break; }
    }

    // Prefer LR (low-res) — faster to download, sufficient for Vision AI
    if (tag.endsWith('_LR')) score += 10;
    // HR is fine too but slightly slower
    else if (tag.endsWith('_HR')) score += 5;

    // Slight preference for smaller files (faster download, usually cleaner shots)
    if (img.file_size && parseFloat(img.file_size) < 0.2) score += 5;

    return { ...img, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Pick top N, but try to get different angles (avoid duplicating FRONT+FRONT)
  const selected = [];
  const usedAngles = new Set();

  for (const img of scored) {
    if (selected.length >= maxCount) break;

    const tag = (img.product_id_tag || '').toUpperCase();
    let angle = 'other';
    if (tag.includes('_FRONT_')) angle = 'front';
    else if (tag.includes('_3QTR_')) angle = '3qtr';
    else if (tag.includes('_REAR_')) angle = 'rear';
    else if (tag.includes('_DETAIL_')) angle = 'detail';

    // Allow one image per angle, but fill remaining slots with best available
    if (usedAngles.has(angle) && scored.filter(s => !usedAngles.has(getAngle(s))).length > 0) {
      continue;
    }
    usedAngles.add(angle);
    selected.push(img);
  }

  // If we didn't fill all slots, add remaining top-scored images
  if (selected.length < maxCount) {
    for (const img of scored) {
      if (selected.length >= maxCount) break;
      if (!selected.includes(img)) selected.push(img);
    }
  }

  return selected;
}

function getAngle(img) {
  const tag = (img.product_id_tag || '').toUpperCase();
  if (tag.includes('_FRONT_')) return 'front';
  if (tag.includes('_3QTR_')) return '3qtr';
  if (tag.includes('_REAR_')) return 'rear';
  if (tag.includes('_DETAIL_')) return 'detail';
  return 'other';
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------

async function main() {
  // Run migration first
  console.log('Running migration 011...');
  const fs = require('fs');
  const migrationSql = fs.readFileSync(
    require('path').join(__dirname, '../src/db/migrations/011_create_family_embeddings.sql'),
    'utf-8'
  );
  await pool.query(migrationSql);
  console.log('Migration 011 applied.');

  // Get all NaughtOne families
  const { rows: families } = await pool.query(`
    SELECT pf.id, pf.name, pf.slug
    FROM product_families pf
    JOIN brands b ON b.id = pf.brand_id
    WHERE b.slug = 'naughtone'
    ORDER BY pf.name
  `);
  console.log(`Found ${families.length} NaughtOne families\n`);

  // ================================================================
  // STEP 1: Text embeddings (family_description)
  // ================================================================
  if (!IMAGES_ONLY) {
    console.log('=== Generating text embeddings ===');

    // Pre-fetch all variants and specs
    const { rows: allVariants } = await pool.query(`
      SELECT pv.family_id, pv.name, pv.slug
      FROM product_variants_v2 pv
      JOIN brands b ON b.id = pv.brand_id
      WHERE b.slug = 'naughtone'
      ORDER BY pv.is_primary DESC, pv.name
    `);

    const { rows: allSpecs } = await pool.query(`
      SELECT ts.family_id, ts.spec_category, ts.spec_name, ts.spec_value
      FROM technical_specs ts
      JOIN product_families pf ON pf.id = ts.family_id
      JOIN brands b ON b.id = pf.brand_id
      WHERE b.slug = 'naughtone'
    `);

    // Pre-fetch existing image descriptions to enrich text embeddings
    const { rows: allImageDescs } = await pool.query(`
      SELECT pfe.family_id, pfe.input_text
      FROM product_family_embeddings pfe
      JOIN product_families pf ON pf.id = pfe.family_id
      JOIN brands b ON b.id = pf.brand_id
      WHERE b.slug = 'naughtone' AND pfe.embedding_type = 'image_description'
    `);
    const imageDescByFamily = {};
    for (const d of allImageDescs) {
      imageDescByFamily[d.family_id] = d.input_text;
    }

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

    // Build texts for all families (enriched with image descriptions)
    const familyTexts = families.map(f => ({
      family: f,
      text: composeEmbeddingText(f, variantsByFamily[f.id] || [], specsByFamily[f.id] || [], imageDescByFamily[f.id] || null)
    }));

    // Batch embed (up to 100 at a time)
    const BATCH_SIZE = 20;
    let textSuccess = 0;

    for (let i = 0; i < familyTexts.length; i += BATCH_SIZE) {
      const batch = familyTexts.slice(i, i + BATCH_SIZE);
      const texts = batch.map(ft => ft.text);

      try {
        const embeddings = await generateBatchEmbeddings(texts);

        for (let j = 0; j < batch.length; j++) {
          await upsertFamilyEmbedding(
            batch[j].family.id,
            'family_description',
            embeddings[j],
            batch[j].text
          );
          textSuccess++;
          console.log(`  [${textSuccess}/${families.length}] ${batch[j].family.name}`);
        }
      } catch (err) {
        console.error(`  Batch failed: ${err.message}`);
        if (err.message.includes('429') || err.message.includes('rate')) {
          console.log('  Rate limited, waiting 30s...');
          await new Promise(r => setTimeout(r, 30000));
          i -= BATCH_SIZE; // retry this batch
        }
      }
    }
    console.log(`Text embeddings: ${textSuccess}/${families.length}\n`);
  }

  // ================================================================
  // STEP 2: Image embeddings (image_description)
  // ================================================================
  if (!TEXT_ONLY) {
    console.log('=== Generating image embeddings ===');
    console.log('(1 representative image per family via Vision AI)\n');

    // Use --force to regenerate all image embeddings (deletes existing first)
    const FORCE_REGEN = args.includes('--force');

    if (FORCE_REGEN) {
      console.log('  --force: Deleting existing image embeddings to regenerate...');
      await pool.query(`
        DELETE FROM product_family_embeddings
        WHERE embedding_type = 'image_description'
        AND family_id IN (
          SELECT pf.id FROM product_families pf
          JOIN brands b ON b.id = pf.brand_id WHERE b.slug = 'naughtone'
        )
      `);
    }

    // Check which families already have image embeddings
    const { rows: existing } = await pool.query(`
      SELECT family_id FROM product_family_embeddings
      WHERE embedding_type = 'image_description'
    `);
    const existingSet = new Set(existing.map(r => r.family_id));

    let imageSuccess = 0, imageSkipped = 0, imageFailed = 0;

    // Load vision service
    const visionService = require('../src/services/vision.service');

    for (let i = 0; i < families.length; i++) {
      const family = families[i];

      // Skip if already has image embedding
      if (existingSet.has(family.id)) {
        imageSkipped++;
        console.log(`  [${i + 1}/${families.length}] ${family.name} — already done, skipping`);
        continue;
      }

      // Smart image selection: pick up to 3 clean product shots
      // Priority: FRONT > 3QTR > other angles. Exclude GROUP and client/project photos.
      const { rows: images } = await pool.query(`
        SELECT image_url, product_id_tag, file_size FROM product_images
        WHERE family_id = $1 AND image_url IS NOT NULL
        ORDER BY file_size ASC
      `, [family.id]);

      if (images.length === 0) {
        console.log(`  [${i + 1}/${families.length}] ${family.name} — no images, skipping`);
        imageSkipped++;
        continue;
      }

      // Filter and rank images by quality for embedding
      const selected = selectBestImages(images, 3);
      console.log(`  [${i + 1}/${families.length}] ${family.name} — selected ${selected.length} images:`);
      selected.forEach((img, idx) => console.log(`    ${idx + 1}. ${img.product_id_tag}`));

      try {
        // Describe each selected image via Vision AI
        const descriptions = [];
        for (const img of selected) {
          try {
            const desc = await visionService.describeImageFromUrl(img.image_url);
            if (desc) descriptions.push(desc);
          } catch (err) {
            console.log(`    Image failed (${img.product_id_tag}): ${err.message}`);
          }
        }

        if (descriptions.length === 0) {
          console.log(`    No descriptions generated, skipping`);
          imageFailed++;
          continue;
        }

        // Combine all descriptions with product context
        const combinedDesc = descriptions.length === 1
          ? descriptions[0]
          : descriptions.map((d, i) => `View ${i + 1}: ${d}`).join('\n');
        const imageText = `NaughtOne ${family.name}\nImage Descriptions (${descriptions.length} views):\n${combinedDesc}`;

        // Generate embedding from combined description
        const embedding = await generateEmbedding(imageText);
        await upsertFamilyEmbedding(family.id, 'image_description', embedding, imageText);

        imageSuccess++;
        console.log(`    OK — ${descriptions.length} descriptions combined (${imageText.length} chars)`);

        // Rate limit: pause every 3 families (each has up to 3 Vision API calls)
        if (imageSuccess > 0 && imageSuccess % 3 === 0) {
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch (err) {
        imageFailed++;
        console.error(`    FAILED: ${err.message}`);
        if (err.message.includes('429') || err.message.includes('rate')) {
          console.log('  Rate limited, waiting 30s...');
          await new Promise(r => setTimeout(r, 30000));
          i--; // retry
        }
      }
    }

    console.log(`\nImage embeddings: ${imageSuccess} new, ${imageSkipped} skipped, ${imageFailed} failed`);
  }

  // ================================================================
  // Summary
  // ================================================================
  const { rows: counts } = await pool.query(`
    SELECT embedding_type, COUNT(*) as count
    FROM product_family_embeddings pfe
    JOIN product_families pf ON pf.id = pfe.family_id
    JOIN brands b ON b.id = pf.brand_id
    WHERE b.slug = 'naughtone'
    GROUP BY embedding_type
  `);

  console.log('\n========================================');
  console.log('Embedding generation complete!');
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
