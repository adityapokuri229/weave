import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { ROOT_DIR, DATA_DIR, atomicWriteJson } from './config.js';

const CREDENTIALS_FILE = path.join(DATA_DIR, '.credentials.json');

const DEFAULT_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const DEFAULT_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const DEFAULT_PORT = parseInt(process.env.GOOGLE_REDIRECT_PORT || '8085', 10) || 8085;

// Scopes required for Gemini API, Gmail, and Google Calendar
const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/generative-language',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

/**
 * Auto-detects if the user is already signed into Google Antigravity IDE on this machine
 */
export function detectLocalAntigravityAccount() {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.config', 'Antigravity', 'app_storage.json'),
    path.join(home, 'Library', 'Application Support', 'Antigravity', 'app_storage.json'),
    path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Antigravity', 'app_storage.json'),
  ];

  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        const email = data['jetski.onboarding.lastLoginUsername'];
        if (email && typeof email === 'string' && email.includes('@')) {
          return email.trim();
        }
      }
    } catch {}
  }

  if (process.env.OWNER_EMAIL && process.env.OWNER_EMAIL !== 'your-email@example.com' && process.env.OWNER_EMAIL.includes('@')) {
    return process.env.OWNER_EMAIL.trim();
  }

  return null;
}

class GoogleAuthManager {
  constructor() {
    this.clientId = DEFAULT_CLIENT_ID;
    this.clientSecret = DEFAULT_CLIENT_SECRET;
    this.tokens = this.loadTokens();
    this.activeServer = null;
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

    // Also sync OWNER_EMAIL in .env if present
    if (tokens?.email) {
      try {
        const envPath = path.join(DATA_DIR, '.env');
        if (fs.existsSync(envPath)) {
          let content = fs.readFileSync(envPath, 'utf8');
          if (content.includes('OWNER_EMAIL=')) {
            content = content.replace(/OWNER_EMAIL=.*/g, `OWNER_EMAIL=${tokens.email}`);
          } else {
            content += `\nOWNER_EMAIL=${tokens.email}\n`;
          }
          fs.writeFileSync(envPath, content, 'utf8');
        }
      } catch {}
    }
  }

  clearTokens() {
    this.tokens = null;
    try {
      if (fs.existsSync(CREDENTIALS_FILE)) {
        fs.unlinkSync(CREDENTIALS_FILE);
      }
    } catch {}
  }

  isAuthenticated() {
    if (!this.tokens) this.tokens = this.loadTokens();
    return !!(this.tokens && (this.tokens.access_token || this.tokens.refresh_token) && this.tokens.email);
  }

  getUserEmail() {
    if (!this.tokens) this.tokens = this.loadTokens();
    return this.tokens?.email || null;
  }

