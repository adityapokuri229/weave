import { execFile } from 'child_process';
import util from 'util';
import { buildPortfolioData } from './portfolioTemplates.js';

const execFileAsync = util.promisify(execFile);

/**
 * Dynamically synthesizes 100% custom, domain-specific website content using local AI (agy CLI).
 * Generates compelling copy, branding, metrics, and highlights for ANY niche topic.
 * Falls back to deterministic templates if AI generation is unavailable.
 *
 * @param {string} prompt - User's request text (e.g. "grandma's vintage pottery workshop in Kyoto")
 * @param {object} [custom={}]
 * @returns {Promise<object>} Structured portfolio/website content matching the template schema
 */
export async function synthesizePortfolioData(prompt, custom = {}) {
  const cleanPrompt = (prompt || '').trim();
  if (!cleanPrompt) {
    return buildPortfolioData(custom);
  }

  const systemPrompt = `You are a world-class creative director and web copywriter.
A user wants to create a website with the following prompt:
"${cleanPrompt}"

Synthesize a complete, authentic, high-converting website concept.
Output ONLY a valid JSON object matching this exact schema:
{
  "name": string (compelling business, project, or creator name),
  "role": string (subheading or domain specialty, 4-8 words),
  "headline": string (punchy main hero headline, 5-10 words),
  "tagline": string (engaging 1-2 sentence description),
  "statusBadge": string (relevant short status badge with an emoji, e.g. "🐾 14 Pups Ready" or "☕ Fresh Roast Today"),
  "categoryBadge": string (UPPERCASE category badge, e.g. "SPECIALTY ATELIER" or "ANIMAL RESCUE"),
  "ctaPrimary": string (active button text, 2-3 words, e.g. "Explore Collection"),
  "ctaSecondary": string (secondary button text, e.g. "Get in Touch"),
  "manifestoTitle": string (title for the mission / approach card, 2-4 words),
  "philosophy": string (passionate 1-2 sentence mission statement),
  "headerTag": string (short navbar tag, e.g. "EST. 1892 // KYOTO"),
  "stats": [
    {"label": string, "value": string},
    {"label": string, "value": string},
    {"label": string, "value": string},
    {"label": string, "value": string}
  ],
  "projects": [
    {
      "title": string,
      "category": string,
      "description": string,
      "tags": [string, string]
    },
    {
      "title": string,
      "category": string,
      "description": string,
      "tags": [string, string]
    },
    {
      "title": string,
      "category": string,
      "description": string,
      "tags": [string, string]
    }
  ],
  "skills": [string, string, string, string, string, string],
  "email": string
}
Do not include markdown code fences, backticks, or commentary. Output raw JSON only.`;

  try {
    const agyBin = process.env.AGY_BIN || 'agy';
    const { stdout } = await execFileAsync(agyBin, ['-p', systemPrompt], {
      timeout: 60000,
      env: { ...process.env, PAGER: 'cat' },
    });

    const raw = (stdout || '').trim();
    // Strip possible markdown fences and non-JSON preamble
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON object found in LLM output');
    }
    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed && parsed.name && parsed.headline && Array.isArray(parsed.stats)) {
      return {
        ...parsed,
        github: custom.github || 'https://instagram.com',
        twitter: custom.twitter || 'https://twitter.com',
        prompt: cleanPrompt,
        ...custom,
      };
    }
  } catch (err) {
    console.warn('[PortfolioSynthesizer] Local AI synthesis fallback note:', err.message);
  }

  // Graceful deterministic fallback
  return buildPortfolioData({ prompt: cleanPrompt, ...custom });
}
