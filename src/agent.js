import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG, loadProjectsState, saveProjectsState } from './config.js';

const __agentDir = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE_PATH = path.resolve(__agentDir, '..', '.env');

function readEnvFileDirect(key) {
  try {
    if (!fs.existsSync(ENV_FILE_PATH)) return '';
    const content = fs.readFileSync(ENV_FILE_PATH, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const k = trimmed.slice(0, eqIdx).trim();
      if (k === key) {
        return trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      }
    }
  } catch {
    // ignore
  }
  return '';
}

let activeChildProcess = null;
let currentTaskInfo = null;
let killFallbackTimer = null;

/**
 * Returns info about the currently running task, if any.
 */
export function getActiveTaskInfo() {
  return currentTaskInfo;
}

/**
 * Kills the currently running Antigravity CLI process (and its children) if one is active.
 */
export function stopActiveTask() {
  if (activeChildProcess) {
    const info = currentTaskInfo;
    const child = activeChildProcess;
    child._cancelledByUser = true;
    activeChildProcess = null;
    currentTaskInfo = null;
    if (killFallbackTimer) {
      clearTimeout(killFallbackTimer);
      killFallbackTimer = null;
    }
    try {
      // Negative PID kills the whole process group (child was spawned detached).
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore kill errors (already exited)
      }
    }
    // If the process ignores SIGTERM, escalate to SIGKILL.
    setTimeout(() => {
      try {
        if (child.exitCode === null && child.signalCode === null) {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        }
      } catch {
        // Already exited
      }
    }, 3000).unref?.();
    return info;
  }
  return null;
}

/**
 * Runs a git subcommand without a shell (no command-injection via branch/message).
 */
