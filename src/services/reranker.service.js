const fs = require('fs');
const openaiConfig = require('../config/openai');
const logger = require('../config/logger');

/**
 * Step 2: Re-rank candidates using GPT-4o-mini.
 * Uses BOTH visual comparison AND detailed text descriptions to rank.
 * Critical because catalog images may be lifestyle shots that look different
 * from the RFP close-up photo.
 */
async function rerankCandidates(rfpImagePath, rfpDescription, candidates, topK = 15) {
  const openai = openaiConfig.openai;

  // Build detailed candidate list including image_description
  const candidateList = candidates
    .slice(0, 50)
    .map((c, i) => {
      const desc = c.description || 'No description';
      const visualDesc = c.image_description
        ? `\nVisual details: ${c.image_description.substring(0, 300)}`
        : '';
      return `${i + 1}. "${c.name}" [${c.category}] -- ${desc}${visualDesc}`;
    })
    .join('\n\n');

  const rfpImageBase64 = fs.readFileSync(rfpImagePath).toString('base64');
  const rfpImageMime = rfpImagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

  // Include product images for top 10 candidates (keeps each call under 60K tokens for Tier 1 rate limits)
  const candidateImages = [];
  for (let i = 0; i < Math.min(candidates.length, 10); i++) {
    const candidate = candidates[i];
    const imgUrl = candidate.best_match_image_url || candidate.image_url;
    if (imgUrl) {
      candidateImages.push({
        type: 'text',
        text: `Candidate #${i + 1}: "${candidate.name}"`,
      });
      candidateImages.push({
        type: 'image_url',
        image_url: { url: imgUrl, detail: 'low' },
      });
    }
  }

  // Retry wrapper -- some product image URLs may timeout on OpenAI's side
  const makeRequest = async (includeImages) => {
    const userContent = [
      {
        type: 'text',
        text: `Reference item description: "${rfpDescription}"\n\nReference image:`,
      },
      {
        type: 'image_url',
        image_url: { url: `data:${rfpImageMime};base64,${rfpImageBase64}`, detail: 'high' },
      },
      { type: 'text', text: `\nCandidate products:\n${candidateList}` },
    ];
    if (includeImages) userContent.push(...candidateImages);
    userContent.push({
      type: 'text',
      text: `\nReturn the top ${topK} best matching candidate numbers as a JSON array. Pay special attention to matching the base/leg design and overall form described in the reference.`,
    });

    return openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a furniture product matching expert. Your job is to find the EXACT product or closest structural match from the catalog.

CRITICAL MATCHING RULES:
1. IGNORE COLOR/FABRIC -- products come in many colors. A red chair and green chair of the same model ARE the same product.
2. Focus on STRUCTURE: product type, shape/silhouette, base/leg design (sled, cantilever, 4-leg, wood, integrated), armrest style, backrest angle
3. Catalog images may show the product in a different color, angle, or setting
4. The "Visual details" text field describes the product's actual features -- use this heavily
5. A product shown in green with a sled base IS the same as a red version with a sled base

Return ONLY a JSON array of the top ${topK} candidate numbers (1-indexed) ranked best to worst.
Example: [3, 7, 1, 12, 5, 8, 2, 15, 9, 4, 6, 11, 13, 14, 20]`,
        },
        { role: 'user', content: userContent },
      ],
      max_tokens: 300,
      temperature: 0.1,
    });
  };

  let response;
  try {
    response = await makeRequest(true);
  } catch (err) {
    logger.warn(`[reranker] Failed with images, retrying without candidate images: ${err.message}`);
    response = await makeRequest(false);
  }

  const content = response.choices[0]?.message?.content || '[]';
  logger.info(`[reranker] Response: ${content}`);

  let rankedIndices;
  try {
    const jsonMatch = content.match(/\[[\d,\s]+\]/);
    rankedIndices = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch {
    logger.warn('[reranker] Failed to parse response, using original order');
    rankedIndices = candidates.slice(0, topK).map((_, i) => i + 1);
  }

  const reranked = [];
  for (const idx of rankedIndices) {
    if (idx >= 1 && idx <= candidates.length) {
      reranked.push(candidates[idx - 1]);
    }
  }

  // Fill remaining slots
  if (reranked.length < topK) {
    for (const candidate of candidates) {
      if (!reranked.find((r) => r.id === candidate.id)) {
        reranked.push(candidate);
        if (reranked.length >= topK) break;
      }
    }
  }

  return reranked.slice(0, topK);
}

module.exports = { rerankCandidates };
