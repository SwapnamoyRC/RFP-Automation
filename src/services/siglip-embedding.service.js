// Load sharp FIRST before @xenova/transformers so our DLLs (libvips 8.15.x)
// are in memory before transformers loads its nested sharp (libvips 8.14.x).
// On Windows, whichever DLL loads first wins — loading order is critical.
const sharp = require('sharp');

const path = require('path');
const fs = require('fs');
const logger = require('../config/logger');

// Cache models locally
const { env } = require('@xenova/transformers');
env.cacheDir = path.join(process.cwd(), '.model-cache');

let imageFeaturePipeline = null;

const MODEL_NAME = 'Xenova/siglip-base-patch16-224';
const EMBEDDING_DIM = 768;

/**
 * Initialize the SigLIP image model (downloads ~350MB on first run)
 */
async function initSigLIPModel() {
  if (!imageFeaturePipeline) {
    logger.info('Loading SigLIP model (first run downloads ~350MB)...');
    const { pipeline } = await import('@xenova/transformers');
    imageFeaturePipeline = await pipeline('image-feature-extraction', MODEL_NAME);
    logger.info('SigLIP image model loaded.');
  }
}

/**
 * Preprocess image: resize to 224x224 with white background
 */
async function preprocessBuffer(imageBuffer) {
  return sharp(imageBuffer)
    .resize(224, 224, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();
}

/**
 * Mean-pool patch features into a single vector + L2 normalize.
 * SigLIP outputs [numPatches, 768] -- we average across patches to get [768].
 */
function meanPoolAndNormalize(rawData) {
  const numPatches = rawData.length / EMBEDDING_DIM;
  const pooled = new Float64Array(EMBEDDING_DIM);

  // Sum across patches
  for (let p = 0; p < numPatches; p++) {
    for (let d = 0; d < EMBEDDING_DIM; d++) {
      pooled[d] += rawData[p * EMBEDDING_DIM + d];
    }
  }

  // Mean
  for (let d = 0; d < EMBEDDING_DIM; d++) {
    pooled[d] /= numPatches;
  }

  // L2 normalize
  let norm = 0;
  for (let d = 0; d < EMBEDDING_DIM; d++) {
    norm += pooled[d] * pooled[d];
  }
  norm = Math.sqrt(norm);

  const result = new Array(EMBEDDING_DIM);
  for (let d = 0; d < EMBEDDING_DIM; d++) {
    result[d] = pooled[d] / norm;
  }

  return result;
}

/**
 * Generate SigLIP 768-dim embedding for an image file path
 */
async function getImageEmbedding(imagePath) {
  if (!imageFeaturePipeline) await initSigLIPModel();

  const { RawImage } = await import('@xenova/transformers');

  // Decode to raw RGB pixels using the top-level sharp (v0.33.5).
  // MUST NOT use fromBlob — it triggers the nested sharp inside
  // @xenova/transformers which loads a conflicting libvips → core dump.
  const { data, info } = await sharp(imagePath)
    .resize(224, 224, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const image = new RawImage(new Uint8ClampedArray(data), info.width, info.height, info.channels);

  const output = await imageFeaturePipeline(image);
  return meanPoolAndNormalize(output.data);
}

/**
 * Generate SigLIP 768-dim embedding from an image Buffer
 */
async function getImageEmbeddingFromBuffer(imageBuffer) {
  if (!imageFeaturePipeline) await initSigLIPModel();

  const { RawImage } = await import('@xenova/transformers');

  // Decode to raw RGB pixels using the top-level sharp (v0.33.5).
  // MUST NOT use fromBlob — it triggers the nested sharp inside
  // @xenova/transformers which loads a conflicting libvips → core dump.
  const { data, info } = await sharp(imageBuffer)
    .resize(224, 224, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const image = new RawImage(new Uint8ClampedArray(data), info.width, info.height, info.channels);

  const output = await imageFeaturePipeline(image);
  return meanPoolAndNormalize(output.data);
}

module.exports = {
  initSigLIPModel,
  getImageEmbedding,
  getImageEmbeddingFromBuffer,
  EMBEDDING_DIM,
};
