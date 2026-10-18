import { googleAuth } from './auth.js';

const GOOGLE_API_BASE = 'https://www.googleapis.com';

/**
 * Direct Google Calendar & Gmail integration using OAuth tokens.
 * Works seamlessly without SMTP passwords or app-specific passwords.
 */
export class GoogleServices {
  async getAuthHeaders() {
    const token = await googleAuth.getValidAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  // --- CALENDAR APIS ---

  /**
   * List upcoming calendar events
   */
  async listEvents(maxResults = 10) {
    const headers = await this.getAuthHeaders();
    const timeMin = new Date().toISOString();
    const url = `${GOOGLE_API_BASE}/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(
      timeMin
    )}&maxResults=${maxResults}&singleEvents=true&orderBy=startTime`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`Failed to list calendar events: ${await res.text()}`);
    }
    const data = await res.json();
    return data.items || [];
  }

  /**
   * Create a new event on Google Calendar
   */
  async createEvent({ summary, description, startIso, endIso, attendees = [] }) {
    const headers = await this.getAuthHeaders();
    const url = `${GOOGLE_API_BASE}/calendar/v3/calendars/primary/events`;

    const body = {
      summary,
      description,
      start: { dateTime: startIso },
      end: { dateTime: endIso },
      attendees: attendees.map((email) => ({ email })),
    };

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Failed to create calendar event: ${await res.text()}`);
    }

    return await res.json();
  }

  // --- GMAIL APIS ---

  /**
   * Send email using Gmail API (No SMTP / No App Passwords!)
   */
  async sendEmail({ to, subject, bodyText, from = 'me' }) {
    const headers = await this.getAuthHeaders();
    const url = `${GOOGLE_API_BASE}/gmail/v1/users/me/messages/send`;

    const emailSignature = 'Sent by Weave';
    let formattedBody = (bodyText || '').trim();
    if (!formattedBody.endsWith(emailSignature)) {
      formattedBody = formattedBody ? `${formattedBody}\n\n${emailSignature}` : emailSignature;
    }

    // Construct standard RFC 2822 email format
    const emailLines = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      formattedBody,
    ];

    const rawMessage = emailLines.join('\r\n');
    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ raw: encodedMessage }),
    });

    if (!res.ok) {
      throw new Error(`Failed to send email via Gmail API: ${await res.text()}`);
    }

    return await res.json();
  }
}

export const googleServices = new GoogleServices();
