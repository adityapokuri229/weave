import { execFile } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execFileAsync = util.promisify(execFile);

/**
 * Retrieves an existing Netlify site or creates a new one under the user's account.
 * Ensures the site has public access (sso_login disabled).
 *
 * @param {string} token - Netlify Personal Access Token
 * @param {string} preferredName - Desired site name prefix
 * @returns {Promise<{ siteId: string, siteUrl: string, siteName: string } | null>}
 */
export async function getOrCreateNetlifySite(token, preferredName = 'portfolio-website') {
  if (!token) return null;

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  try {
    // 1. Check existing sites for matching name
    const listRes = await fetch('https://api.netlify.com/api/v1/sites', { headers });
    if (listRes.ok) {
      const sites = await listRes.json();
      if (Array.isArray(sites) && sites.length > 0) {
        // Find existing site matching name or pick the most recent one
        const existing = sites.find((s) => s.name === preferredName) || sites[0];
        if (existing) {
          if (existing.sso_login) {
            await fetch(`https://api.netlify.com/api/v1/sites/${existing.id}`, {
              method: 'PATCH',
              headers,
              body: JSON.stringify({ sso_login: false }),
            }).catch(() => {});
          }
          return {
            siteId: existing.id,
            siteUrl: existing.ssl_url || existing.url,
            siteName: existing.name,
          };
        }
      }
    }

    // 2. Resolve account team slug
    let accountSlug = null;
    const accountsRes = await fetch('https://api.netlify.com/api/v1/accounts', { headers });
    if (accountsRes.ok) {
      const accounts = await accountsRes.json();
      if (Array.isArray(accounts) && accounts.length > 0) {
        accountSlug = accounts[0].slug;
      }
    }

    // 3. Create a new site under the resolved account
    const safeName = `${preferredName}-${Date.now().toString(36)}`.slice(0, 36);
    const endpoint = accountSlug
      ? `https://api.netlify.com/api/v1/${accountSlug}/sites`
      : 'https://api.netlify.com/api/v1/sites';

    const createRes = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: safeName,
        sso_login: false,
      }),
    });

    if (createRes.ok) {
      const newSite = await createRes.json();
      if (newSite.sso_login) {
        await fetch(`https://api.netlify.com/api/v1/sites/${newSite.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ sso_login: false }),
        }).catch(() => {});
      }
      return {
        siteId: newSite.id,
        siteUrl: newSite.ssl_url || newSite.url,
        siteName: newSite.name,
      };
    }
  } catch (err) {
    console.warn('[NetlifyDeployer] Site resolution warning:', err.message);
  }

  return null;
}

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

  // If token is provided, resolve or create the target Netlify site automatically
  let activeSiteId = siteId;
  let preResolvedSiteUrl = null;
  if (token && !activeSiteId) {
    const siteInfo = await getOrCreateNetlifySite(token, `weave-${title.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`);
    if (siteInfo?.siteId) {
      activeSiteId = siteInfo.siteId;
      preResolvedSiteUrl = siteInfo.siteUrl;
    }
  }

  // Check if Netlify CLI has an active login session
  let isCliLoggedIn = false;
  if (!token) {
    try {
      const { stdout } = await execFileAsync('netlify', ['status', '--json'], { timeout: 4000 });
      const statusObj = JSON.parse(stdout || '{}');
      if (statusObj && statusObj.loggedIn) {
        isCliLoggedIn = true;
      }
    } catch {
      isCliLoggedIn = false;
    }
  }

  // Determine CLI arguments
  const args = ['deploy', '--dir', resolvedDir, '--prod', '--no-build'];

  if (activeSiteId) {
    args.push('--site', activeSiteId);
  }

  if (token) {
    args.push('--auth', token);
    args.push('--json');
  } else if (!isCliLoggedIn) {
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

    // Try parsing JSON output first if token was used
    let parsedJson = null;
    try {
      if (stdout && stdout.trim().startsWith('{')) {
        parsedJson = JSON.parse(stdout.trim());
      }
    } catch {
      parsedJson = null;
    }

    const siteUrl =
      parsedJson?.url ||
      parsedJson?.ssl_url ||
      preResolvedSiteUrl ||
      rawOutput.match(/Site\s+URL:\s+(https?:\/\/[^\s\r\n]+)/i)?.[1]?.trim() ||
      rawOutput.match(/Website\s+URL:\s+(https?:\/\/[^\s\r\n]+)/i)?.[1]?.trim() ||
      rawOutput.match(/(https?:\/\/[A-Za-z0-9_-]+\.netlify\.app)/i)?.[1]?.trim() ||
      null;

    const pwdMatch = rawOutput.match(/Password:\s+([^\s\r\n│]+)/i);
    const password = pwdMatch ? pwdMatch[1].trim() : null;

    const claimMatch = rawOutput.match(/https:\/\/app\.netlify\.com\/drop\/[^\s\r\n]+/i);
    const claimUrl = claimMatch ? claimMatch[0].trim() : null;

    const extractedSiteId = parsedJson?.site_id || activeSiteId;

    if (!siteUrl) {
      throw new Error(`Deployment succeeded but Site URL could not be parsed:\n${rawOutput.slice(0, 500)}`);
    }

    const formattedMessage = password
      ? `The ${title} website has been deployed to Netlify: ${siteUrl} (Preview password: \`${password}\`).`
      : `The ${title} website is live on Netlify: ${siteUrl}`;

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

