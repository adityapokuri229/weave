import { geminiClient } from '../gemini-client.js';

/**
 * Fetches recent live design inspiration entries from Minimal Gallery RSS feed.
 * @returns {Promise<Array<{ title: string, link: string, categories: string[], imageUrl?: string }>>}
 */
export async function fetchMinimalGalleryInspiration() {
  try {
    const res = await fetch('https://minimal.gallery/feed/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WeaveDesignBot/1.0)' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const xml = await res.text();

    const items = [];
    const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    for (const rawItem of itemMatches.slice(0, 6)) {
      const title = rawItem.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1] || '';
      const link = rawItem.match(/<link>(.*?)<\/link>/)?.[1] || '';
      const categories = [...rawItem.matchAll(/<category>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/category>/g)].map(
        (m) => m[1]
      );
      const imageUrl = rawItem.match(/<img[^>]+src="([^">]+)"/)?.[1] || '';
      if (title) {
        items.push({ title, link, categories, imageUrl });
      }
    }
    return items;
  } catch (err) {
    console.warn('[InspirationResearcher] Minimal Gallery feed notice:', err.message);
    return [];
  }
}

/**
 * Researches real-world design inspirations across Dribbble, Minimal Gallery, and top web designs
 * for the user's specific domain/topic using Gemini.
 *
 * @param {string} prompt - The user's website request
 * @param {object} [options]
 * @returns {Promise<{
 *   topicAnalysis: { domain: string, targetAudience: string, benchmarkSites: string[] },
 *   inspirations: Array<{
 *     option: number,
 *     id: string,
 *     name: string,
 *     sourceInspiration: string,
 *     aestheticDescription: string,
 *     fontHeading: string,
 *     fontBody: string,
 *     googleFontsUrl: string,
 *     stitchHeadlineFont: string,
 *     stitchBodyFont: string,
 *     colors: { bg: string, bgCard: string, accent: string, accentSecondary: string, textPrimary: string, textMuted: string, border: string },
 *     components: string[],
 *     stitchPrompt: string
 *   }>
 * }>}
 */
