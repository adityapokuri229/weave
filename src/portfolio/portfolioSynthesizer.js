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
/**
 * Generates 3 domain-tailored aesthetic design directions based on the prompt.
 * Used as high-quality fallbacks if LLM output does not provide full aesthetics.
 */
export function buildDomainAesthetics(cleanPrompt, data = {}) {
  const lower = (cleanPrompt || '').toLowerCase();

  // 1. Animals / Dog Shelter / Pets
  if (lower.match(/(dog|shelter|rescue|animal|cat|pet|pup|puppy|adopt|canine|sanctuary)/i)) {
    return [
      {
        option: 1,
        id: 'warm-meadow',
        name: 'Sunlit Meadow & Warm Fur',
        archetype: 'Warm Heartfelt Cuddle Cards',
        description: 'Warm honey cream, earthy terracotta, rounded cuddly cards, and compassionate adoption badges.',
        fontHeading: "'Outfit', sans-serif",
        fontBody: "'Plus Jakarta Sans', sans-serif",
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap',
        colors: {
          bg: '#FDFBF7',
          bgCard: '#FFFFFF',
          accent: '#D96B43',
          accentSecondary: '#F2A93B',
          textPrimary: '#2D231E',
          textMuted: '#7D7068',
          border: '#EFE7DC',
          heroGlow: 'radial-gradient(circle at 50% 20%, rgba(242, 169, 59, 0.15) 0%, transparent 70%)',
        },
        ui: {
          borderRadius: '1.5rem',
          borderWidth: '1px',
          shadow: '0 12px 32px -4px rgba(217, 107, 67, 0.08)',
          layoutMode: 'modular',
        },
      },
      {
        option: 2,
        id: 'sanctuary-trust',
        name: 'Sanctuary Trust Minimal',
        archetype: 'High-Trust Non-Profit Editorial',
        description: 'Clean ivory canvas, deep forest sage accents, and transparent donor impact metrics.',
        fontHeading: "'Fraunces', serif",
        fontBody: "'DM Sans', sans-serif",
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=DM+Sans:wght@400;500;700&display=swap',
        colors: {
          bg: '#F7F6F2',
          bgCard: '#FFFFFF',
          accent: '#2C402E',
          accentSecondary: '#8B9D83',
          textPrimary: '#1E241F',
          textMuted: '#687269',
          border: '#E3E0D8',
          heroGlow: 'none',
        },
        ui: {
          borderRadius: '0.5rem',
          borderWidth: '1px',
          shadow: '0 4px 20px -2px rgba(44, 64, 46, 0.05)',
          layoutMode: 'editorial',
        },
      },
      {
        option: 3,
        id: 'playful-paws',
        name: 'Playful Rescue Club',
        archetype: 'Tactile Joyful Adoption Badges',
        description: 'High-contrast tactile cards, sky blue accents, sunny apricot stickers, and playful badges.',
        fontHeading: "'Space Grotesk', sans-serif",
        fontBody: "'Inter', sans-serif",
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@600;700&display=swap',
        colors: {
          bg: '#FFFDF0',
          bgCard: '#FFFFFF',
          accent: '#0284C7',
          accentSecondary: '#F97316',
          textPrimary: '#0F172A',
          textMuted: '#64748B',
          border: '#0F172A',
          heroGlow: 'none',
        },
        ui: {
          borderRadius: '0.75rem',
          borderWidth: '2px',
          shadow: '4px 4px 0px #0F172A',
          layoutMode: 'tactile',
        },
      },
    ];
  }

  // 2. Underwater / Marine / Robotics / Tech
  if (lower.match(/(drone|underwater|marine|ocean|robot|submersible|reef|dive|sea|biolog)/i)) {
    return [
      {
        option: 1,
        id: 'abyssal-sonar',
        name: 'Abyssal Sonar Telemetry',
        archetype: 'Deep Ocean Sonar Telemetry',
        description: 'Midnight oceanic dark mode, bioluminescent cyan glows, and sub-sea telemetry coordinates.',
        fontHeading: "'Plus Jakarta Sans', sans-serif",
        fontBody: "'JetBrains Mono', monospace",
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap',
        colors: {
          bg: '#030B14',
          bgCard: 'rgba(8, 20, 36, 0.75)',
          accent: '#00F0FF',
          accentSecondary: '#38BDF8',
          textPrimary: '#F0F9FF',
          textMuted: '#7DD3FC',
          border: 'rgba(0, 240, 255, 0.2)',
          heroGlow: 'radial-gradient(circle at 50% 10%, rgba(0, 240, 255, 0.15) 0%, transparent 60%)',
        },
        ui: {
          borderRadius: '0.75rem',
          borderWidth: '1px',
          shadow: '0 0 25px rgba(0, 240, 255, 0.1)',
          layoutMode: 'modular',
        },
      },
      {
        option: 2,
        id: 'marine-lab',
        name: 'Oceanographic Research Expedition',
        archetype: 'Marine Laboratory Editorial',
        description: 'Deep navy trench accents, crisp glacier white canvas, and peer-reviewed scientific clarity.',
        fontHeading: "'Cinzel', serif",
        fontBody: "'DM Sans', sans-serif",
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=DM+Sans:wght@400;500;700&display=swap',
        colors: {
          bg: '#F8FAFC',
          bgCard: '#FFFFFF',
          accent: '#0369A1',
          accentSecondary: '#0284C7',
          textPrimary: '#0C4A6E',
          textMuted: '#475569',
          border: '#E2E8F0',
          heroGlow: 'none',
        },
        ui: {
          borderRadius: '0.375rem',
          borderWidth: '1px',
          shadow: '0 4px 15px -2px rgba(12, 74, 110, 0.06)',
          layoutMode: 'editorial',
        },
      },
      {
        option: 3,
        id: 'submersible-spec',
        name: 'Submersible Expedition Tactical',
        archetype: 'Industrial Marine Hardware',
        description: 'Titanium graphite, deep-sea diver safety orange, and pressure-tested depth badges.',
        fontHeading: "'Space Grotesk', sans-serif",
        fontBody: "'Inter', sans-serif",
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@700&display=swap',
        colors: {
          bg: '#0F172A',
          bgCard: '#1E293B',
          accent: '#FF5722',
          accentSecondary: '#F59E0B',
          textPrimary: '#F8FAFC',
          textMuted: '#94A3B8',
          border: '#FF5722',
          heroGlow: 'none',
        },
        ui: {
          borderRadius: '0.25rem',
          borderWidth: '2px',
          shadow: '4px 4px 0px #FF5722',
          layoutMode: 'tactile',
        },
      },
    ];
  }

  // 3. Craft / Pottery / Bakery / Atelier
  if (lower.match(/(potter|ceramic|bakery|bake|coffee|cafe|craft|atelier|handmade|artisan|japan|kyoto)/i)) {
    return [
      {
        option: 1,
        id: 'earth-clay',
        name: 'Wabi-Sabi Earth & Clay',
        archetype: 'Artisan Stoneware Tactile',
        description: 'Raw stoneware textures, warm ochre, tatami neutrals, and quiet serif elegance.',
        fontHeading: "'Cinzel', serif",
        fontBody: "'Plus Jakarta Sans', sans-serif",
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap',
        colors: {
          bg: '#F5F2EB',
          bgCard: '#ECE7DD',
          accent: '#A85A32',
          accentSecondary: '#3D4A3E',
          textPrimary: '#2B2620',
          textMuted: '#6E655B',
          border: '#DDD6C8',
          heroGlow: 'none',
        },
        ui: {
          borderRadius: '0.5rem',
          borderWidth: '1px',
          shadow: '0 4px 20px -2px rgba(43, 38, 32, 0.06)',
          layoutMode: 'modular',
        },
      },
      {
        option: 2,
        id: 'kiln-charcoal',
        name: 'Charcoal Kiln & Iron Glaze',
        archetype: 'Smokey Kiln Minimalism',
        description: 'Deep smokey charcoal stoneware, glowing embers of terracotta, and modern artisan minimalism.',
        fontHeading: "'Cormorant Garamond', serif",
        fontBody: "'DM Sans', sans-serif",
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=DM+Sans:wght@400;500&display=swap',
        colors: {
          bg: '#1A1715',
          bgCard: '#24201D',
          accent: '#E27238',
          accentSecondary: '#D4B483',
          textPrimary: '#F7F4EF',
          textMuted: '#A39B91',
          border: '#38322D',
          heroGlow: 'radial-gradient(circle at 50% 20%, rgba(226, 114, 56, 0.12) 0%, transparent 60%)',
        },
        ui: {
          borderRadius: '0.25rem',
          borderWidth: '1px',
          shadow: '0 10px 30px -5px rgba(0, 0, 0, 0.5)',
          layoutMode: 'editorial',
        },
      },
      {
        option: 3,
        id: 'kyoto-gallery',
        name: 'Kyoto Craft Studio Gallery',
        archetype: 'Clean Japanese Editorial',
        description: 'Crisp gallery white, matcha green accents, and clean contemporary Japanese editorial spacing.',
        fontHeading: "'Playfair Display', serif",
        fontBody: "'Inter', sans-serif",
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:ital,wght@0,600;0,700;1,400&display=swap',
        colors: {
          bg: '#FAFAF9',
          bgCard: '#FFFFFF',
          accent: '#405B48',
          accentSecondary: '#B87333',
          textPrimary: '#1C1917',
          textMuted: '#78716C',
          border: '#E7E5E4',
          heroGlow: 'none',
        },
        ui: {
          borderRadius: '0.75rem',
          borderWidth: '1px',
          shadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
          layoutMode: 'tactile',
        },
      },
    ];
  }

  // Default Universal Archetypes (Modern, Editorial, Dynamic)
  return [
    {
      option: 1,
      id: 'modern-prime',
      name: 'Modern Atelier Signature',
      archetype: 'Modern Modular Grid',
      description: 'Sophisticated dark slate canvas with glowing accent telemetry and polished modular cards.',
      fontHeading: "'Plus Jakarta Sans', sans-serif",
      fontBody: "'Inter', sans-serif",
      googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap',
      colors: {
        bg: '#090D16',
        bgCard: '#111827',
        accent: '#6366F1',
        accentSecondary: '#06B6D4',
        textPrimary: '#F9FAFB',
        textMuted: '#9CA3AF',
        border: 'rgba(255, 255, 255, 0.1)',
        heroGlow: 'radial-gradient(circle at 50% 10%, rgba(99, 102, 241, 0.15) 0%, transparent 60%)',
      },
      ui: {
        borderRadius: '1rem',
        borderWidth: '1px',
        shadow: '0 10px 30px -5px rgba(0, 0, 0, 0.4)',
        layoutMode: 'modular',
      },
    },
    {
      option: 2,
      id: 'editorial-serif',
      name: 'High-Impact Editorial Minimal',
      archetype: 'Editorial Monospace Serif',
      description: 'Serif headlines, generous editorial whitespace, and high-contrast timeless layout.',
      fontHeading: "'Playfair Display', serif",
      fontBody: "'Plus Jakarta Sans', sans-serif",
      googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,800;1,400&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap',
      colors: {
        bg: '#FAF9F6',
        bgCard: '#FFFFFF',
        accent: '#18181B',
        accentSecondary: '#71717A',
        textPrimary: '#18181B',
        textMuted: '#52525B',
        border: '#E4E4E7',
        heroGlow: 'none',
      },
      ui: {
        borderRadius: '0.25rem',
        borderWidth: '1px',
        shadow: '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
        layoutMode: 'editorial',
      },
    },
    {
      option: 3,
      id: 'dynamic-tactile',
      name: 'Tactile Energy & Bold Badges',
      archetype: 'Neo-Tactile Badges',
      description: 'High-energy borders, tactile drop shadows, and vibrant highlighter badges.',
      fontHeading: "'Space Grotesk', sans-serif",
      fontBody: "'Inter', sans-serif",
      googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@600;700&display=swap',
      colors: {
        bg: '#FDFDFD',
        bgCard: '#FFFFFF',
        accent: '#F59E0B',
        accentSecondary: '#EC4899',
        textPrimary: '#18181B',
        textMuted: '#52525B',
        border: '#18181B',
        heroGlow: 'none',
      },
      ui: {
        borderRadius: '0.5rem',
        borderWidth: '2px',
        shadow: '4px 4px 0px #18181B',
        layoutMode: 'tactile',
      },
    },
  ];
}