function gitRun(projectDir, args) {
  return execFileSync('git', args, {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Helper to get a brief git status summary if the project directory is a git repo.
 */
function getGitChangesSummary(projectDir) {
  try {
    const statusOut = gitRun(projectDir, ['status', '--short'])
      .split('\n')
      .filter((line) => line.trim() && !line.includes('.whatsapp-uploads'))
      .join('\n')
      .trim();
    return statusOut || null;
  } catch {
    return null;
  }
}

/**
 * Stages, commits (if needed), and pushes changes in `projectDir` to GitHub.
 */
export function gitCommitAndPush(projectDir, commitMessage = 'Update via WhatsApp Agent') {
  const statusBefore = gitRun(projectDir, ['status', '--short'])
    .split('\n')
    .filter((line) => line.trim() && !line.includes('.whatsapp-uploads'))
    .join('\n')
    .trim();
  if (statusBefore) {
    gitRun(projectDir, ['add', '-A']);
    try {
      gitRun(projectDir, ['reset', 'HEAD', '--', '.whatsapp-uploads']);
    } catch {
      // Ignore if .whatsapp-uploads was not staged
    }
    // Passed as a single argv entry — no shell, so $, backticks, quotes are safe.
    gitRun(projectDir, ['commit', '-m', commitMessage || 'Update via WhatsApp Agent']);
  }

  const branch = gitRun(projectDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!/^[\w.\/-]+$/.test(branch) || branch === 'HEAD') {
    throw new Error(`Refusing to push unusual branch name: ${branch}`);
  }
  const commitHash = gitRun(projectDir, ['rev-parse', '--short', 'HEAD']);
  let remoteUrl = '';
  try {
    remoteUrl = gitRun(projectDir, ['config', '--get', 'remote.origin.url']).replace(
      /\.git$/,
      ''
    );
  } catch {
    remoteUrl = '';
  }

  gitRun(projectDir, ['push', 'origin', branch]);

  return {
    committedNewChanges: Boolean(statusBefore),
    branch,
    commitHash,
    remoteUrl,
  };
}

/**
 * Reads the GitHub personal access token from environment or ~/.git-credentials.
 */
function getGitHubCredentials() {
  const envToken = (
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    readEnvFileDirect('GITHUB_TOKEN') ||
    readEnvFileDirect('GH_TOKEN') ||
    ''
  ).trim();
  const envUser = (process.env.GITHUB_USER || readEnvFileDirect('GITHUB_USER') || '').trim();
  if (envToken) {
    return { username: envUser || 'github-user', token: envToken };
  }
  try {
    const credPath = path.join(os.homedir(), '.git-credentials');
    if (fs.existsSync(credPath)) {
      const lines = fs.readFileSync(credPath, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const match = line.trim().match(/^https:\/\/([^:]+):([^@]+)@github\.com/i);
        if (match) {
          return {
            username: decodeURIComponent(match[1]),
            token: decodeURIComponent(match[2]),
          };
        }
      }
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

/**
 * Normalizes a GitHub username or profile URL into a clean username (or email if passed).
 */
function cleanGitHubUsername(input) {
  let s = String(input || '').trim();
  // Strip markdown links like [text](url)
  const mdMatch = s.match(/\[([^\]]+)\]\(([^)]+)\)/);
  if (mdMatch) {
    s = mdMatch[2].includes('github.com') ? mdMatch[2] : mdMatch[1];
  }
  // Extract from github.com/<username>
  const urlMatch = s.match(/github\.com\/([A-Za-z0-9_.-]+)/i);
  if (urlMatch) {
    return urlMatch[1];
  }
  return s.replace(/^@/, '').trim();
}

/**
 * Resolves a GitHub username (or searches by email if an email address was given).
 */
async function resolveGitHubUsername(rawInput, headers) {
  const cleaned = cleanGitHubUsername(rawInput);
  if (!cleaned) return '';
  if (cleaned.includes('@')) {
    try {
      const q = encodeURIComponent(`${cleaned} in:email`);
      const res = await fetch(`https://api.github.com/search/users?q=${q}`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data?.items?.length > 0 && data.items[0].login) {
          return data.items[0].login;
        }
      }
    } catch {
      // Fall through
    }
  }
  return cleaned;
}

/**
 * Normalizes friendly permission names into GitHub API permission values.
 */
function normalizeGitHubPermission(rawPerm = 'push') {
  const p = String(rawPerm || 'push').trim().toLowerCase();
  if (['read', 'pull', 'view', 'viewer', 'triage'].includes(p)) {
    return p === 'triage' ? 'triage' : 'pull';
  }
  if (['admin', 'owner', 'full'].includes(p)) return 'admin';
  if (['maintain', 'maintainer'].includes(p)) return 'maintain';
  return 'push'; // default write access
}

/**
 * Parses a GitHub repository identifier (`owner/repo`), GitHub URL, or local project directory
 * into `{ owner, repo, htmlUrl }`.
 */
export function resolveGitHubRepo({ projectDir, repoInput, defaultOwner } = {}) {
  const parseUrlOrSlug = (str) => {
    if (!str) return null;
    const trimmed = str.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
    // Match https://github.com/owner/repo or git@github.com:owner/repo
    const urlMatch = trimmed.match(/github\.com[:/]([^/]+)\/([^/]+)$/i);
    if (urlMatch) {
      return {
        owner: urlMatch[1],
        repo: urlMatch[2],
        htmlUrl: `https://github.com/${urlMatch[1]}/${urlMatch[2]}`,
      };
    }
    // Match owner/repo slug
    const slugMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    if (slugMatch) {
      return {
        owner: slugMatch[1],
        repo: slugMatch[2],
        htmlUrl: `https://github.com/${slugMatch[1]}/${slugMatch[2]}`,
      };
    }
    // Bare repo name if defaultOwner is known
    if (defaultOwner && /^[A-Za-z0-9_.-]+$/.test(trimmed)) {
      return {
        owner: defaultOwner,
        repo: trimmed,
        htmlUrl: `https://github.com/${defaultOwner}/${trimmed}`,
      };
    }
    return null;
  };

  if (repoInput) {
    const direct = parseUrlOrSlug(repoInput);
    if (direct) return direct;
  }

  if (projectDir && fs.existsSync(projectDir)) {
    try {
      const remoteUrl = gitRun(projectDir, ['config', '--get', 'remote.origin.url']);
      const fromGit = parseUrlOrSlug(remoteUrl);
      if (fromGit) return fromGit;
    } catch {
      // Ignore if not a git repo or no remote.origin.url
    }
  }

  return null;
}

/**
 * Adds/invites a GitHub user as a collaborator to a repository.
 *
 * @param {object} params
 * @param {string} params.username - GitHub username (or email) to invite
 * @param {string} [params.permission='push'] - 'pull' | 'triage' | 'push' | 'maintain' | 'admin'
 * @param {string} [params.projectDir] - Local project directory to infer git remote from
 * @param {string} [params.repoInput] - Explicit 'owner/repo', repo name, or GitHub URL
 */
export async function addGitHubCollaborator({
  username,
  permission = 'push',
  projectDir,
  repoInput,
}) {
  const creds = getGitHubCredentials();
  if (!creds?.token) {
    throw new Error(
      'GitHub credentials not found. Set GITHUB_TOKEN in .env or configure ~/.git-credentials.'
    );
  }

  const headers = {
    Authorization: `Bearer ${creds.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'WhatsApp-Antigravity-Agent',
  };

  const cleanUser = await resolveGitHubUsername(username, headers);
  if (!cleanUser || !/^[A-Za-z0-9-]+$/.test(cleanUser)) {
    throw new Error(
      `Invalid or unresolvable GitHub username: "${username}". Please provide a valid GitHub username (e.g. octocat).`
    );
  }

  const repoInfo = resolveGitHubRepo({
    projectDir,
    repoInput,
    defaultOwner: creds.username,
  });

  if (!repoInfo) {
    throw new Error(
      'Could not determine the GitHub repository. Specify it as `owner/repo` or bind this chat to a project with a GitHub `origin` remote.'
    );
  }

  const normalizedPerm = normalizeGitHubPermission(permission);
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.repo)}/collaborators/${encodeURIComponent(cleanUser)}`;

  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ permission: normalizedPerm }),
  });

  if (res.status === 201) {
    const data = await res.json().catch(() => ({}));
    return {
      status: 'invited',
      username: cleanUser,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      permission: normalizedPerm,
      htmlUrl: data?.html_url || `${repoInfo.htmlUrl}/invitations`,
    };
  }

  if (res.status === 204) {
    return {
      status: 'already_collaborator',
      username: cleanUser,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      permission: normalizedPerm,
      htmlUrl: repoInfo.htmlUrl,
    };
  }

  const errBody = await res.json().catch(() => ({}));
  const errMsg = errBody?.message || `HTTP ${res.status}`;
  if (res.status === 404) {
    throw new Error(
      `GitHub returned 404 Not Found for ${repoInfo.owner}/${repoInfo.repo} or user @${cleanUser}. Verify the repo/username exists and your GITHUB_TOKEN has "repo" (or Collaborators Read/Write) permission.`
    );
  }
  if (res.status === 403 || res.status === 401) {
    throw new Error(
      `GitHub authentication/permission error (${res.status}): ${errMsg}. Ensure your token has admin/write access to ${repoInfo.owner}/${repoInfo.repo}.`
    );
  }
  throw new Error(`GitHub API error (${res.status}): ${errMsg}`);
}

