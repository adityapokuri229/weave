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
 * Renders HTML files and captures headless screenshots for all 3 design philosophies.
 *
 * @param {object} portfolioData
 * @param {string} [outputDir]
 * @returns {Promise<Array<{ option: number, id: string, name: string, description: string, screenshotPath: string }>>}
 */
export async function renderAndCaptureVariants(portfolioData, outputDir = null) {
  const targetDir = outputDir || path.join(os.tmpdir(), 'portfolio-stitch-variants', `${Date.now()}`);
  fs.mkdirSync(targetDir, { recursive: true });

  const aesthetics =
    Array.isArray(portfolioData.aesthetics) && portfolioData.aesthetics.length >= 3
      ? portfolioData.aesthetics
      : [
          {
            option: 1,
            id: DESIGN_PHILOSOPHIES.BENTO,
            name: 'Obsidian Bento Grid',
            description: 'Dark mode, glowing neon cyan/purple accents, modular tech cards, and monospace badges.',
          },
          {
            option: 2,
            id: DESIGN_PHILOSOPHIES.SWISS,
            name: 'Swiss Editorial Minimal',
            description: 'Clean typography, serif headlines, generous whitespace, and high-contrast editorial layout.',
          },
          {
            option: 3,
            id: DESIGN_PHILOSOPHIES.BRUTALIST,
            name: 'Neo-Brutalist Dynamic',
            description: 'Bold 2px dark outlines, high-energy highlighter badges, and tactile interactive elements.',
          },
        ];

  const variants = aesthetics.map((a, idx) => ({
    option: a.option || idx + 1,
    id: a.id || `option-${idx + 1}`,
    name: a.name || `Design Option ${idx + 1}`,
    description: a.description || 'Custom aesthetic layout',
    html: generatePortfolioHtml(String(a.option || idx + 1), portfolioData),
    filename: `option${idx + 1}_${(a.id || 'variant').replace(/[^a-z0-9]/gi, '_')}`,
  }));

  const results = [];
  for (const v of variants) {
    const htmlPath = path.join(targetDir, `${v.filename}.html`);
    const imgPath = path.join(targetDir, `${v.filename}.png`);
    fs.writeFileSync(htmlPath, v.html, 'utf8');

    try {
      const shot = await captureWebScreenshot(htmlPath, {
        outputPath: imgPath,
        width: 1280,
        height: 800,
      });
      results.push({
        option: v.option,
        id: v.id,
        name: v.name,
        description: v.description,
        html: v.html,
        htmlPath,
        screenshotPath: shot.filePath,
      });
    } catch (err) {
      console.warn(`Failed to capture screenshot for ${v.name}:`, err.message);
      results.push({
        option: v.option,
        id: v.id,
        name: v.name,
        description: v.description,
        html: v.html,
        htmlPath,
        screenshotPath: null,
      });
    }
  }

  return results;
}

/**
 * Executes the complete Portfolio Website Creation pipeline:
 * 1. Initializes Google Stitch project & triggers generation
 * 2. Renders all 3 design philosophy variants & captures preview screenshots
 * 3. Builds the primary website into projectDir
 * 4. Deploys to Netlify Anonymous Drop (instant URL, password, claim link)
 * 5. Captures live preview screenshot
 * 6. Persists session state and formats WhatsApp message with directives
 */
export async function executePortfolioCreation({
  prompt,
  chatJid,
  targetProjectDir,
  projectAlias = 'portfolio-website',
  senderName = 'Founder / Engineer',
  initialPhilosophy = DESIGN_PHILOSOPHIES.BENTO,
}) {
  const projectDir = targetProjectDir || path.resolve(process.cwd(), 'demo-site');
  fs.mkdirSync(projectDir, { recursive: true });

  // 1. Dynamically synthesize custom domain copy using local AI (agy CLI)
  const portfolioData = await synthesizePortfolioData(prompt, {
    organizer: senderName || 'Founder',
  });

  // 2. Connect to Google Stitch MCP in background
  let stitchProjectId = null;
  try {
    const stitchProject = await stitchClient.createProject(`Portfolio - ${prompt?.slice(0, 30) || 'Web'}`);
    stitchProjectId = stitchProject?.name ? stitchProject.name.split('/').pop() : null;
    if (stitchProjectId) {
      // Trigger screen generation asynchronously without blocking
      stitchClient
        .generateScreenFromText({
          projectId: stitchProjectId,
          prompt: `Modern responsive portfolio website: ${prompt}`,
          deviceType: 'DESKTOP',
        })
        .catch((err) => console.warn('[StitchMCP] Background screen generation note:', err.message));
    }
  } catch (stitchErr) {
    console.warn('[StitchMCP] Notice:', stitchErr.message);
  }

  // 3. Render and capture all 3 design philosophy variants
  const variants = await renderAndCaptureVariants(portfolioData);

  // Helper to build preview switcher bar
  const buildSwitcherBar = (currentOpt) => `
<div style="background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(8px); padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 9999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #fff; font-size: 13px;">
  <div style="display: flex; align-items: center; gap: 8px;">
    <span style="background: #38bdf8; color: #000; font-weight: 700; padding: 2px 8px; border-radius: 4px; font-size: 10px; letter-spacing: 0.05em;">DESIGN PREVIEW</span>
    <span style="color: #cbd5e1;">Viewing: <strong style="color: #fff;">Option ${currentOpt}: ${variants.find((v) => v.option === currentOpt)?.name || ''}</strong></span>
  </div>
  <div style="display: flex; gap: 6px;">
    ${variants
      .map(
        (v) => `
      <a href="/option${v.option}.html" style="padding: 5px 12px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 12px; transition: all 0.2s; ${
        v.option === currentOpt
          ? 'background: #38bdf8; color: #000;'
          : 'background: rgba(255,255,255,0.1); color: #fff;'
      }">Option ${v.option}</a>`
      )
      .join('')}
  </div>
