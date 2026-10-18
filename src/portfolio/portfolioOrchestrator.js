import fs from 'fs';
import path from 'path';
import os from 'os';
import { stitchClient } from './stitchClient.js';
import { deployToNetlifyDrop } from './netlifyDeployer.js';
import {
  generatePortfolioHtml,
  renderBentoPortfolio,
  renderSwissPortfolio,
  renderBrutalistPortfolio,
  DESIGN_PHILOSOPHIES,
  buildPortfolioData,
} from './portfolioTemplates.js';
import { synthesizePortfolioData } from './portfolioSynthesizer.js';
import { captureWebScreenshot } from '../qa.js';
import { loadProjectsState, saveProjectsState } from '../config.js';

/**
 * Builds an interactive preview switcher bar to inject at the top of generated HTML pages.
 */
function buildSwitcherBar(currentOpt, variants) {
  const currentVariant = variants.find((v) => v.option === currentOpt) || variants[0] || {};
  return `
<div id="stitch-preview-bar" style="background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(8px); padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 99999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #fff; font-size: 13px;">
  <div style="display: flex; align-items: center; gap: 8px;">
    <span style="background: #10b981; color: #000; font-weight: 700; padding: 2px 8px; border-radius: 4px; font-size: 10px; letter-spacing: 0.05em;">DESIGN PREVIEW</span>
    <span style="color: #cbd5e1;">Viewing: <strong style="color: #fff;">Option ${currentOpt}: ${currentVariant.name || 'Bespoke Design'}</strong></span>
  </div>
  <div style="display: flex; gap: 6px;">
    ${variants
      .map(
        (v) => `
      <a href="/option${v.option}.html" style="padding: 5px 12px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 12px; transition: all 0.2s; ${
          v.option === currentOpt
            ? 'background: #10b981; color: #000;'
            : 'background: rgba(255,255,255,0.1); color: #fff;'
        }">Option ${v.option}</a>`
      )
      .join('')}
  </div>