/**
 * Removes a GitHub user as a collaborator from a repository (or cancels their pending invite).
 */
export async function removeGitHubCollaborator({ username, projectDir, repoInput }) {
  const creds = getGitHubCredentials();
  if (!creds?.token) {
    throw new Error(
      'GitHub credentials not found. Set GITHUB_TOKEN in .env or configure ~/.git-credentials.'
    );
  }

  const headers = {
    Authorization: `Bearer ${creds.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'WhatsApp-Antigravity-Agent',
  };

  const cleanUser = await resolveGitHubUsername(username, headers);
  if (!cleanUser || !/^[A-Za-z0-9-]+$/.test(cleanUser)) {
    throw new Error(`Invalid GitHub username: "${username}".`);
  }

  const repoInfo = resolveGitHubRepo({
    projectDir,
    repoInput,
    defaultOwner: creds.username,
  });

  if (!repoInfo) {
    throw new Error(
      'Could not determine the GitHub repository. Specify it as `owner/repo` or bind this chat to a project with a GitHub `origin` remote.'
    );
  }

  // Also check if there is a pending invitation for this user and cancel it if found
  try {
    const invUrl = `https://api.github.com/repos/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.repo)}/invitations`;
    const invRes = await fetch(invUrl, { headers });
    if (invRes.ok) {
      const invitations = await invRes.json();
      const pending = Array.isArray(invitations)
        ? invitations.find(
            (inv) => inv?.invitee?.login?.toLowerCase() === cleanUser.toLowerCase()
          )
        : null;
      if (pending?.id) {
        const delInvRes = await fetch(`${invUrl}/${pending.id}`, {
          method: 'DELETE',
          headers,
        });
        if (delInvRes.status === 204) {
          return {
            status: 'invitation_cancelled',
            username: cleanUser,
            owner: repoInfo.owner,
            repo: repoInfo.repo,
          };
        }
      }
    }
  } catch {
    // Fall through to collaborator removal
  }

  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.repo)}/collaborators/${encodeURIComponent(cleanUser)}`;
  const res = await fetch(apiUrl, {
    method: 'DELETE',
    headers,
  });

  if (res.status === 204) {
    return {
      status: 'removed',
      username: cleanUser,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
    };
  }

  const errBody = await res.json().catch(() => ({}));
  throw new Error(
    `GitHub API error (${res.status}): ${errBody?.message || 'Failed to remove collaborator'}`
  );
}

/**
 * Lists current collaborators and pending invitations for a GitHub repository.
 */
export async function listGitHubCollaborators({ projectDir, repoInput } = {}) {
  const creds = getGitHubCredentials();
  if (!creds?.token) {
    throw new Error(
      'GitHub credentials not found. Set GITHUB_TOKEN in .env or configure ~/.git-credentials.'
    );
  }

  const repoInfo = resolveGitHubRepo({
    projectDir,
    repoInput,
    defaultOwner: creds.username,
  });

  if (!repoInfo) {
    throw new Error(
      'Could not determine the GitHub repository. Specify it as `owner/repo` or bind this chat to a project with a GitHub `origin` remote.'
    );
  }

  const headers = {
    Authorization: `Bearer ${creds.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'WhatsApp-Antigravity-Agent',
  };

  const collabUrl = `https://api.github.com/repos/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.repo)}/collaborators`;
  const invUrl = `https://api.github.com/repos/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.repo)}/invitations`;

  const [collabRes, invRes] = await Promise.all([
    fetch(collabUrl, { headers }),
    fetch(invUrl, { headers }),
  ]);

  if (!collabRes.ok) {
    const errBody = await collabRes.json().catch(() => ({}));
    throw new Error(
      `GitHub API error (${collabRes.status}): ${errBody?.message || 'Failed to list collaborators'}`
    );
  }

  const collabs = await collabRes.json();
  const invitations = invRes.ok ? await invRes.json().catch(() => []) : [];

  return {
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    htmlUrl: repoInfo.htmlUrl,
    collaborators: Array.isArray(collabs)
      ? collabs.map((c) => ({
          username: c.login,
          roleName: c.role_name || (c.permissions?.admin ? 'admin' : c.permissions?.push ? 'write' : 'read'),
        }))
      : [],
    pendingInvitations: Array.isArray(invitations)
      ? invitations.map((inv) => ({
          id: inv.id,
          username: inv.invitee?.login || 'unknown',
          permission: inv.permissions || 'write',
          htmlUrl: inv.html_url,
        }))
      : [],
  };
}