export async function researchDesignInspirations(prompt, options = {}) {
  const minimalGalleryItems = await fetchMinimalGalleryInspiration();
  const minimalGalleryContext = minimalGalleryItems.length > 0
    ? `Recent curated sites on Minimal Gallery:\n` +
      minimalGalleryItems.map((i) => `- "${i.title}" (${i.categories.join(', ')}): ${i.link}`).join('\n')
    : `Curated gallery references: Minimal Gallery, Godly.website, Siteinspire, Dribbble Top Product Design.`;

  const systemPrompt = `You are a World-Class Design Director, Web Design Curator, and Design Systems Architect for award-winning sites.
Your mission is to perform deep design inspiration research for a user's website request, referencing actual design trends from Dribbble, Minimal Gallery (minimal.gallery), Godly.website, and top-tier real-world products.

User Prompt: "${prompt}"

Current Live Design Gallery Context:
${minimalGalleryContext}

CRITICAL DIRECTIVE: ZERO AI SLOP OR COOKIE-CUTTER TEMPLATES.
Do NOT use the generic "Alex Chen", and do NOT recycle generic portfolio styles.
Instead, look at the actual industry/niche of the prompt (e.g., if Google Sheets/FinTech, look at Rows.com, Causal.app, Equals.com, Retool, Linear, Dribbble Dark Bento finance UI; if ceramics/pottery, look at Minimal Gallery Studio Arhoj, Jono Pandolfi; if fashion, look at Ssense, Bottega; if AI dev tool, look at Raycast, Vercel, Cursor).

Generate exactly 3 RADICALLY DISTINCT design directions inspired by real design galleries:
- Option 1: "Dribbble High-Craft Product Showcase" (Tailored for Google Stitch MCP: rich UI components, interactive preview mockups, data telemetry, subtle glowing borders, modern tech-forward palette).
- Option 2: "Minimal Gallery Clean Whitespace / Swiss Editorial" (Inspired by minimal.gallery: stark elegance, expansive whitespace, high-contrast typography, monograph chapter cards, refined line dividers).
- Option 3: "Neo-Modern Kinetic Craft / Dynamic Canvas" (Inspired by Godly.website & modern award-winning studios: bold tactile elements, high-contrast badges, micro-metric cards, human-scale tactile aesthetics).

For valid Stitch fonts, stitchHeadlineFont and stitchBodyFont MUST be one of:
"PLAYFAIR_DISPLAY", "SPACE_GROTESK", "DM_SANS", "PLUS_JAKARTA_SANS", "OUTFIT", "INTER", "MONTSERRAT", "MANROPE", "FRAUNCES", "SPACE_MONO", "GOOGLE_SANS", "IBM_PLEX_SERIF"

Output MUST be strictly valid JSON without any markdown or code fences. Format:
{
  "topicAnalysis": {
    "domain": string,
    "brandName": string,
    "tagline": string,
    "headline": string,
    "targetAudience": string,
    "benchmarkSites": [string, string, string],
    "keyFeatures": [
      { "title": string, "description": string, "metric": string }
    ]
  },
  "inspirations": [
    {
      "option": 1,
      "id": string (e.g. "dribbble-data-bento"),
      "name": string (e.g. "Dribbble Dark High-Craft Bento"),
      "sourceInspiration": string (e.g. "Dribbble Top Shot: Autonomous Finance & Rows.com"),
      "aestheticDescription": string (detailed description of visual architecture, spatial rhythm, and materials),
      "fontHeading": string (e.g. "Space Grotesk"),
      "fontBody": string (e.g. "Plus Jakarta Sans"),
      "googleFontsUrl": string (Google Fonts css2 link),
      "stitchHeadlineFont": "SPACE_GROTESK",
      "stitchBodyFont": "PLUS_JAKARTA_SANS",
      "colors": {
        "bg": string (hex),
        "bgCard": string (hex),
        "accent": string (hex),
        "accentSecondary": string (hex),
        "textPrimary": string (hex),
        "textMuted": string (hex),
        "border": string (hex)
      },
      "components": [string, string, string, string],
      "stitchPrompt": string (Exhaustive 3-paragraph prompt specifying the hero layout, bespoke UI mockups, metrics grid, feature showcase, and footer for Google Stitch MCP)
    },
    {
      "option": 2,
      "id": string,
      "name": string,
      "sourceInspiration": string,
      "aestheticDescription": string,
      "fontHeading": string,
      "fontBody": string,
      "googleFontsUrl": string,
      "stitchHeadlineFont": string,
      "stitchBodyFont": string,
      "colors": {
        "bg": string,
        "bgCard": string,
        "accent": string,
        "accentSecondary": string,
        "textPrimary": string,
        "textMuted": string,
        "border": string
      },
      "components": [string, string, string, string],
      "stitchPrompt": string
    },
    {
      "option": 3,
      "id": string,
      "name": string,
      "sourceInspiration": string,
      "aestheticDescription": string,
      "fontHeading": string,
      "fontBody": string,
      "googleFontsUrl": string,
      "stitchHeadlineFont": string,
      "stitchBodyFont": string,
      "colors": {
        "bg": string,
        "bgCard": string,
        "accent": string,
        "accentSecondary": string,
        "textPrimary": string,
        "textMuted": string,
        "border": string
      },
      "components": [string, string, string, string],
      "stitchPrompt": string
    }
  ]
}`;

  try {
    console.log('[InspirationResearcher] Querying Gemini for Dribbble & Minimal Gallery design inspiration...');
    const res = await geminiClient.generateContent(
      `Research Dribbble, Minimal Gallery, and top award-winning design inspirations for: "${prompt}". Return strictly raw JSON.`,
      systemPrompt
    );

    let rawJson = res.text.trim();
    if (rawJson.startsWith('```')) {
      rawJson = rawJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    }

    const parsed = JSON.parse(rawJson);
    if (parsed?.inspirations && parsed.inspirations.length === 3) {
      console.log(`[InspirationResearcher] Successfully researched 3 design directions: ${parsed.inspirations.map((i) => i.name).join(', ')}`);
      return parsed;
    }
  } catch (err) {
    console.warn('[InspirationResearcher] Gemini inspiration research note:', err.message);
  }

  // Domain-specific grounded fallbacks if Gemini is offline
  return getFallbackDesignInspirations(prompt);
}

/**
 * Rich domain fallback inspirations based on keyword detection.
 */
