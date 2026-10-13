import { googleAuth } from './auth.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const CLOUDCODE_HOSTS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
];

/**
 * Direct Gemini API Client supporting OAuth Bearer Tokens (Cloud Code Assist & Generative Language)
 * or standard Gemini API Keys (`GEMINI_API_KEY`).
 * Works standalone without requiring local `agy` CLI installation.
 */
export class GeminiClient {
  constructor(options = {}) {
    this.model = options.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY || '';
    this.cachedProject = null;
    this.cachedHost = null;
  }

  async resolveCloudCodeProject(accessToken) {
    if (this.cachedProject && this.cachedHost) {
      return { host: this.cachedHost, project: this.cachedProject };
    }

    const metadataPayloads = [
      { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
      { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
    ];

    for (const host of CLOUDCODE_HOSTS) {
      for (const metadata of metadataPayloads) {
        try {
          const loadRes = await fetch(`${host}/v1internal:loadCodeAssist`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'User-Agent': 'antigravity/2.0.0',
            },
            body: JSON.stringify({ metadata }),
          });
          if (!loadRes.ok) continue;
          const loadData = await loadRes.json();
          if (loadData.cloudaicompanionProject) {
            this.cachedHost = host;
            this.cachedProject = loadData.cloudaicompanionProject;
            return { host, project: this.cachedProject };
          }

          const tierId =
            loadData.allowedTiers?.find((t) => t.isDefault)?.id ||
            loadData.allowedTiers?.[0]?.id ||
            'free-tier';
          const onboardRes = await fetch(`${host}/v1internal:onboardUser`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'User-Agent': 'antigravity/2.0.0',
            },
            body: JSON.stringify({ tierId, metadata }),
          });
          if (onboardRes.ok) {
            const onboardData = await onboardRes.json();
            const proj =
              onboardData.response?.cloudaicompanionProject?.id ||
              onboardData.response?.cloudaicompanionProject ||
              onboardData.cloudaicompanionProject;
            if (proj) {
              this.cachedHost = host;
              this.cachedProject = proj;
              return { host, project: proj };
            }
          }
        } catch {
          // try next
        }
      }
    }
    return { host: CLOUDCODE_HOSTS[0], project: undefined };
  }

  /**
   * Generates content directly from Gemini (via API Key or Google OAuth PKCE token)
   * @param {string} prompt - The user prompt
   * @param {string|null} [systemInstruction] - Optional system prompt
   */
  async generateContent(prompt, systemInstruction = null) {
    const apiKey = this.apiKey || process.env.GEMINI_API_KEY || '';

    const contents = [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ];

    // 1. Direct Gemini API Key if configured
    if (apiKey) {
      const endpoint = `${GEMINI_API_BASE}/models/${this.model}:generateContent`;
      const body = { contents };
      if (systemInstruction) {
        body.systemInstruction = { parts: [{ text: systemInstruction }] };
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${err}`);
      }
      const data = await response.json();
      const text =
        data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
      return { text, raw: data };
    }

    // 2. Google OAuth 2.0 PKCE Token (Cloud Code Assist / Antigravity endpoint)
    if (googleAuth.isAuthenticated()) {
      const accessToken = await googleAuth.getValidAccessToken();
      const { host, project } = await this.resolveCloudCodeProject(accessToken);

      const requestBody = { contents };
      if (systemInstruction) {
        requestBody.systemInstruction = { parts: [{ text: systemInstruction }] };
      }

      const cloudCodePayload = {
        model: this.model,
        ...(project ? { project } : {}),
        request: requestBody,
      };

      const ccRes = await fetch(`${host}/v1internal:generateContent`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity/2.0.0',
        },
        body: JSON.stringify(cloudCodePayload),
      });

      if (ccRes.ok) {
        const ccData = await ccRes.json();
        const inner = ccData.response || ccData;
        const text =
          inner.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
        return { text, raw: ccData };
      }

      // Fallback: try generativelanguage.googleapis.com with OAuth Bearer token
      const glRes = await fetch(
        `${GEMINI_API_BASE}/models/${this.model}:generateContent`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (glRes.ok) {
        const glData = await glRes.json();
        const text =
          glData.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
        return { text, raw: glData };
      }

      const ccErr = await ccRes.text().catch(() => '');
      throw new Error(`Gemini OAuth API error (${ccRes.status}): ${ccErr.slice(0, 300)}`);
    }

    throw new Error(
      'Gemini authentication missing. Please sign in with Google (Step 2) or provide GEMINI_API_KEY in .env.'
    );
  }
}

export const geminiClient = new GeminiClient();