/**
 * Cleans up IDE-specific file:// links so the message reads cleanly in WhatsApp.
 */
function formatForWhatsApp(text) {
  return text.replace(/\[([^\]]+)\]\(file:\/\/[^)]+\)/g, '`$1`').trim();
}

/**
 * Executes a coding task in the target project directory using the Antigravity CLI (`agy`).
 *
 * @param {object} params
 * @param {string} params.projectAlias
 * @param {string} params.projectDir
 * @param {string} params.taskPrompt
 * @param {boolean} [params.continueSession=false]
 * @returns {Promise<{response: string, conversationId?: string, durationSeconds?: number, numTurns?: number, gitSummary?: string | null}>}
 */
export async function runAntigravityTask({
  projectAlias,
  projectDir,
  taskPrompt,
  continueSession = false,
  imagePath = null,
  attachmentInfo = null,
  pendingEmailDraft = null,
  ownerAllowedToMessage = false,
  mentionedJids = [],
  recentChatContext = '',
}) {
  if (!fs.existsSync(projectDir)) {
    throw new Error(`Project directory does not exist: ${projectDir}`);
  }

  const now = new Date();
  const currentDateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
  const currentTimeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
  const todayIsoDate = now.toISOString().split('T')[0];

  const state = loadProjectsState();
  const previousConvId = state.conversations?.[projectAlias];

  const filePath = attachmentInfo?.filePath || imagePath;
  const isImage = attachmentInfo ? attachmentInfo.type === 'image' : Boolean(imagePath);

  const imageInstructions = filePath
    ? isImage
      ? [
          `ATTACHED WHATSAPP IMAGE: The user attached an image saved at "${filePath}".`,
          `- You MUST first inspect this image using your view_file tool on "${filePath}" to see what it shows (e.g. a screenshot, mockup, error, or photo).`,
          `- If the user wants this image emailed as an attachment, include "${filePath}" in your [DRAFT_EMAIL: ...] directive and DO NOT delete "${filePath}".`,
          `- If the user wants this image added to the website/project, copy or move it from "${filePath}" into the appropriate assets/public folder of "${projectDir}".`,
          `- If the image was only a reference/screenshot (not meant to be emailed or committed to the repo), delete "${filePath}" after inspecting it so it doesn't clutter git status.`,
        ].join('\n')
      : [
          `ATTACHED WHATSAPP DOCUMENT/FILE: The user attached a file ("${attachmentInfo?.fileName || filePath}") saved locally at "${filePath}".`,
          `- You can read or inspect this file at "${filePath}" if needed to help draft an email or complete the user's task.`,
          `- IMPORTANT: Do NOT delete "${filePath}" if the user wants to email or forward this attachment!`,
        ].join('\n')
    : null;

  const existingDraftInstructions =
    ownerAllowedToMessage && pendingEmailDraft
      ? [
          `CURRENT PENDING EMAIL DRAFT (in case the user is asking to edit/revise the draft):`,
          `- To: ${pendingEmailDraft.to}`,
          `- Subject: ${pendingEmailDraft.subject}`,
          `- Attachments: ${(pendingEmailDraft.attachments || []).join(', ') || 'NONE'}`,
          `- Body:\n${pendingEmailDraft.body}`,
        ].join('\n')
      : null;

  const ownerEmail = CONFIG.ownerEmail || '';
  const messagingInstructions = ownerAllowedToMessage
    ? [
        `OWNER CAPABILITIES: This request is from the Bot Owner.`,
        mentionedJids.length > 0
          ? `- Mentioned Contact JID(s) in this message: ${mentionedJids.join(', ')}`
          : null,
        `- To send a WhatsApp text message/DM to a contact, include a line at the end of your response:`,
        `  [SEND_WHATSAPP: <target_jid_or_name_or_number> | <message_to_send>]`,
        `- To send a local file from this PC (e.g. from the home directory, ~/Documents, ~/Downloads, ~/Desktop, or the project folder) to the current chat or to a specific contact, locate the exact file path and include a line at the end of your response:`,
        `  [SEND_FILE: HERE | /absolute/path/to/file]`,
        `  (or to send the file to a specific contact: [SEND_FILE: <target_jid_or_name_or_number> | /absolute/path/to/file])`,
        `- For VISUAL QA & SCREENSHOTS: When asked to test, preview, or take a screenshot of a webpage or dev server, you can run headless Firefox:`,
        `  firefox --headless --window-size=1280,800 --screenshot=/tmp/preview.png http://localhost:PORT (or URL)`,
        `  and then send it to the chat by outputting: [SEND_FILE: HERE | /tmp/preview.png]`,
        ownerEmail ? `OWNER IDENTITY & PREFERENCES:` : null,
        ownerEmail ? `- The Owner's registered email address is: "${ownerEmail}".` : null,
        ownerEmail
          ? `- Whenever the owner says "mail this to me", "email this to me", "send this to my mail", or "email me", ALWAYS use "${ownerEmail}" as the recipient in your [SEND_EMAIL: ${ownerEmail} | ...] directive! The bot sends emails directly to the owner immediately without requiring any confirmation step.`
          : null,
        `- CALENDAR & MEETING INTELLIGENCE:`,
        ownerEmail ? `  * The owner's Google Calendar is associated with "${ownerEmail}".` : null,
        `  * Today is ${currentDateStr}. Current local time: ${currentTimeStr}.`,
        `  * When scheduling a meeting or adding an event to the owner's calendar:`,
        `    - CAREFULLY examine the referenced message AND the Recent Chat Context for agreed meeting times, topics, and agendas!`,
        `    - Look for timing agreements in the chat (e.g. "Is 7 fine?", "7 works", "let's do 7", "7 pm", "tomorrow at 11am"). If a time was agreed upon, schedule the event for that time! Do NOT guess or default to an arbitrary time when a time was discussed in the chat.`,
        `    - Extract the FULL meeting agenda or discussion points (e.g. "1. General order of events, 2. Social media updates...") and include them in:`,
        `      1) The [CALENDAR_EVENT: Title | Start | Duration | Description | Location] Description field.`,
        ownerEmail
          ? `      2) The [SEND_EMAIL: ${ownerEmail} | Subject | Attachments | Body] Body field.`
          : null,
        `    - Give the meeting a descriptive Title based on the topic/agenda (e.g. "Team Meeting: Event Order & Sales Strategy") rather than just a generic "Meeting".`,
        `    - Include the video conferencing link (e.g. Google Meet URL) in both the Description and Location.`,
        `    - Start Time format: ISO format with local timezone offset, e.g. "${todayIsoDate}T19:00:00+05:30" (or YYYY-MM-DDTHH:MM:SSZ).`,
        `  * Include a calendar event directive at the end of your response:`,
        `    [CALENDAR_EVENT: <Event Title> | <Start Date/Time e.g. ${todayIsoDate}T19:00:00+05:30> | <Duration e.g. 1h or End Date/Time> | <Description> | <Optional Location>]`,
        `    The bot automatically syncs this event directly to Google Calendar via RFC 5545 invite without opening links.`,
        `- SILENT EXECUTION FOR OWNER EMAIL & CALENDAR: When the owner's request is purely personal (e.g. "mail this to me", "add this to my calendar", "send this to my email and add it to my calendar"):`,
        `  * Do NOT output conversational greetings, chat text, meet links, or status cards in your response!`,
        `  * Output ONLY the directives [SEND_EMAIL: ...] and/or [CALENDAR_EVENT: ...].`,
        `  * The bot will acknowledge with a silent checkmark emoji reaction in WhatsApp so group chats remain clean, private, and uncluttered.`,
        `- To draft or revise an EMAIL (with or without attachments, either using the attached WhatsApp file "${filePath || ''}" or any local file), draft a clear, professional Subject and Body and include a block at the end of your response in this exact format so the owner can preview and confirm it before sending:`,
        `  [DRAFT_EMAIL: recipient@example.com | Subject Line Here | /path/to/attachment1, /path/to/attachment2 (or NONE) | Full drafted email body here...]`,
        ownerEmail
          ? `  (When the owner says "mail this to me", use "${ownerEmail}" as the recipient)`
          : null,
        `- To share the owner's LIVE LOCATION on WhatsApp with a contact (or in the current chat using HERE) for a specified duration in hours (e.g. 8 for 8 hours, 1 for 1 hour), include a line at the end of your response in this exact format:`,
        `  [SHARE_LIVE_LOCATION: <target_contact_name_or_number_or_HERE> | <duration_in_hours_e.g._8> | <AUTO_or_specific_place_or_lat,lon>]`,
        `- To add/invite a GitHub collaborator to a repository (either the current project's repo using CURRENT or a specific repo like owner/repo or repo-name), do NOT run curl or gh yourself — instead include a line at the end of your response in this exact format (and the bot will call the GitHub API directly):`,
        `  [ADD_COLLABORATOR: <github_username> | <CURRENT_or_owner/repo> | <push_or_pull_or_admin>]`,
        `- To remove a GitHub collaborator (or cancel their pending invitation) from a repository, include a line at the end of your response in this exact format:`,
        `  [REMOVE_COLLABORATOR: <github_username> | <CURRENT_or_owner/repo>]`,
        `- To list all GitHub collaborators and pending invitations for a repository, include a line at the end of your response in this exact format:`,
        `  [LIST_COLLABORATORS: <CURRENT_or_owner/repo>]`,
      ]
        .filter(Boolean)
        .join('\n')
    : `SECURITY RULE: This user is NOT the bot owner. You are strictly isolated to "${projectDir}". You MUST NEVER read, list, modify, or send any files outside "${projectDir}", and if they ask you to message a contact, send emails, share live location, manage GitHub collaborators, or send local PC files, politely refuse.`;

  const systemWrapperPrompt = [
    `You are being invoked remotely via WhatsApp to perform a task. Default project workspace: "${projectDir}".`,
    `CURRENT DATE & TIME: Today is ${currentDateStr}. Current time is ${currentTimeStr}.`,
    !ownerAllowedToMessage
      ? `CRITICAL SECURITY RULE: You are strictly isolated to "${projectDir}". You MUST NEVER read, list, modify, or run commands on any files or directories outside "${projectDir}", even if the user prompt explicitly asks you to.`
      : null,
    `Git & GitHub credentials are pre-configured on this machine. If the user asks to push to GitHub, deploy, or make changes live, run "git add -A && git commit -m '<concise message>' && git push" inside "${projectDir}" after making the edits.`,
    imageInstructions,
    existingDraftInstructions,
    recentChatContext
      ? [
          `RECENT CHAT CONTEXT (Recent messages from this WhatsApp conversation):`,
          recentChatContext,
          ``,
        ].join('\n')
      : null,
    messagingInstructions,
    `Complete the requested task and provide a brief, direct response (1-2 short sentences max unless the user explicitly asks for details). Do NOT output robotic status reports, bulleted change summaries, or filler phrases.`,
    ``,
    `User Task: ${taskPrompt}`,
  ]
    .filter(Boolean)
    .join('\n');

  const timeoutMs =
    Number.isFinite(CONFIG.taskTimeoutMs) && CONFIG.taskTimeoutMs > 0
      ? Math.min(CONFIG.taskTimeoutMs, 180000)
      : 180000;
  const timeoutMinutes = Math.max(1, Math.ceil(timeoutMs / 60000));
  const args = [
    '-p',
    systemWrapperPrompt,
    '--dangerously-skip-permissions',
    '--disable-slash-commands',
    '--output-format',
    'json',
    '--print-timeout',
    `${timeoutMinutes}m0s`,
  ];

  if (CONFIG.agyModel) {
    args.push('--model', CONFIG.agyModel);
  }

  if (continueSession && previousConvId) {
    args.push('--conversation', previousConvId);
  }

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const child = spawn(CONFIG.agyBin, args, {
      cwd: projectDir,
      env: { ...process.env, PAGER: 'cat' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    activeChildProcess = child;
    currentTaskInfo = {
      projectAlias,
      projectDir,
      taskPrompt,
      startedAt: new Date().toISOString(),
    };

    const timer = setTimeout(() => {
      if (activeChildProcess === child) {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGTERM');
          else child.kill('SIGTERM');
        } catch {
          // Ignore
        }
        killFallbackTimer = setTimeout(() => {
          try {
            if (child.exitCode === null) {
              if (child.pid) process.kill(-child.pid, 'SIGKILL');
              else child.kill('SIGKILL');
            }
          } catch {
            // Already exited
          }
        }, 5000);
        activeChildProcess = null;
        currentTaskInfo = null;
      }
      reject(
        new Error(
          `Task timed out after ${Math.round(timeoutMs / 1000)} seconds.`
        )
      );
    }, timeoutMs);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (killFallbackTimer) {
        clearTimeout(killFallbackTimer);
        killFallbackTimer = null;
      }
      activeChildProcess = null;
      currentTaskInfo = null;
      reject(new Error(`Failed to launch '${CONFIG.agyBin}': ${err.message}`));
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (killFallbackTimer) {
        clearTimeout(killFallbackTimer);
        killFallbackTimer = null;
      }
      activeChildProcess = null;
      currentTaskInfo = null;

      if (signal === 'SIGTERM' || signal === 'SIGKILL' || child._cancelledByUser) {
        const cancelErr = new Error('Task was cancelled by user.');
        cancelErr.cancelled = true;
        reject(cancelErr);
        return;
      }

      const elapsedSeconds = (Date.now() - startTime) / 1000;
      const trimmedOut = stdout.trim();

      // Try parsing the JSON output from agy --output-format json.
      // Handles: whole-stdout JSON (single- or multi-line), trailing JSON line,
      // or a JSON block embedded in prefix text.
      let parsed = null;
      if (trimmedOut) {
        try {
          parsed = JSON.parse(trimmedOut);
        } catch {
          // Not whole-stdout JSON — fall through to block extraction
        }
      }
      if (!parsed && trimmedOut) {
        try {
          const firstBrace = trimmedOut.indexOf('{');
          const lastBrace = trimmedOut.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace > firstBrace) {
            parsed = JSON.parse(trimmedOut.slice(firstBrace, lastBrace + 1));
          }
        } catch {
          parsed = null;
        }
      }
      if (!parsed && trimmedOut) {
        try {
          // Last resort: find the last single-line JSON object
          const lines = trimmedOut.split('\n').filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].trim().startsWith('{')) {
              parsed = JSON.parse(lines[i].trim());
              break;
            }
          }
        } catch {
          parsed = null;
        }
      }

      if (code !== 0 && !parsed) {
        reject(
          new Error(
            `Agent exited with code ${code}.\n${(stderr || stdout || 'No output').slice(0, 1000)}`
          )
        );
        return;
      }

      const gitSummary = getGitChangesSummary(projectDir);

      if (parsed) {
        // The CLI can exit non-zero yet still emit JSON, or exit 0 with an
        // error payload (e.g. status: ERROR on auth failure). Never report
        // those as success — surface the real error instead.
        const agentError =
          parsed.error ||
          (typeof parsed.status === 'string' && parsed.status.toUpperCase() === 'ERROR'
            ? `Agent reported status: ${parsed.status}`
            : null);
        if (agentError && !parsed.response) {
          reject(
            new Error(
              `Agent failed: ${String(agentError).slice(0, 800)}${stderr ? `\n${stderr.slice(0, 400)}` : ''}`
            )
          );
          return;
        }

        // Save conversation_id for this project so user can continue if desired
        if (parsed.conversation_id) {
          const updatedState = loadProjectsState();
          updatedState.conversations = updatedState.conversations || {};
          updatedState.conversations[projectAlias] = parsed.conversation_id;
          saveProjectsState(updatedState);
        }

        resolve({
          response: formatForWhatsApp(parsed.response || 'Task completed (no text output).'),
          conversationId: parsed.conversation_id,
          durationSeconds: parsed.duration_seconds || elapsedSeconds,
          numTurns: parsed.num_turns || 1,
          gitSummary,
        });
      } else {
        resolve({
          response: formatForWhatsApp(trimmedOut || 'Task completed.'),
          durationSeconds: elapsedSeconds,
          gitSummary,
        });
      }
    });
  });
}
