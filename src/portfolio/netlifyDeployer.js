import { execFile } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execFileAsync = util.promisify(execFile);

/**
 * Deploys a local directory to Netlify.
 * Supports:
 * 1. Authenticated deploy using NETLIFY_AUTH_TOKEN (unlimited)
 * 2. Anonymous Drop deploy (--allow-anonymous, zero login needed, subject to Netlify daily IP limits)
 *
 * @param {string} projectDir - Directory containing index.html and static assets
 * @param {object} options
 * @param {string} [options.title="portfolio"]
 * @param {string} [options.siteId] - Optional site ID to update an existing deploy
 * @param {number} [options.timeoutMs=45000]
 */
export async function deployToNetlifyDrop(projectDir, { title = 'portfolio', siteId = null, timeoutMs = 45000 } = {}) {
  const resolvedDir = path.resolve(projectDir);
  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`Directory does not exist: ${resolvedDir}`);
  }

  const indexPath = path.join(resolvedDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`index.html not found in deploy directory: ${resolvedDir}`);
  }

  const token = process.env.NETLIFY_AUTH_TOKEN || '';

  // Determine CLI arguments
  const args = ['deploy', '--dir', resolvedDir, '--prod', '--no-build'];

  if (siteId) {
    args.push('--site', siteId);
  }

  if (token) {
    args.push('--auth', token);
  } else {
    args.push('--allow-anonymous');
  }

  try {
    const { stdout, stderr } = await execFileAsync('netlify', args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        ...(token ? { NETLIFY_AUTH_TOKEN: token } : {}),
      },
    });

    const rawOutput = (stdout || '') + '\n' + (stderr || '');

    // Extract Site URL: Site URL: http://... or Website URL: https://...
    const urlMatch =
      rawOutput.match(/Site\s+URL:\s+(https?:\/\/[^\s\r\n]+)/i) ||
      rawOutput.match(/Website\s+URL:\s+(https?:\/\/[^\s\r\n]+)/i) ||
      rawOutput.match(/(https?:\/\/[A-Za-z0-9_-]+\.netlify\.app)/i);
    const siteUrl = urlMatch ? urlMatch[1].trim() : null;

    // Extract Password: Password: <pwd>
    const pwdMatch = rawOutput.match(/Password:\s+([^\s\r\n│]+)/i);
    const password = pwdMatch ? pwdMatch[1].trim() : 'My-Drop-Site';

    // Extract Claim on Netlify URL: https://app.netlify.com/drop/...#drop_token=...
    const claimMatch = rawOutput.match(/https:\/\/app\.netlify\.com\/drop\/[^\s\r\n]+/i);
    const claimUrl = claimMatch ? claimMatch[0].trim() : null;

    // Extract site ID if present
    const siteIdMatch = rawOutput.match(/--site\s+([a-f0-9-]{36})/i) || rawOutput.match(/Site\s+ID:\s+([a-f0-9-]{36})/i);
    const extractedSiteId = siteIdMatch ? siteIdMatch[1].trim() : siteId;

    if (!siteUrl) {
      throw new Error(`Deployment succeeded but Site URL could not be parsed:\n${rawOutput.slice(0, 500)}`);
    }

    const claimSection = claimUrl
      ? `, or [claim it to your Netlify account](${claimUrl})`
      : '';

    const formattedMessage =
      `The ${title} website has been deployed to Netlify: ${siteUrl} (Preview password: \`${password}\`${claimSection}).`;

    return {
      success: true,
      siteUrl,
      password,
      claimUrl,
      siteId: extractedSiteId,
      rawOutput,
      formattedMessage,
    };
  } catch (err) {
    const errorText = err.message || '';

    // Handle Netlify Anonymous daily limit gracefully
    if (errorText.includes('daily limit for anonymous deploys')) {
      console.warn('[NetlifyDeployer] Daily limit for anonymous deploys reached on this IP.');
      return {
        success: false,
        isRateLimited: true,
        siteUrl: null,
        password: null,
        claimUrl: null,
        siteId: null,
        rawOutput: errorText,
        formattedMessage:
          `The ${title} website is built and compiled locally. Note: Netlify anonymous deploy limit was reached for this IP. Add \`NETLIFY_AUTH_TOKEN\` to \`.env\` for live cloud deploys.`,
      };
    }

    throw new Error(`Netlify deployment failed: ${err.message}`);
  }
}
