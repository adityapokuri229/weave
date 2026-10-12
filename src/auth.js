import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { ROOT_DIR, DATA_DIR, atomicWriteJson } from './config.js';

const CREDENTIALS_FILE = path.join(DATA_DIR, '.credentials.json');

// Default Google OAuth Client parameters
// Users can provide their own Client ID/Secret via env or Weave app settings
const DEFAULT_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const DEFAULT_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_PORT = parseInt(process.env.GOOGLE_REDIRECT_PORT || '8085', 10) || 8085;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/auth/callback`;

// Scopes required for Gemini API, Gmail, and Google Calendar
const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/generative-language',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

class GoogleAuthManager {
  constructor() {
    this.clientId = DEFAULT_CLIENT_ID;
    this.clientSecret = DEFAULT_CLIENT_SECRET;
    this.tokens = this.loadTokens();
  }

  loadTokens() {
    if (!fs.existsSync(CREDENTIALS_FILE)) return null;
    try {
      return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    } catch {
      return null;
    }
  }

  saveTokens(tokens) {
    this.tokens = tokens;
    atomicWriteJson(CREDENTIALS_FILE, tokens);
  }

  isAuthenticated() {
    if (!this.tokens) this.tokens = this.loadTokens();
    return !!(this.tokens && (this.tokens.access_token || this.tokens.refresh_token));
  }

  getUserEmail() {
    if (!this.tokens) this.tokens = this.loadTokens();
    return this.tokens?.email || null;
  }

  /**
   * Generates PKCE code_verifier and code_challenge
   */
  generatePKCE() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');
    return { verifier, challenge };
  }

  /**
   * Generates the Google OAuth login URL for the browser
   */
  getAuthorizationUrl(clientId = this.clientId) {
    if (!clientId) {
      throw new Error('GOOGLE_CLIENT_ID is not configured. Please set it in Weave settings or .env');
    }
    this.clientId = clientId;
    const { verifier, challenge } = this.generatePKCE();
    this.pkceVerifier = verifier;

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: OAUTH_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Starts a local loopback HTTP server to wait for Google OAuth redirect
   */
  async startLoginFlow(onUrlReady, clientId = this.clientId, clientSecret = this.clientSecret) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;

    const authUrl = this.getAuthorizationUrl(clientId);
    if (onUrlReady) {
      onUrlReady(authUrl);
    }

    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          const reqUrl = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
          if (reqUrl.pathname !== '/auth/callback') {
            res.writeHead(404);
            res.end('Not found');
            return;
          }

          const code = reqUrl.searchParams.get('code');
          const error = reqUrl.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`<h2>Authentication Failed</h2><p>${error}</p>`);
            server.close();
            reject(new Error(`OAuth error: ${error}`));
            return;
          }

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end('<h2>Missing Authorization Code</h2>');
            return;
          }

          // Exchange authorization code for tokens
          const tokens = await this.exchangeCodeForTokens(code);

          // Fetch user info (email)
          let email = null;
          try {
            const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
              headers: { Authorization: `Bearer ${tokens.access_token}` },
            });
            if (userInfoRes.ok) {
              const data = await userInfoRes.json();
              email = data.email;
            }
          } catch {
            // non-fatal
          }

          tokens.email = email;
          tokens.acquired_at = Date.now();
          this.saveTokens(tokens);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>Weave Connected</title>
                <style>
                  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; }
                  .card { background: #1e293b; border-radius: 16px; padding: 40px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); max-width: 400px; }
                  h1 { color: #38bdf8; margin-top: 0; font-size: 24px; }
                  p { color: #94a3b8; line-height: 1.6; }
                  .btn { display: inline-block; margin-top: 20px; padding: 10px 20px; background: #0284c7; color: white; border-radius: 8px; text-decoration: none; font-weight: bold; }
                </style>
              </head>
              <body>
                <div class="card">
                  <h1>Google Account Connected!</h1>
                  <p>Weave is now connected to <strong>${email || 'your account'}</strong>.</p>
                  <p>You can close this tab and return to the Weave app.</p>
                </div>
              </body>
            </html>
          `);

          server.close();
          resolve(tokens);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<h2>Authentication error</h2><p>${err.message}</p>`);
          server.close();
          reject(err);
        }
      });

      server.listen(REDIRECT_PORT, () => {
        console.log(`🔑 Weave Google Auth server listening on ${REDIRECT_URI}`);
      });

      server.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Exchanges authorization code for access & refresh tokens
   */
  async exchangeCodeForTokens(code) {
    const body = new URLSearchParams({
      client_id: this.clientId,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
      code_verifier: this.pkceVerifier,
    });

    if (this.clientSecret) {
      body.append('client_secret', this.clientSecret);
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${errText}`);
    }

    return await response.json();
  }

  /**
   * Retrieves a valid access token, auto-refreshing if expired
   */
  async getValidAccessToken() {
    if (!this.tokens) this.tokens = this.loadTokens();
    if (!this.tokens) {
      throw new Error('Not logged in. Please connect your Google Account in Weave.');
    }

    const now = Date.now();
    const expiresIn = (this.tokens.expires_in || 3600) * 1000;
    const isExpired = this.tokens.acquired_at && now > this.tokens.acquired_at + expiresIn - 60000;

    if (!isExpired && this.tokens.access_token) {
      return this.tokens.access_token;
    }

    if (!this.tokens.refresh_token) {
      return this.tokens.access_token;
    }

    // Refresh token
    const body = new URLSearchParams({
      client_id: this.clientId,
      refresh_token: this.tokens.refresh_token,
      grant_type: 'refresh_token',
    });

    if (this.clientSecret) {
      body.append('client_secret', this.clientSecret);
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error('Failed to refresh Google access token. Please re-authenticate.');
    }

    const refreshed = await response.json();
    this.tokens.access_token = refreshed.access_token;
    this.tokens.expires_in = refreshed.expires_in;
    this.tokens.acquired_at = Date.now();
    this.saveTokens(this.tokens);

    return this.tokens.access_token;
  }
}

export const googleAuth = new GoogleAuthManager();

// CLI Runner: allows running `npm run auth` or `node src/auth.js` directly
const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.error('❌ GOOGLE_CLIENT_ID is not set.');
    console.error('👉 Please set GOOGLE_CLIENT_ID in your .env file or environment first.\n');
    process.exit(1);
  }

  console.log('🔗 Starting Weave Google OAuth 2.0 PKCE flow...');
  googleAuth
    .startLoginFlow((url) => {
      console.log('\n👉 Open the following URL in your browser to sign in with Google:\n');
      console.log(url + '\n');
    })
    .then((tokens) => {
      console.log(`\n✅ Successfully authenticated as: ${tokens.email || 'Google User'}`);
      console.log('🔒 Saved credentials to .credentials.json\n');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Authentication failed:', err.message);
      process.exit(1);
    });
}
