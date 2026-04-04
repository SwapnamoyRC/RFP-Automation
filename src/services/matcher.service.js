const fs = require('fs');
const openaiConfig = require('../config/openai');
const logger = require('../config/logger');
const { initSigLIPModel, getImageEmbedding, getImageEmbeddingFromBuffer } = require('./siglip-embedding.service');
const { searchSimilarProducts } = require('./hybrid-search.service');
const { rerankCandidates } = require('./reranker.service');
const { verifyMatches } = require('./verifier.service');

/**
 * Step 0: Use GPT-4o-mini to generate a detailed furniture description from the image.
 * Produces a rich description for text-based search, improving recall when the
 * image angle differs from the catalog photo.
 */
async function describeImage(imagePath, userDescription) {
  const openai = openaiConfig.openai;
  const imageBase64 = fs.readFileSync(imagePath).toString('base64');
  const mime = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a furniture identification expert. Describe this furniture item in detail for product matching.
Include: exact product type, shape/silhouette, base/leg style (cantilever, sled, 4-leg, pedestal, integrated, etc.),
materials, colors, upholstery style, design era/movement, and any distinctive features.
Be specific and technical. Output a single paragraph.`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: userDescription
              ? `The user describes this as: "${userDescription}". Provide a detailed furniture description:`
              : 'Describe this furniture item in detail:',
          },
          {
            type: 'image_url',
            image_url: { url: `data:${mime};base64,${imageBase64}`, detail: 'high' },
          },
        ],
      },
    ],
    max_tokens: 300,
    temperature: 0.2,
  });

  return response.choices[0]?.message?.content || userDescription;
}

/**
 * Step 0 variant: Describe image from a base64 string (for Excel-extracted images).
 */
async function describeImageFromBase64(base64Data, mimeType, userDescription) {
  const openai = openaiConfig.openai;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a furniture identification expert. Describe this furniture item in detail for product matching.
Include: exact product type, shape/silhouette, base/leg style (cantilever, sled, 4-leg, pedestal, integrated, etc.),
materials, colors, upholstery style, design era/movement, and any distinctive features.
Be specific and technical. Output a single paragraph.`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: userDescription
              ? `The user describes this as: "${userDescription}". Provide a detailed furniture description:`
              : 'Describe this furniture item in detail:',
          },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64Data}`, detail: 'high' },
          },
        ],
      },
    ],
    max_tokens: 300,
    temperature: 0.2,
  });

  return response.choices[0]?.message?.content || userDescription;
}

/**
 * Full matching pipeline for a single image file:
 * 0. GPT-4o-mini image description (enriches text search)
 * 1. Hybrid search: SigLIP image embedding + text embedding (top 100)
 * 2. GPT-4o-mini visual reranking (top 15)
 * 3. GPT-4o detailed verification (top 10 with explanations)
 */
async function matchFromFile(imagePath, description = '', options = {}) {
  const { imageWeight = 0.7 } = options;

  logger.info('=== Step 0: AI Image Description ===');
  const aiDescription = await describeImage(imagePath, description);
  logger.info(`[matcher] AI description: ${aiDescription.substring(0, 150)}...`);

  const enrichedDescription = `${description}. ${aiDescription}`;

  logger.info('=== Step 1: Hybrid Vector Search ===');
  await initSigLIPModel();
  const embedding = await getImageEmbedding(imagePath);

  const candidates = await searchSimilarProducts(embedding, enrichedDescription, 100, imageWeight);
  logger.info(`[matcher] Found ${candidates.length} candidates`);

  if (candidates.length === 0) {
    return {
      rfpItem: { description, imagePath, aiDescription },
      pipeline: { step1_vectorSearch: 0, step2_reranked: 0, step3_verified: 0 },
      topMatches: [],
    };
  }

  // Wait for rate limit window to breathe after Step 0 + Step 1 embedding calls
  await new Promise(r => setTimeout(r, 3000));

  logger.info('=== Step 2: AI Re-ranking ===');
  const reranked = await rerankCandidates(imagePath, enrichedDescription, candidates, 10);
  logger.info(`[matcher] Re-ranked to top ${reranked.length} candidates`);

  // Option A: Skip Step 3 if the top candidate from SigLIP (Step 1) is high-confidence
  // AND the reranker (Step 2) also placed it #1. This saves ~50% cost per item.
  const topSigLIP = candidates[0];
  const topReranked = reranked[0];
  const sigLIPConfident = topSigLIP && (topSigLIP.imageSimilarity || 0) >= 0.85;
  const rerankerAgreed = topReranked && topSigLIP && topReranked.id === topSigLIP.id;

  if (sigLIPConfident) {
    logger.info(`[matcher] SigLIP top confidence: ${topSigLIP.imageSimilarity.toFixed(3)} for "${topSigLIP.name}" — reranker agreed: ${rerankerAgreed}`);
  }

  if (sigLIPConfident && rerankerAgreed) {
    logger.info(`[matcher] Skipping Step 3 — high confidence match: "${topReranked.name}" (SigLIP sim=${topSigLIP.similarity.toFixed(3)})`);
    // Build results from reranked with synthetic scores
    const topMatches = reranked.slice(0, 10).map((product, idx) => ({
      product,
      score: Math.max(9.5 - idx * 0.5, 5),
      explanation: idx === 0
        ? `High-confidence match — same silhouette and structure (visual similarity: ${((topSigLIP.imageSimilarity || topSigLIP.similarity) * 100).toFixed(0)}%)`
        : `Alternative match — ${product.name} (rank #${idx + 1} from AI reranking)`,
    }));

    return {
      rfpItem: { description, imagePath, aiDescription },
      pipeline: {
        step1_vectorSearch: candidates.length,
        step2_reranked: reranked.length,
        step3_verified: 0,
      },
      topMatches,
    };
  }

  // Wait for rate limit window after Step 2 (reranker sends 15+ images)
  await new Promise(r => setTimeout(r, 5000));

  logger.info('=== Step 3: Final Verification ===');
  const verified = await verifyMatches(imagePath, enrichedDescription, reranked, 10);
  logger.info(`[matcher] Verified top ${verified.length} matches`);

  return {
    rfpItem: { description, imagePath, aiDescription },
    pipeline: {
      step1_vectorSearch: candidates.length,
      step2_reranked: reranked.length,
      step3_verified: verified.length,
    },
    topMatches: verified,
  };
}