</div>`;

  // 4. Save each variant HTML and screenshot into projectDir for live hosting on Netlify
  for (const v of variants) {
    const optNum = v.option;
    const bar = buildSwitcherBar(optNum);
    const htmlContent = v.html || generatePortfolioHtml(String(optNum), portfolioData);
    const fullHtml = htmlContent.includes('<body')
      ? htmlContent.replace(/<body[^>]*>/i, (match) => `${match}\n${bar}`)
      : `${bar}\n${htmlContent}`;

    fs.writeFileSync(path.join(projectDir, `option${optNum}.html`), fullHtml, 'utf8');

    if (v.screenshotPath && fs.existsSync(v.screenshotPath) && v.screenshotPath.endsWith('.png')) {
      try {
        fs.copyFileSync(v.screenshotPath, path.join(projectDir, `option${optNum}.png`));
      } catch {}
    }
  }

  // 5. Assemble primary active design into index.html
  const initialOptNum = parseInt(initialPhilosophy, 10) || 1;
  const primaryHtml = generatePortfolioHtml(initialPhilosophy, portfolioData);
  const primaryBar = buildSwitcherBar(initialOptNum);
  const primaryIndexHtml = primaryHtml.includes('<body')
    ? primaryHtml.replace(/<body[^>]*>/i, (match) => `${match}\n${primaryBar}`)
    : `${primaryBar}\n${primaryHtml}`;
  const indexPath = path.join(projectDir, 'index.html');
  fs.writeFileSync(indexPath, primaryIndexHtml, 'utf8');

  // 6. Deploy to Netlify
  const netlifyDeploy = await deployToNetlifyDrop(projectDir, { title: projectAlias || 'portfolio' });

  // 7. Capture live preview screenshot directly from local HTML
  let livePreviewScreenshot = null;
  try {
    const liveShot = await captureWebScreenshot(indexPath, {
      outputPath: path.join(projectDir, 'screenshot-live.png'),
      width: 1280,
      height: 800,
    });
    livePreviewScreenshot = liveShot.filePath;
  } catch (err) {
    console.warn('Failed to capture live preview screenshot:', err.message);
    livePreviewScreenshot = variants[0]?.screenshotPath || null;
  }

  // 8. Persist session state in projects.json
  try {
    const state = loadProjectsState();
    state.portfolioSessions = state.portfolioSessions || {};
    state.portfolioSessions[chatJid] = {
      projectDir,
      projectAlias,
      activePhilosophy: initialPhilosophy,
      siteUrl: netlifyDeploy.siteUrl || null,
      siteId: netlifyDeploy.siteId || null,
      password: netlifyDeploy.password || null,
      claimUrl: netlifyDeploy.claimUrl || null,
      stitchProjectId,
      portfolioData,
      variants: variants.map((v) => ({
        option: v.option,
        id: v.id,
        name: v.name,
        description: v.description,
        screenshotPath: v.screenshotPath,
      })),
      updatedAt: new Date().toISOString(),
    };
    saveProjectsState(state);
  } catch (stateErr) {
    console.warn('Failed to save portfolio state:', stateErr.message);
  }

  // 9. Format WhatsApp response with [SEND_FILE] directives
  const directives = [];
  for (const v of variants) {
    if (v.screenshotPath && fs.existsSync(v.screenshotPath) && v.screenshotPath.endsWith('.png')) {
      directives.push(`[SEND_FILE: HERE | ${v.screenshotPath}]`);
    }
  }
  if (directives.length === 0 && livePreviewScreenshot && fs.existsSync(livePreviewScreenshot)) {
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
    (v) => `• *Option ${v.option}*: *${v.name}*${rawBase ? `\n   🔗 _Live Preview:_ ${rawBase}/option${v.option}.html` : ''}\n   _${v.description}_`
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
  } else if (Array.isArray(session.portfolioData?.aesthetics)) {
    // Check if user mentioned words from aesthetic names or ids
    for (const a of session.portfolioData.aesthetics) {
      const nameWords = (a.name || '').toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      if (lower.includes(a.id?.toLowerCase()) || nameWords.some((w) => lower.includes(w))) {
        updatedPhilosophy = String(a.option);
        break;
      }
    }
  } else if (lower.includes('swiss') || lower.includes('editorial')) {
    updatedPhilosophy = '2';
  } else if (lower.includes('brutalist') || lower.includes('yellow')) {
    updatedPhilosophy = '3';
  } else if (lower.includes('bento') || lower.includes('obsidian') || lower.includes('dark')) {
    updatedPhilosophy = '1';
  }

  // If user dictates custom content or adjustments
  let portfolioData = session.portfolioData;
  if (!portfolioData || !portfolioData.headline) {
    portfolioData = await synthesizePortfolioData(
      session.portfolioData?.prompt || session.prompt || feedbackText || '',
      { organizer: session.portfolioData?.organizer || 'Founder' }
    );
    session.portfolioData = portfolioData;
  }

  if (lower.includes('accent') || lower.includes('color') || lower.includes('cyan') || lower.includes('purple')) {
    portfolioData.tagline += ' // Styled with customized accent palette';
  }

  // Re-generate HTML
  const updatedHtml = generatePortfolioHtml(updatedPhilosophy, portfolioData);
  const optNum = parseInt(updatedPhilosophy, 10) || 1;
  const switcherBar = `