/**
 * Dynamically synthesizes 100% custom, domain-specific website content using local AI (agy CLI).
 * Researches the niche domain, synthesizes authentic copy, AND produces 3 bespoke aesthetic design philosophies.
 *
 * @param {string} prompt - User's request text (e.g. "underwater drone startup for marine biologists")
 * @param {object} [custom={}]
 * @returns {Promise<object>}
 */
export async function synthesizePortfolioData(prompt, custom = {}) {
  const cleanPrompt = (prompt || '').trim();
  if (!cleanPrompt) {
    const base = buildPortfolioData(custom);
    base.aesthetics = buildDomainAesthetics('general', base);
    return base;
  }

  const systemPrompt = `You are an elite creative design director, brand strategist, and web architect.
A user wants to create a website with the following prompt:
"${cleanPrompt}"

TASK:
1. Research and analyze the visual aesthetic, industry design benchmarks, typography conventions, and color theory for this specific domain.
2. Synthesize authentic, high-converting copy tailored to this exact business/project.
3. Formulate 3 BESPOKE, TOPIC-INSPIRED AESTHETIC DESIGN DIRECTIONS (never use generic tech presets like "Bento/Brutalist" unless the user specifically asked for that). Each aesthetic must be directly inspired by real-world visual references in this industry (e.g. materials, lighting, typography, and mood).

Output ONLY a valid JSON object matching this exact schema:
{
  "name": string (compelling business, project, or creator name),
  "role": string (subheading or domain specialty, 4-8 words),
  "headline": string (punchy main hero headline, 5-10 words),
  "tagline": string (engaging 1-2 sentence description),
  "statusBadge": string (relevant short status badge with an emoji, e.g. "🐾 14 Dogs Ready" or "🏺 Kiln Fired Daily"),
  "categoryBadge": string (UPPERCASE category badge, e.g. "SPECIALTY ATELIER" or "ANIMAL RESCUE"),
  "ctaPrimary": string (active button text, 2-3 words, e.g. "Meet Rescues" or "Explore Vessels"),
  "ctaSecondary": string (secondary button text, e.g. "Volunteer / Foster" or "Book Workshop"),
  "manifestoTitle": string (title for the mission / approach card, 2-4 words),
  "philosophy": string (passionate 1-2 sentence mission statement),
  "headerTag": string (short navbar tag, e.g. "NO-KILL RESCUE // 2026"),
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
  "email": string,
  "aesthetics": [
    {
      "option": 1,
      "id": string (short slug, e.g. "warm-meadow"),
      "name": string (evocative aesthetic name, e.g. "Sunlit Meadow & Warm Fur"),
      "archetype": string (short 2-4 word stylistic archetype),
      "description": string (1-2 sentences on the visual mood, palette, and materials inspired by this domain),
      "fontHeading": string (e.g. "'Outfit', sans-serif" or "'Cinzel', serif" or "'Playfair Display', serif"),
      "fontBody": string (e.g. "'Plus Jakarta Sans', sans-serif" or "'DM Sans', sans-serif"),
      "googleFontsUrl": string (valid Google Fonts css2 link),
      "colors": {
        "bg": string (Hex background color),
        "bgCard": string (Hex card background),
        "accent": string (Primary brand accent hex),
        "accentSecondary": string (Secondary accent / badge hex),
        "textPrimary": string (Main readable text hex),
        "textMuted": string (Subdued secondary text hex),
        "border": string (Border hex),
        "heroGlow": string (CSS gradient glow for hero or "none")
      },
      "ui": {
        "borderRadius": string (e.g. "1.25rem", "0.5rem", "0.25rem"),
        "borderWidth": string (e.g. "1px", "2px"),
        "shadow": string (e.g. "0 10px 30px -5px rgba(0,0,0,0.08)"),
        "layoutMode": "modular"
      }
    },
    {
      "option": 2,
      "id": string,
      "name": string,
      "archetype": string,
      "description": string,
      "fontHeading": string,
      "fontBody": string,
      "googleFontsUrl": string,
      "colors": {
        "bg": string,
        "bgCard": string,
        "accent": string,
        "accentSecondary": string,
        "textPrimary": string,
        "textMuted": string,
        "border": string,
        "heroGlow": string
      },
      "ui": {
        "borderRadius": string,
        "borderWidth": string,
        "shadow": string,
        "layoutMode": "editorial"
      }
    },
    {
      "option": 3,
      "id": string,
      "name": string,
      "archetype": string,
      "description": string,
      "fontHeading": string,
      "fontBody": string,
      "googleFontsUrl": string,
      "colors": {
        "bg": string,
        "bgCard": string,
        "accent": string,
        "accentSecondary": string,
        "textPrimary": string,
        "textMuted": string,
        "border": string,
        "heroGlow": string
      },
      "ui": {
        "borderRadius": string,
        "borderWidth": string,
        "shadow": string,
        "layoutMode": "tactile"
      }
    }
  ]
}
Do not include markdown code fences, backticks, or commentary. Output raw JSON only.`;

  try {
    const agyBin = process.env.AGY_BIN || 'agy';
    const { stdout } = await execFileAsync(agyBin, ['-p', systemPrompt], {
      timeout: 60000,
      env: { ...process.env, PAGER: 'cat' },
    });

    const raw = (stdout || '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON object found in LLM output');
    }
    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed && parsed.name && parsed.headline && Array.isArray(parsed.stats)) {
      // Ensure 3 valid aesthetics exist
      if (!Array.isArray(parsed.aesthetics) || parsed.aesthetics.length < 3) {
        parsed.aesthetics = buildDomainAesthetics(cleanPrompt, parsed);
      }

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

  // Graceful deterministic fallback with domain aesthetics
  const fallback = buildPortfolioData({ prompt: cleanPrompt, ...custom });
  fallback.aesthetics = buildDomainAesthetics(cleanPrompt, fallback);
  return fallback;
}
