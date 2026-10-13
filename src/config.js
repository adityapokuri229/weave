import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * Returns a guaranteed writable directory for app data (session auth, qr image, projects).
 * In development checkout, uses ROOT_DIR.
 * In packaged AppImage/binary where ROOT_DIR is read-only, uses ~/.weave or WEAVE_DATA_DIR.
 */
export function getWritableDataDir() {
  if (process.env.WEAVE_DATA_DIR) {
    try {
      fs.mkdirSync(process.env.WEAVE_DATA_DIR, { recursive: true });
      return process.env.WEAVE_DATA_DIR;
    } catch {}
  }
  try {
    const testFile = path.join(ROOT_DIR, `.write_test_${process.pid}`);
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    return ROOT_DIR;
  } catch {
    const userDir = path.join(os.homedir(), '.weave');
    try {
      fs.mkdirSync(userDir, { recursive: true });
    } catch {}
    return userDir;
  }
}

export const DATA_DIR = getWritableDataDir();

const envPath = path.join(DATA_DIR, '.env');
const rootEnvPath = path.join(ROOT_DIR, '.env');
const envExamplePath = path.join(ROOT_DIR, '.env.example');

if (!fs.existsSync(envPath)) {
  if (fs.existsSync(rootEnvPath)) {
    try { fs.copyFileSync(rootEnvPath, envPath); } catch {}
  } else if (fs.existsSync(envExamplePath)) {
    try { fs.copyFileSync(envExamplePath, envPath); } catch {}
  }
}

dotenv.config({ path: envPath });

const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
if (DATA_DIR !== ROOT_DIR && !fs.existsSync(PROJECTS_FILE)) {
  const rootProjects = path.join(ROOT_DIR, 'projects.json');
  if (fs.existsSync(rootProjects)) {
    try { fs.copyFileSync(rootProjects, PROJECTS_FILE); } catch {}
  }
}
const HOME_DIR = process.env.HOME || os.homedir();

// Standard OS folders that should not be treated as coding projects themselves
const IGNORED_DIRS = new Set([
  'Desktop',
  'Documents',
  'Downloads',
  'Music',
  'Pictures',
  'Public',
  'Templates',
  'Videos',
  'node_modules',
]);

function parsePositiveInt(raw, fallback) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const DEFAULT_CALLSIGN = '@weave';
export const RESERVED_CALLSIGNS = new Set(['@agent', 'agent']);

function normalizeCallsign(raw) {
  const cleaned = String(raw || '').trim().toLowerCase();
  if (!cleaned) return DEFAULT_CALLSIGN;
  const withAt = cleaned.startsWith('@') ? cleaned : `@${cleaned}`;
  if (RESERVED_CALLSIGNS.has(withAt) || RESERVED_CALLSIGNS.has(cleaned)) {
    return DEFAULT_CALLSIGN;
  }
  return withAt;
}

function persistTriggerToEnvFile(filePath, handle) {
  try {
    if (!fs.existsSync(filePath)) return;
    let content = fs.readFileSync(filePath, 'utf8');
    if (/^BOT_TRIGGER=/m.test(content)) {
      content = content.replace(/^BOT_TRIGGER=.*$/m, `BOT_TRIGGER=${handle}`);
    } else {
      content += `\nBOT_TRIGGER=${handle}\n`;
    }
    fs.writeFileSync(filePath, content, 'utf8');
  } catch {}
}

export function updateTriggerPrefix(newHandle) {
  const raw = String(newHandle || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!raw) {
    return { success: false, error: 'Call-sign cannot be empty.' };
  }
  const withAt = raw.startsWith('@') ? raw : `@${raw}`;
  if (RESERVED_CALLSIGNS.has(withAt) || RESERVED_CALLSIGNS.has(raw)) {
    return {
      success: false,
      error: '"@agent" is reserved / already in use. Please choose a unique call-sign (e.g. @weave).',
    };
  }
  CONFIG.triggerPrefix = withAt;
  process.env.BOT_TRIGGER = withAt;
  persistTriggerToEnvFile(envPath, withAt);
  if (rootEnvPath !== envPath) {
    persistTriggerToEnvFile(rootEnvPath, withAt);
  }
  return { success: true, triggerPrefix: withAt };
}

// Automatically migrate legacy @agent trigger in .env to @weave so it never collides with existing @agent bots
const rawEnvTrigger = (process.env.BOT_TRIGGER || '').trim().toLowerCase();
const resolvedInitialTrigger = normalizeCallsign(rawEnvTrigger);
if (!rawEnvTrigger || RESERVED_CALLSIGNS.has(rawEnvTrigger)) {
  process.env.BOT_TRIGGER = resolvedInitialTrigger;
  persistTriggerToEnvFile(envPath, resolvedInitialTrigger);
  if (rootEnvPath !== envPath) {
    persistTriggerToEnvFile(rootEnvPath, resolvedInitialTrigger);
  }
}

