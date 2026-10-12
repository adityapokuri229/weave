import { googleAuth } from './auth.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Direct Gemini API Client supporting OAuth Bearer Tokens or standard API Keys.
 * No CLI (`agy`) required!
 */
export class GeminiClient {
  constructor(options = {}) {
    this.model = options.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY || '';
  }

  async getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['x-goog-api-key'] = this.apiKey;
    } else if (googleAuth.isAuthenticated()) {
      const accessToken = await googleAuth.getValidAccessToken();
      headers['Authorization'] = `Bearer ${accessToken}`;
    } else {
      throw new Error(
        'Gemini authentication missing. Please sign in with Google or provide GEMINI_API_KEY.'
      );
    }

    return headers;
  }

  /**
   * Generates content directly from Gemini
   * @param {string} prompt - The user prompt
   * @param {object} [systemInstruction] - Optional system prompt
   */
  async generateContent(prompt, systemInstruction = null) {
    const headers = await this.getHeaders();
    const endpoint = `${GEMINI_API_BASE}/models/${this.model}:generateContent`;

    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
    };

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text).join('') || '';

    return {
      text,
      raw: data,
    };
  }
}

export const geminiClient = new GeminiClient();