<div style="background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(8px); padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 9999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #fff; font-size: 13px;">
  <div style="display: flex; align-items: center; gap: 8px;">
    <span style="background: #38bdf8; color: #000; font-weight: 700; padding: 2px 8px; border-radius: 4px; font-size: 10px; letter-spacing: 0.05em;">ACTIVE DESIGN</span>
    <span style="color: #cbd5e1;">Selected: <strong style="color: #fff;">Option ${optNum}</strong></span>
  </div>
  <div style="display: flex; gap: 6px;">
    <a href="/option1.html" style="padding: 5px 12px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 12px; ${optNum === 1 ? 'background: #38bdf8; color: #000;' : 'background: rgba(255,255,255,0.1); color: #fff;'}">Option 1</a>
    <a href="/option2.html" style="padding: 5px 12px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 12px; ${optNum === 2 ? 'background: #38bdf8; color: #000;' : 'background: rgba(255,255,255,0.1); color: #fff;'}">Option 2</a>
    <a href="/option3.html" style="padding: 5px 12px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 12px; ${optNum === 3 ? 'background: #38bdf8; color: #000;' : 'background: rgba(255,255,255,0.1); color: #fff;'}">Option 3</a>
  </div>
</div>`;
  const primaryIndexHtml = updatedHtml.includes('<body')
    ? updatedHtml.replace(/<body[^>]*>/i, (match) => `${match}\n${switcherBar}`)
    : `${switcherBar}\n${updatedHtml}`;
  const indexPath = path.join(session.projectDir, 'index.html');
  fs.writeFileSync(indexPath, primaryIndexHtml, 'utf8');

  // Re-deploy to Netlify
  const netlifyDeploy = await deployToNetlifyDrop(session.projectDir, {
    title: session.projectAlias || 'portfolio',
    siteId: session.siteId || null,
  });

  // Capture updated screenshot directly from local HTML file!
  let updatedShotPath = null;
  try {
    const shot = await captureWebScreenshot(indexPath, { width: 1280, height: 800 });
    updatedShotPath = shot.filePath;
  } catch (err) {
    console.warn('Failed to capture updated screenshot:', err.message);
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

  const currentAesthetic = session.portfolioData?.aesthetics?.find(
    (a) => String(a.option) === String(updatedPhilosophy) || a.id === updatedPhilosophy
  );

  const philosophyLabels = {
    [DESIGN_PHILOSOPHIES.BENTO]: 'Obsidian Bento Grid (Dark Modern Tech)',
    [DESIGN_PHILOSOPHIES.SWISS]: 'Swiss Editorial Minimal (Clean Serif Typography)',
    [DESIGN_PHILOSOPHIES.BRUTALIST]: 'Neo-Brutalist Dynamic (Bold High-Contrast & Tactile)',
  };

  const activeLabel = currentAesthetic
    ? `Option ${currentAesthetic.option}: ${currentAesthetic.name}`
    : philosophyLabels[updatedPhilosophy] || `Option ${updatedPhilosophy}`;

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
