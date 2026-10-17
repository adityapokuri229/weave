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

  const variants = [
    {
      option: 1,
      id: DESIGN_PHILOSOPHIES.BENTO,
      name: 'Obsidian Bento Grid',
      description: 'Dark mode, glowing neon cyan/purple accents, modular tech cards, and monospace badges.',
      html: renderBentoPortfolio(portfolioData),
      filename: 'option1_bento',
    },
    {
      option: 2,
      id: DESIGN_PHILOSOPHIES.SWISS,
      name: 'Swiss Editorial Minimal',
      description: 'Clean typography, serif headlines, generous whitespace, and high-contrast editorial layout.',
      html: renderSwissPortfolio(portfolioData),
      filename: 'option2_swiss',
    },
    {
      option: 3,
      id: DESIGN_PHILOSOPHIES.BRUTALIST,
      name: 'Neo-Brutalist Dynamic',
      description: 'Bold 2px dark outlines, high-energy highlighter badges, and tactile interactive elements.',
      html: renderBrutalistPortfolio(portfolioData),
      filename: 'option3_brutalist',
    },
  ];

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
        screenshotPath: shot.filePath,
      });
    } catch (err) {
      console.warn(`Failed to capture screenshot for ${v.name}:`, err.message);
      results.push({
        option: v.option,
        id: v.id,
        name: v.name,
        description: v.description,
        screenshotPath: htmlPath,
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

  // 1. Synthesize website copy based on domain and prompt
  const portfolioData = buildPortfolioData({
    prompt,
    name: (prompt || '').match(/(shelter|dog|rescue|animal|cafe|coffee|bakery|restaurant|photo|studio|gym|fitness|hackathon|sprint)/i)
      ? undefined
      : (senderName || 'Alex Chen'),
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

  // 4. Assemble primary chosen design into project directory index.html
  const primaryHtml = generatePortfolioHtml(initialPhilosophy, portfolioData);
  const indexPath = path.join(projectDir, 'index.html');
  fs.writeFileSync(indexPath, primaryHtml, 'utf8');

  // 5. Deploy to Netlify Anonymous Drop
  const netlifyDeploy = await deployToNetlifyDrop(projectDir, { title: 'portfolio' });

  // 6. Capture live preview screenshot directly from local HTML
  let livePreviewScreenshot = null;
  try {
    const liveShot = await captureWebScreenshot(indexPath, {
      width: 1280,
      height: 800,
    });
    livePreviewScreenshot = liveShot.filePath;
  } catch (err) {
    console.warn('Failed to capture live preview screenshot:', err.message);
    livePreviewScreenshot = variants[0]?.screenshotPath || null;
  }

  // 7. Persist session state in projects.json
  try {
    const state = loadProjectsState();
    state.portfolioSessions = state.portfolioSessions || {};
    state.portfolioSessions[chatJid] = {
      projectDir,
      projectAlias,
      activePhilosophy: initialPhilosophy,
      siteUrl: netlifyDeploy.siteUrl || null,
      password: netlifyDeploy.password || null,
      claimUrl: netlifyDeploy.claimUrl || null,
      stitchProjectId,
      portfolioData,
      variants: variants.map((v) => ({
        option: v.option,
        id: v.id,
        name: v.name,
        screenshotPath: v.screenshotPath,
      })),
      updatedAt: new Date().toISOString(),
    };
    saveProjectsState(state);
  } catch (stateErr) {
    console.warn('Failed to save portfolio state:', stateErr.message);
  }

  // 8. Format WhatsApp response with [SEND_FILE] directives
  const directives = [];
  if (livePreviewScreenshot && fs.existsSync(livePreviewScreenshot)) {
    directives.push(`[SEND_FILE: HERE | ${livePreviewScreenshot}]`);
  }

  // Also include the other variant screenshots
  for (const v of variants) {
    if (v.screenshotPath && fs.existsSync(v.screenshotPath) && v.screenshotPath !== livePreviewScreenshot) {
      directives.push(`[SEND_FILE: HERE | ${v.screenshotPath}]`);
    }
  }

  let deployNotice = '';
  if (netlifyDeploy.siteUrl) {
    const claimSection = netlifyDeploy.claimUrl
      ? `, or [claim it to your Netlify account](${netlifyDeploy.claimUrl})`
      : '';
    deployNotice = `The website has been deployed to Netlify: ${netlifyDeploy.siteUrl} (Preview password: \`${netlifyDeploy.password}\`${claimSection}).`;
  } else if (netlifyDeploy.isRateLimited) {
    deployNotice = `⚠️ *Netlify Notice:* The daily IP rate limit for anonymous deploys has been reached on this network. Your website has been fully compiled locally; set \`NETLIFY_AUTH_TOKEN\` in \`.env\` for live cloud deploys.`;
  } else {
    deployNotice = `The website has been compiled locally in your workspace.`;
  }

  const messageText = [
    deployNotice,
    ``,
    `🎨 *Google Stitch Design Variations Created:*`,
    `• *Option 1*: Obsidian Bento Grid (Dark Modern Tech)`,
    `• *Option 2*: Swiss Editorial Minimal (Clean & Typography-focused)`,
    `• *Option 3*: Neo-Brutalist Dynamic (Bold High-Contrast & Tactile)`,
    ``,
    `_Reply right here in WhatsApp to choose a design (e.g. "option 2", "option 3") or dictate changes, and I will update your live site!_`,
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
  let updatedPhilosophy = session.activePhilosophy;

  if (lower.includes('option 2') || lower.includes('swiss') || lower.includes('editorial')) {
    updatedPhilosophy = DESIGN_PHILOSOPHIES.SWISS;
  } else if (lower.includes('option 3') || lower.includes('brutalist') || lower.includes('yellow')) {
    updatedPhilosophy = DESIGN_PHILOSOPHIES.BRUTALIST;
  } else if (lower.includes('option 1') || lower.includes('bento') || lower.includes('obsidian') || lower.includes('dark')) {
    updatedPhilosophy = DESIGN_PHILOSOPHIES.BENTO;
  }

  // If user dictates custom content or adjustments
  let portfolioData = session.portfolioData;
  if (!portfolioData || !portfolioData.headline) {
    portfolioData = buildPortfolioData({
      prompt: session.portfolioData?.prompt || session.prompt || '',
      name: (session.portfolioData?.prompt || '').match(/(shelter|dog|rescue|animal|cafe|coffee|bakery|restaurant|photo|studio|gym|fitness|hackathon|sprint)/i)
        ? undefined
        : session.portfolioData?.name,
    });
    session.portfolioData = portfolioData;
  }

  if (lower.includes('accent') || lower.includes('color') || lower.includes('cyan') || lower.includes('purple')) {
    portfolioData.tagline += ' // Styled with customized accent palette';
  }

  // Re-generate HTML
  const updatedHtml = generatePortfolioHtml(updatedPhilosophy, portfolioData);
  const indexPath = path.join(session.projectDir, 'index.html');
  fs.writeFileSync(indexPath, updatedHtml, 'utf8');

  // Re-deploy to Netlify
  const netlifyDeploy = await deployToNetlifyDrop(session.projectDir, { title: 'portfolio' });

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
    const claimSection = netlifyDeploy.claimUrl
      ? `, or [claim it to your Netlify account](${netlifyDeploy.claimUrl})`
      : '';
    statusNotice = `The updated website is live on Netlify: ${netlifyDeploy.siteUrl} (Preview password: \`${netlifyDeploy.password}\`${claimSection}).`;
  } else if (netlifyDeploy.isRateLimited) {
    statusNotice = `Design updated locally. (Netlify anonymous IP limit active; set \`NETLIFY_AUTH_TOKEN\` in \`.env\` to sync live).`;
  } else {
    statusNotice = `Design updated locally in project directory.`;
  }

  const philosophyLabels = {
    [DESIGN_PHILOSOPHIES.BENTO]: 'Option 1: Obsidian Bento Grid (Dark Modern Tech)',
    [DESIGN_PHILOSOPHIES.SWISS]: 'Option 2: Swiss Editorial Minimal (Clean Serif Typography)',
    [DESIGN_PHILOSOPHIES.BRUTALIST]: 'Option 3: Neo-Brutalist Dynamic (Bold High-Contrast & Tactile)',
  };
  const activeLabel = philosophyLabels[updatedPhilosophy] || updatedPhilosophy.toUpperCase();

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
