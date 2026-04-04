const fs = require('fs');
const openaiConfig = require('../config/openai');
const logger = require('../config/logger');

/**
 * Step 3: Final AI verification using GPT-4o.
 * Compares RFP item against top candidates with detailed visual analysis.
 * Returns top matches with scores and explanations.
 */
async function verifyMatches(rfpImagePath, rfpDescription, candidates, topK = 10) {
  const openai = openaiConfig.openai;

  const rfpImageBase64 = fs.readFileSync(rfpImagePath).toString('base64');
  const rfpImageMime = rfpImagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

  // Build candidate content with product images via URL
  const candidateContent = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    candidateContent.push({
      type: 'text',
      text: `\n--- Candidate ${i + 1}: "${candidate.name}" [${candidate.category || 'unknown'}] ---\n${candidate.description || ''}\nMaterials: ${candidate.materials || 'N/A'}\nDimensions: ${candidate.dimensions || 'N/A'}\nVisual: ${candidate.image_description || 'N/A'}`,
    });

    const imgUrl = candidate.best_match_image_url || candidate.image_url;
    if (imgUrl) {
      candidateContent.push({
        type: 'image_url',
        image_url: { url: imgUrl, detail: 'high' },
      });
    }
  }

  const systemPrompt = `You are an expert furniture product matcher. Compare the reference furniture item against each candidate product.

CRITICAL: Products come in many colors and fabrics. IGNORE color differences -- a red chair and green chair of the same model ARE the same product and should score 9-10.

For each candidate, evaluate (in order of importance):
1. Shape/silhouette similarity (overall form, proportions) -- MOST IMPORTANT
2. Base/leg design match (sled, cantilever, 4-leg, wood, pedestal, integrated)
3. Armrest and backrest design
4. Style match (modern, traditional, industrial, etc.)
5. Material type (wood, metal, fabric, plastic)
6. Color match -- LEAST IMPORTANT (different color of same model = still a match)

Return a JSON object with this exact format:
{
  "matches": [
    {
      "candidateIndex": 1,
      "score": 9.5,
      "explanation": "Excellent match - same silhouette with sled base and integrated armrests, different color",
      "matched_points": ["Matching 4-leg base", "Same armless design", "Similar seat proportions", "Upholstered seat and back"],
      "mismatched_points": ["Different seat depth", "Slightly different leg angle"]
    }
  ]
}

matched_points: 2-5 short phrases (3-6 words each) describing what MATCHES between the RFP item and this candidate.
mismatched_points: 1-3 short phrases describing key DIFFERENCES (empty array if score >= 8).

Return the top ${topK} matches sorted by score (highest first). Scores are 0-10.`;

  // Build candidate content WITHOUT images as fallback
  const candidateTextOnly = [];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    candidateTextOnly.push({
      type: 'text',
      text: `\n--- Candidate ${i + 1}: "${candidate.name}" [${candidate.category || 'unknown'}] ---\n${candidate.description || ''}\nMaterials: ${candidate.materials || 'N/A'}\nDimensions: ${candidate.dimensions || 'N/A'}\nVisual: ${candidate.image_description || 'N/A'}`,
    });
  }

  const makeRequest = async (withImages) => {
    const content = withImages ? candidateContent : candidateTextOnly;
    return openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Reference item: "${rfpDescription}"\n\nReference image:` },
            { type: 'image_url', image_url: { url: `data:${rfpImageMime};base64,${rfpImageBase64}`, detail: 'high' } },
            ...content,
            { type: 'text', text: `\nAnalyze each candidate and return the top ${topK} best matches as JSON.` },
          ],
        },
      ],
      max_tokens: 1500,
      temperature: 0.2,
    });
  };

  let response;
  try {
    response = await makeRequest(true);
  } catch (err) {
    logger.warn(`[verifier] Failed with images, retrying without candidate images: ${err.message}`);
    response = await makeRequest(false);
  }

  const content = response.choices[0]?.message?.content || '{}';

  let parsed;
  try {
    const jsonMatch = content.match(/\{[\s\S]*"matches"[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { matches: [] };
  } catch {
    logger.warn('[verifier] Failed to parse response');
    parsed = { matches: [] };
  }

  const verified = parsed.matches
    .filter((m) => m.candidateIndex >= 1 && m.candidateIndex <= candidates.length)
    .map((m) => ({
      product: candidates[m.candidateIndex - 1],
      score: m.score,
      explanation: m.explanation,
      matched_points: Array.isArray(m.matched_points) ? m.matched_points : [],
      mismatched_points: Array.isArray(m.mismatched_points) ? m.mismatched_points : [],
    }))
    .slice(0, topK);

  return verified;
}

module.exports = { verifyMatches };