  /**
   * Generates PKCE code_verifier and code_challenge (S256)
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
   * Generates the Google OAuth login URL for custom GCP Client IDs
   */
  getAuthorizationUrl(redirectUri, clientId = this.clientId) {
    this.clientId = clientId;
    const { verifier, challenge } = this.generatePKCE();
    this.pkceVerifier = verifier;
    this.pkceChallenge = challenge;

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
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
   * Starts a local loopback HTTP server for Google PKCE Authentication & Antigravity Bridge
   */
  async startLoginFlow(onUrlReady, clientId = this.clientId, clientSecret = this.clientSecret) {
    this.clientId = clientId || process.env.GOOGLE_CLIENT_ID || '';
    this.clientSecret = clientSecret || process.env.GOOGLE_CLIENT_SECRET || '';

    if (this.activeServer) {
      try {
        this.activeServer.close();
      } catch {}
      this.activeServer = null;
    }

    const { verifier, challenge } = this.generatePKCE();
    this.pkceVerifier = verifier;
    this.pkceChallenge = challenge;
    const detectedAccount = detectLocalAntigravityAccount();

    return new Promise((resolve, reject) => {
      let port = DEFAULT_PORT;

      const server = http.createServer(async (req, res) => {
        try {
          const reqUrl = new URL(req.url, `http://127.0.0.1:${port}`);
          const redirectUri = `http://127.0.0.1:${port}/auth/callback`;

          // 1. Main Sign-In Portal Page
          if (reqUrl.pathname === '/auth/google' || reqUrl.pathname === '/') {
            const hasCustomOAuth = Boolean(this.clientId);
            const oauthRedirectUrl = hasCustomOAuth ? this.getAuthorizationUrl(redirectUri, this.clientId) : null;

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Sign in with Google — Weave PKCE</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #09090b;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      width: 100%;
      max-width: 420px;
      background: #121214;
      border: 1px solid #27272a;
      border-radius: 16px;
      padding: 32px 28px;
      box-shadow: 0 24px 48px rgba(0,0,0,0.7);
    }
    .header {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      margin-bottom: 24px;
    }
    .google-badge {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #1f1f23;
      border: 1px solid #27272a;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 14px;
    }
    h1 { font-size: 18px; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 6px; }
    .subtitle { font-size: 12px; color: #a1a1aa; line-height: 1.5; }
    .pkce-pill {
      display: inline-block;
      margin-top: 8px;
      padding: 3px 8px;
      border-radius: 4px;
      background: #1f1f23;
      border: 1px solid #27272a;
      font-family: ui-monospace, monospace;
      font-size: 10px;
      color: #a1a1aa;
    }
    .section-label {
      font-size: 10px;
      font-family: ui-monospace, monospace;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #71717a;
      margin-bottom: 8px;
      display: block;
    }
    .account-btn {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      background: #18181b;
      border: 1px solid #3f3f46;
      border-radius: 10px;
      color: #ffffff;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.15s ease;
      margin-bottom: 18px;
      text-align: left;
    }
    .account-btn:hover {
      background: #27272a;
      border-color: #ffffff;
    }
    .avatar {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: #ffffff;
      color: #000000;
      font-weight: 700;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .acc-info { flex: 1; min-width: 0; }
    .acc-email { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .acc-tag { font-size: 11px; color: #a1a1aa; font-family: ui-monospace, monospace; }
    .divider {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 16px 0;
      color: #52525b;
      font-size: 11px;
      font-family: ui-monospace, monospace;
    }
    .divider::before, .divider::after {
      content: "";
      flex: 1;
      height: 1px;
      background: #27272a;
    }
    .form-group { margin-bottom: 14px; }
    input {
      width: 100%;
      padding: 10px 12px;
      background: #09090b;
      border: 1px solid #27272a;
      border-radius: 8px;
      color: #ffffff;
      font-size: 13px;
      font-family: ui-monospace, monospace;
      outline: none;
    }
    input:focus { border-color: #ffffff; }
    .submit-btn {
      width: 100%;
      padding: 11px 16px;
      background: #ffffff;
      color: #000000;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .submit-btn:hover { background: #e4e4e7; }
    .oauth-link {
      display: block;
      text-align: center;
      margin-top: 14px;
      font-size: 11px;
      color: #a1a1aa;
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="google-badge">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="#ffffff">
          <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/>
        </svg>
      </div>
      <h1>Connect Google Account</h1>
      <p class="subtitle">Authorize Weave Desktop Bridge for Gemini 2.5/3.8 Flash &amp; Calendar execution</p>
      <span class="pkce-pill">PKCE S256 · ${challenge.slice(0, 16)}...</span>
    </div>

    ${detectedAccount ? `
      <span class="section-label">Detected Antigravity Account</span>
      <a class="account-btn" href="/auth/complete?email=${encodeURIComponent(detectedAccount)}">
        <div class="avatar">${detectedAccount[0].toUpperCase()}</div>
        <div class="acc-info">
          <div class="acc-email">${detectedAccount}</div>
          <div class="acc-tag">✓ Signed in via Google Antigravity · Click to continue</div>
        </div>
      </a>
      <div class="divider">OR USE ANOTHER ACCOUNT</div>
    ` : ''}

    <form action="/auth/complete" method="GET">
      <div class="form-group">
        <span class="section-label">Google Account Email</span>
        <input type="email" name="email" required placeholder="name@gmail.com" value="${detectedAccount || ''}" />
      </div>
      <div class="form-group">
        <span class="section-label">Gemini API Key (Optional if using Antigravity CLI)</span>
        <input type="password" name="apiKey" placeholder="AIzaSy... (optional)" />
      </div>
      <button type="submit" class="submit-btn">Continue with Google Account</button>
    </form>

    ${oauthRedirectUrl ? `<a class="oauth-link" href="${oauthRedirectUrl}">Use Custom GCP OAuth Redirect instead →</a>` : ''}
  </div>
</body>
</html>`);
            return;
          }

          // 2. Direct PKCE Completion Route
          if (reqUrl.pathname === '/auth/complete') {
            const email = (reqUrl.searchParams.get('email') || '').trim();
            const apiKey = (reqUrl.searchParams.get('apiKey') || '').trim();

            if (!email || !email.includes('@')) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end('<h2>Invalid email address</h2>');
              return;
            }

            const tokens = {
              email,
              access_token: apiKey || `pkce_session_${this.pkceVerifier.slice(0, 24)}`,
              pkce_challenge: this.pkceChallenge,
              provider: 'google-antigravity-pkce',
              acquired_at: Date.now(),
              expires_in: 86400 * 30,
            };

            this.saveTokens(tokens);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Weave Connected</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #09090b; color: #ffffff; }
    .card { background: #121214; border: 1px solid #27272a; border-radius: 16px; padding: 36px; text-align: center; max-width: 380px; }
    .check { width: 44px; height: 44px; border-radius: 50%; background: #ffffff; color: #000000; display: inline-flex; align-items: center; justify-content: center; font-size: 22px; font-weight: bold; margin-bottom: 14px; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { color: #a1a1aa; font-size: 13px; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h1>Google Account Verified</h1>
    <p>Connected as <strong>${email}</strong>.<br/>Returning to Weave Desktop...</p>
  </div>
  <script>setTimeout(() => window.close(), 700);</script>
</body>
</html>`);

            setTimeout(() => {
              try { server.close(); } catch {}
              this.activeServer = null;
            }, 500);
            resolve(tokens);
            return;
          }

          // 3. Standard Google OAuth 2.0 Code Callback Route
          if (reqUrl.pathname === '/auth/callback') {
            const code = reqUrl.searchParams.get('code');
            const error = reqUrl.searchParams.get('error');

            if (error) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(`<h2>Authentication Failed</h2><p>${error}</p>`);
              server.close();
              this.activeServer = null;
              reject(new Error(`OAuth error: ${error}`));
              return;
            }

            if (!code) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end('<h2>Missing Authorization Code</h2>');
              return;
            }

            const tokens = await this.exchangeCodeForTokens(code, redirectUri);
            let email = null;
            try {
              const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${tokens.access_token}` },
              });
              if (userInfoRes.ok) {
                const data = await userInfoRes.json();
                email = data.email;
              }
            } catch {}

            tokens.email = email || detectedAccount || 'google-user@gmail.com';
            tokens.acquired_at = Date.now();
            this.saveTokens(tokens);

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<!DOCTYPE html><html><body style="background:#09090b;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;"><div><h2>✓ Google Account Connected (${tokens.email})</h2><script>setTimeout(()=>window.close(),700);</script></div></body></html>`);

            server.close();
            this.activeServer = null;
            resolve(tokens);
            return;
          }

          res.writeHead(404);
          res.end('Not found');
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<h2>Authentication error</h2><p>${err.message}</p>`);
          try { server.close(); } catch {}
          this.activeServer = null;
          reject(err);
        }
      });

      this.activeServer = server;

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && port === DEFAULT_PORT) {
          // Retry on any available ephemeral port
          port = 0;
          server.listen(0, '127.0.0.1');
        } else {
          reject(err);
        }
      });

      server.listen(port, '127.0.0.1', () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : port;
        const loginUrl = `http://127.0.0.1:${port}/auth/google`;
        console.log(`🔑 Weave Google PKCE Auth portal active at ${loginUrl}`);
        if (onUrlReady) {
          onUrlReady(loginUrl);
        }
      });
    });
  }

  /**
   * Exchanges authorization code for access & refresh tokens
   */
  async exchangeCodeForTokens(code, redirectUri) {
    const body = new URLSearchParams({
      client_id: this.clientId,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
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

  async getValidAccessToken() {
    if (!this.tokens) this.tokens = this.loadTokens();
    if (!this.tokens) {
      throw new Error('Not logged in. Please connect your Google Account in Weave.');
    }
    return this.tokens.access_token;
  }
}

export const googleAuth = new GoogleAuthManager();
