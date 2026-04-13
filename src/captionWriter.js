/**
 * captionWriter.js — Uses Claude Sonnet to generate on-brand captions
 * for Instagram and TikTok based on content + trend brief.
 */

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a social media copywriter for Australian small businesses.
You write captions that sound like a real person, not a brand robot.
Warm, local, genuine. Never cringe. Never use the word "journey".
Always output valid JSON only. No markdown, no preamble.`;

/**
 * Generate captions for both Instagram and TikTok.
 * Returns { instagramCaption, tiktokCaption, instagramHashtags, tiktokHashtags }
 * or throws on failure.
 */
async function generateCaptions({ client: bizClient, trendBrief, rawCaption, contentType, editInstructions = null }) {
  const briefSection = trendBrief
    ? `Trend brief for this week:
- Content angles: ${(trendBrief.content_angles || []).join(', ')}
- Trending audio: ${(trendBrief.trending_audio || []).join(', ')}
- Top hashtags: ${(trendBrief.hashtags || []).join(' ')}
- Competitor note: ${trendBrief.competitor_note || 'none'}`
    : 'No trend brief available — use evergreen content.';

  const editSection = editInstructions
    ? `\nEdit instructions from client: "${editInstructions}"\nApply these changes to both captions.`
    : '';

  const userPrompt = `Business: ${bizClient.business_name}
Niche: ${bizClient.niche?.replace(/_/g, ' ')}
Brand voice: ${bizClient.brand_voice || 'Friendly, approachable, local Australian business'}
Content type: ${contentType}
Raw content/caption from staff: ${rawCaption || '(no caption provided — write based on context)'}

${briefSection}${editSection}

Write captions for this post. Return ONLY a JSON object with these exact keys:
{
  "instagram_caption": "150-220 word caption, conversational, ends with a question or CTA",
  "tiktok_caption": "80-120 word caption, hook in the first line, punchy",
  "instagram_hashtags": ["array", "of", "10", "hashtags", "no", "hash", "symbol"],
  "tiktok_hashtags": ["array", "of", "5", "hashtags"]
}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = message.content[0].text.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const parsed = JSON.parse(raw);

  // Validate keys
  const required = ['instagram_caption', 'tiktok_caption', 'instagram_hashtags', 'tiktok_hashtags'];
  for (const key of required) {
    if (!parsed[key]) throw new Error(`Missing key in caption response: ${key}`);
  }

  return {
    instagramCaption: parsed.instagram_caption,
    tiktokCaption: parsed.tiktok_caption,
    instagramHashtags: parsed.instagram_hashtags,
    tiktokHashtags: parsed.tiktok_hashtags,
  };
}

/**
 * Build the final Instagram caption string with hashtags appended.
 */
function buildInstagramPost(caption, hashtags) {
  const tags = hashtags.map(t => `#${t.replace(/^#/, '')}`).join(' ');
  return `${caption}\n\n${tags}`;
}

/**
 * Build the final TikTok caption string with hashtags inline.
 */
function buildTiktokPost(caption, hashtags) {
  const tags = hashtags.map(t => `#${t.replace(/^#/, '')}`).join(' ');
  return `${caption} ${tags}`;
}

module.exports = { generateCaptions, buildInstagramPost, buildTiktokPost };