/**
 * Full matching pipeline for a base64 image (from Excel extraction).
 * Writes to a temp file for the pipeline, then cleans up.
 */
async function matchFromBase64(base64Data, mimeType, description = '', options = {}) {
  const path = require('path');
  const os = require('os');

  const ext = mimeType.includes('png') ? '.png' : '.jpg';
  const tempPath = path.join(os.tmpdir(), `rfp-match-${Date.now()}${ext}`);

  try {
    fs.writeFileSync(tempPath, Buffer.from(base64Data, 'base64'));
    return await matchFromFile(tempPath, description, options);
  } finally {
    try { fs.unlinkSync(tempPath); } catch { /* ignore cleanup errors */ }
  }
}

/**
 * Text-only matching pipeline for items without an RFP image.
 * Uses hybrid search with text embeddings only (no SigLIP, no reranking, no verification).
 * Returns top matches in the same format as matchFromFile.
 */
async function matchFromText(description = '', options = {}) {
  const { imageWeight = 0.7 } = options; // imageWeight is ignored when there's no image, but kept for API consistency
  logger.info('=== Text-only match (no image) ===');

  logger.info('=== Step 1: Text-only Hybrid Search ===');
  // Pass null for image embedding — hybrid search will use text at 100% weight regardless
  const candidates = await searchSimilarProducts(null, description, 100, imageWeight);
  logger.info(`[matcher] Found ${candidates.length} text-only candidates`);

  if (candidates.length === 0) {
    return {
      rfpItem: { description, aiDescription: description },
      pipeline: { step1_vectorSearch: 0, step2_reranked: 0, step3_verified: 0 },
      topMatches: [],
    };
  }

  // No reranking or verification possible without an image.
  // Return top 10 candidates with similarity scaled to 0-10.
  const topMatches = candidates.slice(0, 10).map((c) => ({
    product: c,
    score: Math.min(c.similarity * 12, 10), // scale cosine sim to ~0-10 range
    explanation: 'Text-only match (no RFP image available)',
  }));

  return {
    rfpItem: { description, aiDescription: description },
    pipeline: {
      step1_vectorSearch: candidates.length,
      step2_reranked: 0,
      step3_verified: 0,
    },
    topMatches,
  };
}

module.exports = {
  matchFromFile,
  matchFromBase64,
  matchFromText,
  describeImage,
  describeImageFromBase64,
  initSigLIPModel,
};