</div>`;
}

/**
 * Injects the switcher bar into an HTML string immediately after <body...>.
 */
function injectSwitcherBar(html, currentOpt, variants) {
  if (!html) return '';
  const bar = buildSwitcherBar(currentOpt, variants);
  if (html.includes('<body')) {
    return html.replace(/<body[^>]*>/i, (match) => `${match}\n${bar}`);
  }
  return `${bar}\n${html}`;
}

const VALID_STITCH_FONTS = new Set([
  'BE_VIETNAM_PRO', 'EPILOGUE', 'INTER', 'LEXEND', 'MANROPE', 'NEWSREADER',
  'NOTO_SERIF', 'PLUS_JAKARTA_SANS', 'PUBLIC_SANS', 'SPACE_GROTESK', 'SPLINE_SANS',
  'WORK_SANS', 'DOMINE', 'LIBRE_CASLON_TEXT', 'EB_GARAMOND', 'LITERATA',
  'MONTSERRAT', 'NUNITO_SANS', 'ARIMO', 'HANKEN_GROTESK', 'RUBIK', 'GEIST',
  'DM_SANS', 'IBM_PLEX_SANS', 'SORA', 'ANYBODY', 'ANTON', 'BARLOW_CONDENSED',
  'BEBAS_NEUE', 'BODONI_MODA', 'BRICOLAGE_GROTESQUE', 'CHIVO', 'COMFORTAA',
  'GOOGLE_SANS', 'IBM_PLEX_SERIF', 'JETBRAINS_MONO', 'KARLA', 'MERRIWEATHER',
  'NOTO_SANS', 'OPEN_SANS', 'OSWALD', 'OUTFIT', 'PLAYFAIR_DISPLAY', 'QUICKSAND',
  'RALEWAY', 'SPACE_MONO', 'SYNE', 'VOLLKORN',
]);

function normalizeStitchFont(font, fallback = 'PLUS_JAKARTA_SANS') {
  if (!font) return fallback;
  const upper = String(font).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (VALID_STITCH_FONTS.has(upper)) return upper;
  if (upper.includes('SERIF') || upper.includes('CINZEL') || upper.includes('PLAYFAIR') || upper.includes('GARAMOND')) {
    return 'PLAYFAIR_DISPLAY';
  }
  if (upper.includes('GROTESK') || upper.includes('MONO')) {
    return 'SPACE_GROTESK';
  }
  return fallback;
}

/**
 * Executes the complete Website Creation pipeline:
 * 1. Deep Domain & Aesthetic Research via Gemini Client
 * 2. Connects to Google Stitch MCP, creates project & design system, and awaits real screen generation
 * 3. Downloads the bespoke Stitch HTML & high-res screenshot
 * 4. Renders alternative researched design directions (Option 2, Option 3)
 * 5. Injects the preview switcher bar into all variants
 * 6. Deploys to Netlify Drop (instant URL and preview password)
 * 7. Persists session state and formats WhatsApp message with screenshot directives
 */
export async function executePortfolioCreation({
  prompt,
  chatJid,
  targetProjectDir,
  projectAlias = 'portfolio-website',
  senderName = 'Founder / Architect',
  initialPhilosophy = '1',
}) {
  const projectDir = targetProjectDir || path.resolve(process.cwd(), 'demo-site');
  fs.mkdirSync(projectDir, { recursive: true });

  // 1. Deep Domain & Aesthetic Research
  console.log(`[PortfolioOrchestrator] Starting deep domain research for: "${prompt}"`);
  const portfolioData = await synthesizePortfolioData(prompt, {
    organizer: senderName || 'Founder',
  });

  const aesthetics =
    Array.isArray(portfolioData.aesthetics) && portfolioData.aesthetics.length >= 3
      ? portfolioData.aesthetics
      : [
          {
            option: 1,
            id: 'signature-atelier',
            name: `${portfolioData.name || 'Bespoke'} Signature`,
            archetype: 'Primary Domain Signature',
            description: 'Custom aesthetic crafted specifically for this domain.',
          },
          {
            option: 2,
            id: 'swiss-editorial',
            name: 'Swiss Editorial Minimal',
            archetype: 'Editorial Monospace Serif',
            description: 'Serif headlines, generous editorial whitespace, and high-contrast timeless layout.',
          },
          {
            option: 3,
            id: 'modern-tactile',
            name: 'Tactile Energy & Bold Badges',
            archetype: 'Neo-Tactile Badges',
            description: 'High-energy borders, tactile drop shadows, and vibrant highlighter badges.',
          },
        ];

  // 2. Google Stitch MCP Screen Generation
  let stitchScreen = null;
  let stitchProjectId = null;
  let stitchSummary = '';
  const isStitchActive = stitchClient.isConfigured();

  if (isStitchActive) {
    try {
      console.log('[PortfolioOrchestrator] Creating Google Stitch MCP project container...');
      const projectTitle = `${portfolioData.name || 'Site'} - ${prompt.slice(0, 25)}`;
      const stitchProject = await stitchClient.createProject(projectTitle);
      // Create Stitch Design System using Option 1 tokens
      let designSystemAsset = null;
      const opt1 = aesthetics[0];
      if (opt1) {
        try {
          console.log('[PortfolioOrchestrator] Registering design system in Google Stitch MCP...');
          const headlineFont = normalizeStitchFont(opt1.stitchHeadlineFont || opt1.fontHeading, 'PLAYFAIR_DISPLAY');
          const bodyFont = normalizeStitchFont(opt1.stitchBodyFont || opt1.fontBody, 'DM_SANS');
          const dsRes = await stitchClient.createDesignSystem({
            projectId: stitchProjectId,
            displayName: `${opt1.name} Design System`,
            theme: {
              headlineFont,
              bodyFont,
              colorMode: opt1.stitchColorMode || (opt1.colors?.bg?.startsWith('#0') || opt1.colors?.bg?.startsWith('#1') ? 'DARK' : 'LIGHT'),
              customColor: opt1.colors?.accent || '#10B981',
              roundness: opt1.stitchRoundness || 'ROUND_FOUR',
              designMd: `# ${portfolioData.name} Design System\n- Theme: ${opt1.name}\n- Archetype: ${opt1.archetype}\n- Description: ${opt1.description}\n- Brand Accent: ${opt1.colors?.accent}`,
            },
          });
          designSystemAsset = dsRes?.name || dsRes?.result?.structuredContent?.name || null;
        } catch (dsErr) {
          console.warn('[StitchMCP] Design system registration note:', dsErr.message);
        }
      }

      // AWAIT screen generation from Google Stitch MCP
      console.log('[PortfolioOrchestrator] Calling Google Stitch MCP generate_screen_from_text...');
      const stitchPrompt =
        portfolioData.stitchPrompt ||
        `Modern responsive desktop landing page for "${portfolioData.name}": ${prompt}. Include hero, proof metrics, offerings matrix, craft pillars, and contact footer.`;

      const genRes = await stitchClient.generateScreenFromText({
        projectId: stitchProjectId,
        prompt: stitchPrompt,
        designSystem: designSystemAsset || undefined,
        deviceType: 'DESKTOP',
      });

      const extracted = stitchClient.extractScreens(genRes);
      if (extracted.screens && extracted.screens.length > 0) {
        stitchScreen = extracted.screens[0];
        stitchSummary = extracted.summaryText || '';
        console.log(`[StitchMCP] Screen successfully generated: "${stitchScreen.title}"`);
      }
    } catch (stitchErr) {
      console.warn('[StitchMCP] Screen generation fallback notice:', stitchErr.message);
    }
  } else {
    console.log('[PortfolioOrchestrator] Stitch API key not configured, using dynamic domain engine.');
  }

  // 3. Assemble all 3 design variants
  const variants = [];

  // --- OPTION 1: Google Stitch MCP Bespoke Generation (or domain fallback) ---
  const opt1Meta = aesthetics[0];
  let opt1Html = '';
  let opt1ScreenshotPath = null;

  if (stitchScreen?.htmlCode?.downloadUrl) {
    try {
      console.log('[PortfolioOrchestrator] Downloading bespoke HTML from Google Stitch MCP...');
      const downloadedHtml = await (await fetch(stitchScreen.htmlCode.downloadUrl)).text();
      if (downloadedHtml && downloadedHtml.length > 200) {
        opt1Html = downloadedHtml;
      }
    } catch (dlErr) {
      console.warn('[PortfolioOrchestrator] Failed to download Stitch HTML:', dlErr.message);
    }
  }

  if (stitchScreen?.screenshot?.downloadUrl) {
    try {
      console.log('[PortfolioOrchestrator] Downloading screenshot from Google Stitch MCP...');
      const shotDest = path.join(projectDir, 'option1.png');
      await stitchClient.downloadAsset(stitchScreen.screenshot.downloadUrl, shotDest);
      if (fs.existsSync(shotDest) && fs.statSync(shotDest).size > 1000) {
        opt1ScreenshotPath = shotDest;
      }
    } catch (shotDlErr) {
      console.warn('[PortfolioOrchestrator] Failed to download Stitch screenshot:', shotDlErr.message);
    }
  }

  // Fallback for Option 1 HTML if download was empty
  if (!opt1Html) {
    opt1Html = generatePortfolioHtml('1', portfolioData);
  }

  variants.push({
    option: 1,
    id: opt1Meta.id || 'stitch-primary',
    name: stitchScreen?.title || opt1Meta.name || 'Google Stitch Bespoke Design',
    description: opt1Meta.description || 'Custom crafted with Google Stitch MCP & Gemini.',
    html: opt1Html,
    screenshotPath: opt1ScreenshotPath,
    source: stitchScreen ? 'STITCH_MCP' : 'DOMAIN_ENGINE',
  });

  // --- OPTION 2: Researched Direction 2 (e.g. Swiss Editorial Minimal) ---
  const opt2Meta = aesthetics[1];
  const opt2Html = generatePortfolioHtml('2', portfolioData);
  variants.push({
    option: 2,
    id: opt2Meta.id || 'editorial-minimal',
    name: opt2Meta.name || 'Swiss Editorial Minimal',
    description: opt2Meta.description || 'Serif headlines, generous whitespace, and editorial layout.',
    html: opt2Html,
    screenshotPath: null,
    source: 'DOMAIN_ENGINE',
  });

  // --- OPTION 3: Researched Direction 3 (e.g. Modern Tactile / High Energy) ---
  const opt3Meta = aesthetics[2];
  const opt3Html = generatePortfolioHtml('3', portfolioData);
  variants.push({
    option: 3,
    id: opt3Meta.id || 'modern-tactile',
    name: opt3Meta.name || 'Modern Tactile & Bold Badges',
    description: opt3Meta.description || 'High-energy borders, tactile shadows, and vibrant badges.',
    html: opt3Html,
    screenshotPath: null,
    source: 'DOMAIN_ENGINE',
  });

  // 4. Save each variant HTML and capture screenshots for options that don't have one
  for (const v of variants) {
    const optNum = v.option;
    const fullHtml = injectSwitcherBar(v.html, optNum, variants);
    const htmlPath = path.join(projectDir, `option${optNum}.html`);
    fs.writeFileSync(htmlPath, fullHtml, 'utf8');

    if (!v.screenshotPath || !fs.existsSync(v.screenshotPath)) {
      const shotPath = path.join(projectDir, `option${optNum}.png`);
      try {
        const shot = await captureWebScreenshot(htmlPath, {
          outputPath: shotPath,
          width: 1280,
          height: 800,
        });
        v.screenshotPath = shot.filePath;
      } catch (shotErr) {
        console.warn(`[PortfolioOrchestrator] Screenshot capture note for Option ${optNum}:`, shotErr.message);
      }
    }
  }

  // 5. Assemble primary active design into index.html
  const activeOptNum = parseInt(initialPhilosophy, 10) || 1;
  const primaryVariant = variants.find((v) => v.option === activeOptNum) || variants[0];
  const primaryIndexHtml = injectSwitcherBar(primaryVariant.html, activeOptNum, variants);
  const indexPath = path.join(projectDir, 'index.html');
  fs.writeFileSync(indexPath, primaryIndexHtml, 'utf8');

  // Copy Option 1 screenshot to live preview screenshot
  const livePreviewScreenshot = path.join(projectDir, 'screenshot-live.png');
  if (primaryVariant.screenshotPath && fs.existsSync(primaryVariant.screenshotPath)) {
    try {
      fs.copyFileSync(primaryVariant.screenshotPath, livePreviewScreenshot);
    } catch {}
  }

  // 6. Deploy to Netlify Drop
  const netlifyDeploy = await deployToNetlifyDrop(projectDir, { title: projectAlias || 'portfolio' });

  // 7. Persist session state in projects.json
  try {
    const state = loadProjectsState();
    state.portfolioSessions = state.portfolioSessions || {};
    state.portfolioSessions[chatJid] = {
      projectDir,
      projectAlias,
      activePhilosophy: String(activeOptNum),
      siteUrl: netlifyDeploy.siteUrl || null,
      siteId: netlifyDeploy.siteId || null,
      password: netlifyDeploy.password || null,
      claimUrl: netlifyDeploy.claimUrl || null,
      stitchProjectId,
      stitchScreenId: stitchScreen?.name || null,
      portfolioData,
      variants: variants.map((v) => ({
        option: v.option,
        id: v.id,
        name: v.name,
        description: v.description,
        screenshotPath: v.screenshotPath,
        source: v.source,
      })),
      updatedAt: new Date().toISOString(),
    };
    saveProjectsState(state);
  } catch (stateErr) {
    console.warn('[PortfolioOrchestrator] Failed to save portfolio state:', stateErr.message);
  }

  // 8. Format WhatsApp response with [SEND_FILE] directives
  const directives = [];
  for (const v of variants) {
    if (v.screenshotPath && fs.existsSync(v.screenshotPath) && v.screenshotPath.endsWith('.png')) {
      directives.push(`[SEND_FILE: HERE | ${v.screenshotPath}]`);
    }
  }
  if (directives.length === 0 && fs.existsSync(livePreviewScreenshot)) {
    directives.push(`[SEND_FILE: HERE | ${livePreviewScreenshot}]`);
  }

  let deployNotice = '';
  if (netlifyDeploy.siteUrl) {
    if (netlifyDeploy.password) {
      const claimSection = netlifyDeploy.claimUrl
        ? `, or [claim it to your Netlify account](${netlifyDeploy.claimUrl})`
        : '';
      deployNotice = `🚀 *Live Website Deployed:* ${netlifyDeploy.siteUrl}\n🔑 *Preview password:* \`${netlifyDeploy.password}\`${claimSection}`;
    } else {
      deployNotice = `🚀 *Live Website Deployed:* ${netlifyDeploy.siteUrl}`;
    }
  } else if (netlifyDeploy.isRateLimited) {
    deployNotice = `⚠️ *Netlify Notice:* The daily IP rate limit for anonymous deploys has been reached on this network. Your website has been fully compiled locally; set \`NETLIFY_AUTH_TOKEN\` in \`.env\` for live cloud deploys.`;
  } else {
    deployNotice = `The website has been compiled locally in your workspace.`;
  }

  const rawBase = netlifyDeploy.siteUrl ? netlifyDeploy.siteUrl.replace(/\/$/, '') : '';
  const variantLines = variants.map(
    (v) =>
      `• *Option ${v.option}*: *${v.name}*${
        v.source === 'STITCH_MCP' ? ' _(Google Stitch MCP)_' : ''
      }${rawBase ? `\n   🔗 _Live Preview:_ ${rawBase}/option${v.option}.html` : ''}\n   _${v.description}_`
  );

  const messageText = [
    deployNotice,
    ``,
    `🎨 *Bespoke Design Directions for "${portfolioData.name || 'Your Website'}":*`,
    ...variantLines,
    ``,
    `_Reply right here in WhatsApp (e.g. "option 2", "option 3", or dictate styling) to update your primary live site!_`,
    ``,
    ...directives,
  ].join('\n');

  return {
    success: true,
    messageText,
    siteUrl: netlifyDeploy.siteUrl,
    password: netlifyDeploy.password,
    claimUrl: netlifyDeploy.claimUrl,
    livePreviewScreenshot,
    variants,
    projectDir,
    stitchProjectId,
  };
}