export const CONFIG = {
  // Unique trigger prefix in WhatsApp messages (case-insensitive, never @agent)
  triggerPrefix: resolvedInitialTrigger,

  // Antigravity CLI binary path
  agyBin: process.env.AGY_BIN || 'agy',

  // Optional model override (e.g., gemini-3.8-flash-high, gemini-3.1-pro-high)
  agyModel: process.env.AGY_MODEL || '',

  // Timeout per task in milliseconds (default: 10 minutes; falls back on NaN/<=0)
  taskTimeoutMs: parsePositiveInt(process.env.TASK_TIMEOUT_MS, 600000),

  // Default target directory for coding tasks (used for local CLI tests / owner DM)
  defaultProjectDir: path.resolve(
    ROOT_DIR,
    process.env.DEFAULT_PROJECT_DIR || './demo-site'
  ),

  // Owner/Admin phone numbers who are allowed to /bind or /unbind groups and view all projects
  // Note: Messages sent from your own linked WhatsApp account (fromMe) are automatically Admin.
  adminNumbers: (process.env.ADMIN_NUMBERS || '')
    .split(',')
    .map((s) => s.trim().replace(/[^0-9]/g, ''))
    .filter(Boolean),

  // Comma-separated phone numbers allowed to trigger tasks in bound groups ('*' = any member of a bound group)
  allowedSenders: (process.env.ALLOWED_SENDERS || '*')
    .split(',')
    .map((s) => s.trim().replace(/[^0-9*]/g, ''))
    .filter(Boolean),

  // Whether to allow the linked account itself (fromMe) to trigger commands
  allowFromMe: process.env.ALLOW_FROM_ME !== 'false',

  // Set to true if using a dedicated bot phone number so any @mention triggers it
  triggerOnMention: process.env.TRIGGER_ON_MENTION === 'true',

  // Optional phone number for pairing code login instead of QR code
  pairingPhoneNumber: (process.env.PAIRING_PHONE_NUMBER || '').replace(
    /[^0-9]/g,
    ''
  ),

  // Optional SMTP settings for sending emails with attachments
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: parsePositiveInt(process.env.SMTP_PORT, 465),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',

  // Primary owner email address for "mail this to me" and Google Calendar events
  ownerEmail: process.env.OWNER_EMAIL || '',

  // Optional Groq API Key for ultra-fast Whisper audio transcription
  groqApiKey: process.env.GROQ_API_KEY || '',

  // GitHub Personal Access Token for repo API & collaborator operations
  githubToken: process.env.GITHUB_TOKEN || '',

  // Google OAuth 2.0 PKCE & APIs
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectPort: parsePositiveInt(process.env.GOOGLE_REDIRECT_PORT, 8085),

  // Direct Gemini API
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
};

/**
 * Automatically scans ~/ and ~/Documents and ~/Desktop for project folders.
 */