function getFallbackDesignInspirations(prompt) {
  const lower = (prompt || '').toLowerCase();
  const isSheets = lower.match(/(sheet|sheets|spreadsheet|excel|reconcil|ledger|finance|accounting|cfo|fintech)/i);
  const isPottery = lower.match(/(potter|ceramic|clay|kiln|glaze|stoneware|vase|atelier|handmade|craft)/i);

  if (isSheets) {
    return {
      topicAnalysis: {
        domain: 'FinTech & Spreadsheet Automation',
        brandName: 'LedgerSync AI',
        headline: 'Autonomous Financial Reconciliation for Google Sheets',
        tagline: 'Connect bank feeds directly to your spreadsheets, eliminate manual data entry, and close your books 10x faster with AI-matched entries.',
        targetAudience: 'Finance Directors, Controllers, and Accounting Teams',
        benchmarkSites: ['Rows.com', 'Causal.app', 'Equals.com'],
        keyFeatures: [
          { title: 'Sub-second Cell Sync', description: 'Real-time multi-bank transaction streaming directly into Sheets', metric: '<500ms sync' },
          { title: 'Autonomous Variance Matching', description: 'Zero VLOOKUPs needed; AI cross-references invoice numbers and dates', metric: '99.4% auto-match' },
          { title: 'One-Click Month-End Close', description: 'Generates locked trial balance tabs and CFO-ready variance summaries', metric: '24h saved/mo' }
        ]
      },
      inspirations: [
        {
          option: 1,
          id: 'dribbble-finance-bento',
          name: 'Dribbble Dark Bento Showcase',
          sourceInspiration: 'Inspired by Rows.com & Dribbble Top Shot: Dark Glass Financial Matrix',
          aestheticDescription: 'Deep slate background with glowing emerald accents, translucent glass cards, live formula bar preview, and interactive variance telemetry.',
          fontHeading: 'Space Grotesk',
          fontBody: 'Plus Jakarta Sans',
          googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap',
          stitchHeadlineFont: 'SPACE_GROTESK',
          stitchBodyFont: 'PLUS_JAKARTA_SANS',
          colors: {
            bg: '#0B0F17',
            bgCard: 'rgba(15, 23, 42, 0.8)',
            accent: '#10B981',
            accentSecondary: '#06B6D4',
            textPrimary: '#F8FAFC',
            textMuted: '#94A3B8',
            border: 'rgba(255, 255, 255, 0.1)'
          },
          components: ['Formula Bar Telemetry Hero', 'Interactive Variance Table', 'Live Bank Status Ticker', 'SOC2 Security Pill'],
          stitchPrompt: 'Desktop landing page for LedgerSync AI Google Sheets add-on. Hero featuring a live interactive formula bar "=RECONCILE(BankFeed, Invoices)" with animated status pills. Modern dark slate background (#0B0F17) with glowing emerald green accents (#10B981). Bento grid displaying 3-way matching telemetry, multi-currency live tickers, and audit trail snapshots.'
        },
        {
          option: 2,
          id: 'minimal-gallery-editorial',
          name: 'Minimal Gallery Precision Monograph',
          sourceInspiration: 'Inspired by Minimal Gallery: Grafik.co & Equals.com',
          aestheticDescription: 'Warm porcelain white canvas with razor-thin hairline dividers, stark serif typography, monograph-style chapter cards, and zero clutter.',
          fontHeading: 'Playfair Display',
          fontBody: 'DM Sans',
          googleFontsUrl: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Playfair+Display:ital,wght@0,600;0,700;1,400&display=swap',
          stitchHeadlineFont: 'PLAYFAIR_DISPLAY',
          stitchBodyFont: 'DM_SANS',
          colors: {
            bg: '#FDFCF7',
            bgCard: '#FFFFFF',
            accent: '#0A0A0A',
            accentSecondary: '#4A5568',
            textPrimary: '#111827',
            textMuted: '#6B7280',
            border: '#E5E7EB'
          },
          components: ['Asymmetric Serif Masthead', 'Hairline Audit Matrix', 'Two-Column Precision Manifesto', 'Numbered Step Catalog'],
          stitchPrompt: 'Clean minimalist desktop editorial landing page for LedgerSync financial spreadsheet tool. Elegant serif typography (Playfair Display), generous editorial whitespace, stark black-and-white contrast on off-white background (#FDFCF7). Precision audit tables with hairline dividers and monograph chapter numbers.'
        },
        {
          option: 3,
          id: 'godly-tactile-terminal',
          name: 'Godly.website Kinetic Studio',
          sourceInspiration: 'Inspired by Godly.website & Linear.app',
          aestheticDescription: 'High-contrast tactile surfaces, 2px crisp borders, solid drop shadows, vibrant cyan highlighter badges, and interactive telemetry counters.',
          fontHeading: 'Space Grotesk',
          fontBody: 'Inter',
          googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@600;700&display=swap',
          stitchHeadlineFont: 'SPACE_GROTESK',
          stitchBodyFont: 'INTER',
          colors: {
            bg: '#0F172A',
            bgCard: '#1E293B',
            accent: '#38BDF8',
            accentSecondary: '#A855F7',
            textPrimary: '#F1F5F9',
            textMuted: '#94A3B8',
            border: '#334155'
          },
          components: ['Kinetic Telemetry Ticker', 'Split Screen Interactive Demo', 'High-Contrast Badge Grid', 'CFO Proof Quote'],
          stitchPrompt: 'High-energy modern desktop landing page for LedgerSync. Deep navy background (#0F172A) with electric sky-blue accents (#38BDF8). Split hero section showing instant bank connection workflow on the left and live reconciled Google Sheets ledger on the right with glowing verified checkmarks.'
        }
      ]
    };
  }

  // Default bespoke direction
  return {
    topicAnalysis: {
      domain: 'Custom Bespoke Studio',
      brandName: prompt.slice(0, 20) || 'Signature Atelier',
      headline: prompt,
      tagline: 'Modern craftsmanship, bespoke digital experiences, and refined aesthetic engineering.',
      targetAudience: 'Discerning clients and modern users',
      benchmarkSites: ['Minimal.gallery', 'Godly.website', 'Dribbble.com'],
      keyFeatures: [
        { title: 'Bespoke Craftsmanship', description: 'Engineered specifically for this discipline', metric: '100% Custom' },
        { title: 'Interactive Experience', description: 'Engaging modern interfaces with tactile depth', metric: '60fps Micro-interactions' },
        { title: 'Refined Typography', description: 'Curated font pairings inspired by international typographers', metric: 'Bespoke Hierarchy' }
      ]
    },
    inspirations: [
      {
        option: 1,
        id: 'dribbble-showcase',
        name: 'Dribbble High-Craft Product Showcase',
        sourceInspiration: 'Inspired by Dribbble Top UI Showcases & Godly.website',
        aestheticDescription: 'Rich dark canvas with glowing accents, interactive viewport container, and floating telemetry cards.',
        fontHeading: 'Space Grotesk',
        fontBody: 'Plus Jakarta Sans',
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap',
        stitchHeadlineFont: 'SPACE_GROTESK',
        stitchBodyFont: 'PLUS_JAKARTA_SANS',
        colors: {
          bg: '#0B0F17',
          bgCard: '#131B2A',
          accent: '#10B981',
          accentSecondary: '#3B82F6',
          textPrimary: '#F8FAFC',
          textMuted: '#94A3B8',
          border: 'rgba(255, 255, 255, 0.1)'
        },
        components: ['Hero Interactive Viewport', 'Telemetry Status Grid', 'Offerings Matrix', 'Contact Card'],
        stitchPrompt: `Modern desktop showcase for "${prompt}". High-craft dark UI inspired by Dribbble top product designs. Deep slate background (#0B0F17) with glowing mint accents (#10B981), interactive feature cards, and clean typography.`
      },
      {
        option: 2,
        id: 'minimal-editorial',
        name: 'Minimal Gallery Editorial Monograph',
        sourceInspiration: 'Inspired by Minimal Gallery: Clean Functional Monograph',
        aestheticDescription: 'Pure clean whitespace, high-contrast serif headlines, elegant hairline borders, and monograph catalog layout.',
        fontHeading: 'Playfair Display',
        fontBody: 'DM Sans',
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Playfair+Display:ital,wght@0,600;0,700;1,400&display=swap',
        stitchHeadlineFont: 'PLAYFAIR_DISPLAY',
        stitchBodyFont: 'DM_SANS',
        colors: {
          bg: '#FAFAF9',
          bgCard: '#FFFFFF',
          accent: '#1C1917',
          accentSecondary: '#78716C',
          textPrimary: '#0C0A09',
          textMuted: '#57534E',
          border: '#E7E5E4'
        },
        components: ['Asymmetric Masthead', 'Hairline Divider Catalog', 'Two-Column Manifesto', 'Editorial Footer'],
        stitchPrompt: `Clean minimalist desktop landing page for "${prompt}". Inspired by minimal.gallery with serif typography, generous whitespace, off-white background (#FAFAF9), and hairline border dividers.`
      },
      {
        option: 3,
        id: 'godly-tactile',
        name: 'Godly Kinetic Craft',
        sourceInspiration: 'Inspired by Godly.website & Neo-Tactile Studios',
        aestheticDescription: 'Tactile solid borders, high-energy drop shadows, vivid highlighter badges, and bold spatial hierarchy.',
        fontHeading: 'Space Grotesk',
        fontBody: 'Inter',
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@600;700&display=swap',
        stitchHeadlineFont: 'SPACE_GROTESK',
        stitchBodyFont: 'INTER',
        colors: {
          bg: '#0F172A',
          bgCard: '#1E293B',
          accent: '#06B6D4',
          accentSecondary: '#F59E0B',
          textPrimary: '#F1F5F9',
          textMuted: '#94A3B8',
          border: '#334155'
        },
        components: ['Kinetic Hero Banner', 'High-Contrast Badge Grid', 'Offerings Split Section', 'Action Footer'],
        stitchPrompt: `High-energy tactile desktop landing page for "${prompt}". Deep slate navy (#0F172A) with electric cyan badges (#06B6D4), bold cards, and interactive proof metrics.`
      }
    ]
  };
}