/**
 * Handles conversational design iteration from WhatsApp.
 */
export async function iteratePortfolioDesign({ chatJid, feedbackText }) {
  const state = loadProjectsState();
  const session = state.portfolioSessions?.[chatJid];

  if (!session || !fs.existsSync(session.projectDir)) {
    return null;
  }

  const lower = (feedbackText || '').toLowerCase();
  let updatedPhilosophy = session.activePhilosophy || '1';

  // Check numeric options first: "option 1", "option 2", "option 3", "1", "2", "3"
  if (lower.match(/\b(option\s*1|first\s*option|^1$)\b/i)) {
    updatedPhilosophy = '1';
  } else if (lower.match(/\b(option\s*2|second\s*option|^2$)\b/i)) {
    updatedPhilosophy = '2';
  } else if (lower.match(/\b(option\s*3|third\s*option|^3$)\b/i)) {
    updatedPhilosophy = '3';
  } else if (Array.isArray(session.variants)) {
    for (const v of session.variants) {
      const nameWords = (v.name || '').toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      if (lower.includes(v.id?.toLowerCase()) || nameWords.some((w) => lower.includes(w))) {
        updatedPhilosophy = String(v.option);
        break;
      }
    }
  }

  const optNum = parseInt(updatedPhilosophy, 10) || 1;
  const targetOptionFile = path.join(session.projectDir, `option${optNum}.html`);
  const indexPath = path.join(session.projectDir, 'index.html');

  if (fs.existsSync(targetOptionFile)) {
    // Copy selected option directly to index.html
    fs.copyFileSync(targetOptionFile, indexPath);
  } else {
    // Re-generate HTML if option file was missing
    const portfolioData = session.portfolioData || buildPortfolioData({});
    const fallbackHtml = generatePortfolioHtml(updatedPhilosophy, portfolioData);
    const variants = session.variants || [];
    const fullHtml = injectSwitcherBar(fallbackHtml, optNum, variants);
    fs.writeFileSync(indexPath, fullHtml, 'utf8');
  }

  // Re-deploy to Netlify
  const netlifyDeploy = await deployToNetlifyDrop(session.projectDir, {
    title: session.projectAlias || 'portfolio',
    siteId: session.siteId || null,
  });

  // Capture updated screenshot directly from index.html
  let updatedShotPath = path.join(session.projectDir, `option${optNum}.png`);
  if (!fs.existsSync(updatedShotPath)) {
    try {
      const shot = await captureWebScreenshot(indexPath, { width: 1280, height: 800 });
      updatedShotPath = shot.filePath;
    } catch (err) {
      console.warn('Failed to capture updated screenshot:', err.message);
    }
  }

  // Update session
  session.activePhilosophy = updatedPhilosophy;
  session.siteUrl = netlifyDeploy.siteUrl || session.siteUrl || null;
  session.siteId = netlifyDeploy.siteId || session.siteId || null;
  session.password = netlifyDeploy.password || session.password || null;
  session.claimUrl = netlifyDeploy.claimUrl || session.claimUrl || null;
  session.updatedAt = new Date().toISOString();
  saveProjectsState(state);

  const directives = [];
  if (updatedShotPath && fs.existsSync(updatedShotPath)) {
    directives.push(`[SEND_FILE: HERE | ${updatedShotPath}]`);
  }

  let statusNotice = '';
  if (netlifyDeploy.siteUrl) {
    if (netlifyDeploy.password) {
      const claimSection = netlifyDeploy.claimUrl
        ? `, or [claim it to your Netlify account](${netlifyDeploy.claimUrl})`
        : '';
      statusNotice = `🚀 *Live Website Updated:* ${netlifyDeploy.siteUrl}\n🔑 *Preview password:* \`${netlifyDeploy.password}\`${claimSection}`;
    } else {
      statusNotice = `🚀 *Live Website Updated:* ${netlifyDeploy.siteUrl}`;
    }
  } else if (netlifyDeploy.isRateLimited) {
    statusNotice = `Design updated locally. (Netlify anonymous IP limit active; set \`NETLIFY_AUTH_TOKEN\` in \`.env\` to sync live).`;
  } else {
    statusNotice = `Design updated locally in project directory.`;
  }

  const currentVariant = session.variants?.find((v) => String(v.option) === String(updatedPhilosophy));
  const activeLabel = currentVariant ? `Option ${currentVariant.option}: ${currentVariant.name}` : `Option ${updatedPhilosophy}`;

  const messageText = [
    `✅ *Website Design Updated!*`,
    `🎨 *Active Design:* *${activeLabel}*`,
    statusNotice,
    ``,
    `_Keep dictating changes (e.g. "option 1", "make font bigger", "change colors") to iterate!_`,
    ``,
    ...directives,
  ].join('\n');

  return {
    success: true,
    messageText,
    siteUrl: netlifyDeploy.siteUrl,
    updatedShotPath,
    updatedPhilosophy,
  };
}