function discoverLocalProjects() {
  const discovered = {
    demo: CONFIG.defaultProjectDir,
  };

  const searchRoots = [
    HOME_DIR,
    path.join(HOME_DIR, 'Documents'),
    path.join(HOME_DIR, 'Desktop'),
  ];

  for (const root of searchRoots) {
    if (!fs.existsSync(root)) continue;
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;
        if (IGNORED_DIRS.has(entry.name)) continue;

        const fullPath = path.join(root, entry.name);
        const alias = entry.name.toLowerCase();
        if (!discovered[alias]) {
          discovered[alias] = fullPath;
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  return discovered;
}

/**
 * Load or initialize projects.json, merging in auto-discovered projects on disk.
 * Includes `groupBindings` which maps a WhatsApp group JID -> locked projectAlias.
 */
export function loadProjectsState() {
  const discovered = discoverLocalProjects();

  if (!fs.existsSync(PROJECTS_FILE)) {
    const initial = {
      activeProject: 'demo',
      projects: discovered,
      groupBindings: {},
      conversations: {},
      pendingEmailDrafts: {},
      autoPush: {},
      disabledGroups: {},
    };
    atomicWriteJson(PROJECTS_FILE, initial);
    return initial;
  }
  try {
    const saved = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
    saved.projects = { ...discovered, ...(saved.projects || {}) };
    saved.groupBindings = saved.groupBindings || {};
    saved.conversations = saved.conversations || {};
    saved.pendingEmailDrafts = saved.pendingEmailDrafts || {};
    saved.autoPush = saved.autoPush || {};
    saved.disabledGroups = saved.disabledGroups || {};
    saved.deploymentUrls = saved.deploymentUrls || {};
    saved.pendingProjectConfirmations = saved.pendingProjectConfirmations || {};
    // Validate activeProject still exists; fall back instead of crashing callers.
    if (!saved.projects[saved.activeProject]) {
      saved.activeProject = saved.projects.demo
        ? 'demo'
        : Object.keys(saved.projects)[0] || 'demo';
      if (!saved.projects[saved.activeProject]) {
        saved.projects[saved.activeProject] = CONFIG.defaultProjectDir;
      }
    }
    return saved;
  } catch {
    // Preserve the corrupt file for forensics instead of silently discarding it.
    try {
      const backup = `${PROJECTS_FILE}.corrupt-${Date.now()}`;
      fs.copyFileSync(PROJECTS_FILE, backup);
    } catch {
      // Ignore backup errors
    }
    return {
      activeProject: 'demo',
      projects: discovered,
      groupBindings: {},
      conversations: {},
      pendingEmailDrafts: {},
      autoPush: {},
      disabledGroups: {},
      deploymentUrls: {},
      pendingProjectConfirmations: {},
    };
  }
}

/**
 * Atomically writes JSON state (tmp file + rename) so a crash mid-write
 * can never leave a half-written projects.json behind.
 */
export function atomicWriteJson(filePath, value) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf8');
  try {
    fs.chmodSync(tmpPath, 0o600);
  } catch {
    // Ignore chmod errors (e.g. non-POSIX filesystems)
  }
  fs.renameSync(tmpPath, filePath);
}

export function saveProjectsState(state) {
  atomicWriteJson(PROJECTS_FILE, state);
}

// Speech-to-text phonetic dictionary to handle voice-note transcription mishearings
// (e.g. "voice wallets" -> "wisewallets", "october festival" -> "rocktoberfest")
export const PROJECT_PHONETIC_PATTERNS = {
  wisewallets: [
    'wisewallets',
    'wisewallet',
    'voicewallets',
    'voicewallet',
    'vicewallet',
    'vicewallets',
    'weisswallet',
    'weisswallets',
    'wise wallets',
    'wise wallet',
    'voice wallets',
    'voice wallet',
    'vice wallets',
    'vice wallet',
    'wallet',
    'wallets',
  ],
  rocktoberfest: [
    'rocktoberfest',
    'rocktober fest',
    'rock tober fest',
    'octoberfest',
    'october fest',
    'october festival',
    'octoberfestival',
    'rock october fest',
    'rock october',
  ],
  gi_heritage_hub: [
    'heritage hub',
    'heritagehub',
    'gi heritage',
    'gi heritage hub',
    'heritage',
  ],
  theknowledgecorps: [
    'theknowledgecorps',
    'the knowledge corps',
    'knowledge corps',
    'knowledge corp',
    'knowledgecorps',
  ],
  tkc: ['tkc', 't k c'],
  tkctrial: ['tkctrial', 'tkc trial'],
  personalisedmemory: [
    'personalised memory',
    'personalized memory',
    'personalisedmemory',
    'personalizedmemory',
  ],
  'stock-market': ['stock market', 'stockmarket', 'stocks'],
  latticemvp: ['lattice mvp', 'latticemvp'],
  lattice: ['lattice'],
  ascendant: ['ascendant', 'ascendance', 'ascend'],
  'agent-economics': ['agent economics', 'agenteconomics', 'economics'],
  acrest: ['acrest', 'ac rest'],
};

/**
 * Resolves the project for a specific WhatsApp chat/group JID.
 *
 * SECURITY & ISOLATION RULES:
 * - If the message comes from a WhatsApp Group (@g.us):
 *   1. The group MUST be bound to a specific project in `state.groupBindings[jid]`.
 *   2. Group members are strictly locked to that group's bound project and CANNOT switch or access any other project!
 * - If used from CLI test (no jid) or Owner private chat:
 *   Can target any project via [alias] or activeProject.
 */
export function resolveProjectAndTask(rawTaskText, jid = null) {
  const state = loadProjectsState();
  const taskPrompt = rawTaskText.trim();
  const isGroup = jid && jid.endsWith('@g.us');

  if (isGroup) {
    const boundAlias = state.groupBindings[jid];
    if (!boundAlias || !state.projects[boundAlias]) {
      const err = new Error(
        `🔒 This WhatsApp group is not linked to a project yet.\nAsk the owner to link it using: *${CONFIG.triggerPrefix} /bind <project-name>*`
      );
      err.code = 'UNBOUND_GROUP';
      throw err;
    }

    // Strip a leading "[alias]" if present so it isn't passed literally to the agent.
    // Non-owners are locked to the bound project; owners may target another project
    // from a group via [alias] (falls through to the alias lookup below).
    let groupPrompt = taskPrompt;
    const groupBracket = groupPrompt.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
    if (groupBracket) {
      const requested = groupBracket[1].trim().toLowerCase();
      const rest = (groupBracket[2] || '').trim();
      if (requested === boundAlias.toLowerCase()) {
        groupPrompt = rest || groupPrompt;
      } else if (state.projects[requested]) {
        const err = new Error(
          `🔒 This group is locked to \`${boundAlias}\`. You cannot access \`[${requested}]\` from here.`
        );
        err.code = 'GROUP_LOCKED';
        throw err;
      } else {
        throw new Error(`Unknown project alias: "[${requested}]".`);
      }
      if (!groupPrompt || groupPrompt === taskPrompt && !rest) {
        throw new Error('Please provide a task after the project alias.');
      }
    }

    return {
      projectAlias: boundAlias,
      projectDir: state.projects[boundAlias],
      taskPrompt: groupPrompt,
    };
  }

  // Non-group (Owner private chat or local CLI test): allow [alias] or activeProject
  let projectAlias = state.activeProject;
  let cleanedPrompt = taskPrompt;

  // Case-insensitive alias lookup
  const lowerProjects = {};
  for (const key of Object.keys(state.projects)) {
    lowerProjects[key.toLowerCase()] = key;
  }

  const bracketMatch = cleanedPrompt.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
  if (bracketMatch) {
    const requested = bracketMatch[1].trim().toLowerCase();
    cleanedPrompt = (bracketMatch[2] || '').trim();

    const canonical = lowerProjects[requested];
    if (canonical) {
      if (!cleanedPrompt) {
        throw new Error('Please provide a task after the project alias.');
      }
      return {
        projectAlias: canonical,
        projectDir: state.projects[canonical],
        taskPrompt: cleanedPrompt,
      };
    }

    throw new Error(`Unknown project alias: "[${requested}]".`);
  }

  // Auto-detect project mention in natural language or voice notes
  // Sort keys by descending length so longer, specific projects match first
  const projectEntries = Object.entries(state.projects).sort((a, b) => b[0].length - a[0].length);
  const normalizedTaskPrompt = cleanedPrompt.toLowerCase().replace(/[^a-z0-9]/g, '');

  let detectedAlias = null;
  let matchedPattern = null;
  let matchType = null;

  // 1. Check speech-to-text phonetic patterns
  for (const [alias, patterns] of Object.entries(PROJECT_PHONETIC_PATTERNS)) {
    if (!state.projects[alias]) continue;
    for (const pat of patterns) {
      const patClean = pat.toLowerCase().replace(/[^a-z0-9]/g, '');
      const regexWord = new RegExp(`\\b${pat.replace(/[-_ ]/g, '[ _-]?')}\\b`, 'i');
      if (regexWord.test(cleanedPrompt) || (patClean.length >= 4 && normalizedTaskPrompt.includes(patClean))) {
        detectedAlias = alias;
        matchedPattern = pat;
        // If the exact alias word wasn't explicitly used, it's a phonetic match
        const exactWordRegex = new RegExp(`\\b${alias.replace(/[-_]/g, '[ _-]?')}\\b`, 'i');
        matchType = exactWordRegex.test(cleanedPrompt) ? 'exact' : 'phonetic';
        break;
      }
    }
    if (detectedAlias) break;
  }

  // 2. If no phonetic pattern matched, check exact alias and directory name
  if (!detectedAlias) {
    for (const [alias, dir] of projectEntries) {
      const aliasClean = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
      const dirBasenameClean = path.basename(dir).toLowerCase().replace(/[^a-z0-9]/g, '');

      const regexWord = new RegExp(`\\b${alias.replace(/[-_]/g, '[ _-]?')}\\b`, 'i');
      const matchesWord = regexWord.test(cleanedPrompt);
      const matchesNormalized =
        (aliasClean.length >= 4 && normalizedTaskPrompt.includes(aliasClean)) ||
        (dirBasenameClean.length >= 4 && normalizedTaskPrompt.includes(dirBasenameClean));

      if (matchesWord || matchesNormalized) {
        detectedAlias = alias;
        matchedPattern = alias;
        matchType = 'exact';
        break;
      }
    }
  }

  // If a project alias was detected (exact or phonetic), switch activeProject
  if (detectedAlias) {
    projectAlias = detectedAlias;
    if (state.activeProject !== detectedAlias && matchType === 'exact') {
      state.activeProject = detectedAlias;
      try {
        saveProjectsState(state);
        console.log(`🔄 Switched active project to "${detectedAlias}" based on exact mention.`);
      } catch (err) {
        console.warn(`Failed to persist activeProject switch: ${err.message}`);
      }
    }
  }

  return {
    projectAlias: detectedAlias || projectAlias,
    projectDir: state.projects[detectedAlias || projectAlias] || CONFIG.defaultProjectDir,
    taskPrompt: cleanedPrompt,
    suggestedProject: detectedAlias || null,
    matchedPattern: matchedPattern || null,
  };
}
