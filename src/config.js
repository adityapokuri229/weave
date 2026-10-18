import dotenv from 'dotenv';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

export const configEvents = new EventEmitter();

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
  const isPackagedOrTemp =
    ROOT_DIR.includes('app.asar') ||
    ROOT_DIR.includes(os.tmpdir()) ||
    ROOT_DIR.includes('\\AppData\\Local\\Temp\\') ||
    ROOT_DIR.includes('/tmp/');
  if (!isPackagedOrTemp) {
    try {
      const testFile = path.join(ROOT_DIR, `.write_test_${process.pid}`);
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      return ROOT_DIR;
    } catch {}
  }
  const userDir = path.join(os.homedir(), '.weave');
  try {
    fs.mkdirSync(userDir, { recursive: true });
  } catch {}
  return userDir;
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
  'AppData',
]);

function parsePositiveInt(raw, fallback) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Resolves the default project workspace directory and ensures it exists on disk.
 * Never returns a path inside an Electron `app.asar` archive.
 */
function resolveDefaultProjectDir() {
  const raw = (process.env.DEFAULT_PROJECT_DIR || './demo-site').trim();
  const baseDir = ROOT_DIR.includes('app.asar') || DATA_DIR !== ROOT_DIR ? DATA_DIR : ROOT_DIR;
  let resolved = path.resolve(baseDir, raw);
  if (resolved.includes('app.asar')) {
    resolved = path.join(DATA_DIR, 'demo-site');
  }
  try {
    fs.mkdirSync(resolved, { recursive: true });
    const indexPath = path.join(resolved, 'index.html');
    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(
        indexPath,
        '<!DOCTYPE html>\n<html><head><meta charset="utf-8"/><title>Weave Workspace</title></head><body><h1>Weave Default Workspace</h1></body></html>\n',
        'utf8'
      );
    }
  } catch {}
  return resolved;
}

/**
 * Resolves the Antigravity CLI binary across Linux, macOS, and Windows.
 */
export function resolveAgyBinary() {
  const custom = (process.env.AGY_BIN || '').trim();
  if (custom && custom !== 'agy' && fs.existsSync(custom)) {
    return custom;
  }
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');

  const candidates =
    process.platform === 'win32'
      ? [
          path.join(home, '.local', 'bin', 'agy.exe'),
          path.join(home, '.local', 'bin', 'agy.cmd'),
          path.join(home, '.gemini', 'antigravity', 'bin', 'agy.exe'),
          path.join(home, '.gemini', 'antigravity', 'bin', 'agy.cmd'),
          path.join(home, '.gemini', 'antigravity-cli', 'bin', 'agy.exe'),
          path.join(localAppData, 'Programs', 'Antigravity', 'bin', 'agy.exe'),
          path.join(localAppData, 'Programs', 'Antigravity', 'bin', 'agy.cmd'),
          path.join(localAppData, 'Antigravity', 'bin', 'agy.exe'),
          path.join(localAppData, 'Antigravity', 'bin', 'agy.cmd'),
          path.join(appData, 'npm', 'agy.cmd'),
        ]
      : [
          path.join(home, '.local', 'bin', 'agy'),
          path.join(home, '.gemini', 'antigravity', 'bin', 'agy'),
          path.join(home, '.gemini', 'antigravity-cli', 'bin', 'agy'),
          '/usr/local/bin/agy',
          '/opt/homebrew/bin/agy',
          '/Applications/Antigravity.app/Contents/Resources/app/bin/agy',
        ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {}
  }
  return custom || 'agy';
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
  agyBin: resolveAgyBinary(),

  // Optional model override (e.g., gemini-3.8-flash-high, gemini-3.1-pro-high)
  agyModel: process.env.AGY_MODEL || '',

  // Timeout per task in milliseconds (default: 10 minutes; falls back on NaN/<=0)
  taskTimeoutMs: parsePositiveInt(process.env.TASK_TIMEOUT_MS, 600000),

  // Default target directory for coding tasks (used for local CLI tests / owner DM)
  defaultProjectDir: resolveDefaultProjectDir(),

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
 * Automatically scans the user's Master Directory (if set) for project folders.
 * Projects are strictly the folders inside the master directory.
 */
export function discoverLocalProjects(customMasterDir = null) {
  const discovered = {};

  if (!customMasterDir || typeof customMasterDir !== 'string') {
    return discovered;
  }

  const resolvedMaster = customMasterDir.startsWith('~')
    ? path.join(os.homedir(), customMasterDir.slice(1))
    : path.resolve(customMasterDir);

  if (!fs.existsSync(resolvedMaster)) return discovered;

  try {
    const entries = fs.readdirSync(resolvedMaster, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(resolvedMaster, entry.name);
      const alias = entry.name.toLowerCase();
      if (!discovered[alias]) {
        discovered[alias] = fullPath;
      }
    }
  } catch {
    // Ignore permission errors
  }

  return discovered;
}

/**
 * Load or initialize projects.json, strictly reflecting folders inside masterDir.
 */
export function loadProjectsState() {
  let existingMasterDir = null;
  if (fs.existsSync(PROJECTS_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
      if (existing.masterDir) existingMasterDir = existing.masterDir;
    } catch {}
  }

  const discovered = discoverLocalProjects(existingMasterDir);

  if (!fs.existsSync(PROJECTS_FILE)) {
    const firstAlias = Object.keys(discovered)[0] || '';
    const initial = {
      masterDir: existingMasterDir || '',
      activeProject: firstAlias,
      projects: discovered,
      initializedGroups: {},
      groupBindings: {},
      pendingPolls: {},
      conversations: {},
      autopilot: true,
      friends: [],
      projectAccess: {},
      groupNames: {},
    };
    atomicWriteJson(PROJECTS_FILE, initial);
    return initial;
  }
  try {
    const saved = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
    // Projects are strictly folders in master directory
    saved.projects = discovered;
    saved.masterDir = typeof saved.masterDir === 'string' ? saved.masterDir : '';
    saved.initializedGroups = saved.initializedGroups || {};
    saved.groupBindings = saved.groupBindings || {};
    saved.pendingPolls = saved.pendingPolls || {};
    saved.conversations = saved.conversations || {};
    saved.autopilot = saved.autopilot ?? true;
    saved.friends = Array.isArray(saved.friends) ? saved.friends : [];
    saved.projectAccess = saved.projectAccess || {};
    saved.groupNames = saved.groupNames || {};
    
    // Validate activeProject still exists; fall back to first available project
    const availableAliases = Object.keys(saved.projects);
    if (!saved.projects[saved.activeProject]) {
      saved.activeProject = availableAliases[0] || '';
    }
    return saved;
  } catch {
    return {
      masterDir: existingMasterDir || '',
      activeProject: '',
      projects: discovered,
      initializedGroups: {},
      groupBindings: {},
      pendingPolls: {},
      conversations: {},
      autopilot: true,
      friends: [],
      projectAccess: {},
      groupNames: {},
    };
  }
}

/**
 * Checks whether a target file/folder path strictly resides within the configured Master Directory.
 */
export function isPathWithinMasterDir(targetPath, masterDir) {
  if (!masterDir || !targetPath) return false;
  try {
    const resolvedMaster = path.resolve(masterDir);
    const resolvedTarget = path.resolve(targetPath);
    return resolvedTarget.startsWith(resolvedMaster + path.sep) || resolvedTarget === resolvedMaster;
  } catch {
    return false;
  }
}

/**
 * Gets all registered friends (Name -> GitHub username mapping).
 */
export function getFriends() {
  const state = loadProjectsState();
  return Array.isArray(state.friends) ? state.friends : [];
}

/**
 * Adds or updates a friend in the directory.
 */
export function addFriend(name, github) {
  if (!name || !github) throw new Error('Name and GitHub username are required');
  const state = loadProjectsState();
  state.friends = Array.isArray(state.friends) ? state.friends : [];
  const normalizedGithub = String(github).replace(/^@/, '').replace(/^https?:\/\/github\.com\//, '').trim();
  const trimmedName = String(name).trim();
  const existingIdx = state.friends.findIndex(f => f.name.toLowerCase() === trimmedName.toLowerCase());
  const friendObj = {
    id: existingIdx >= 0 ? state.friends[existingIdx].id : `friend_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: trimmedName,
    github: normalizedGithub,
    updatedAt: Date.now()
  };
  if (existingIdx >= 0) {
    state.friends[existingIdx] = friendObj;
  } else {
    state.friends.push(friendObj);
  }
  saveProjectsState(state);
  return friendObj;
}

/**
 * Removes a friend by id, name, or github username.
 */
export function removeFriend(nameOrId) {
  if (!nameOrId) return false;
  const state = loadProjectsState();
  state.friends = Array.isArray(state.friends) ? state.friends : [];
  const target = String(nameOrId).trim().toLowerCase();
  const initialLen = state.friends.length;
  state.friends = state.friends.filter(f => f.id !== nameOrId && f.name.toLowerCase() !== target && f.github.toLowerCase() !== target);
  if (state.friends.length !== initialLen) {
    saveProjectsState(state);
    return true;
  }
  return false;
}

/**
 * Access Control for Projects per Group:
 * Maintains which users (by phone number, name, or pushName) are granted access to interact
 * with a project in a WhatsApp group.
 */
export function getProjectAccess(projectAlias, groupJid) {
  if (!projectAlias || !groupJid) return [];
  const state = loadProjectsState();
  const alias = projectAlias.toLowerCase();
  const group = groupJid.toLowerCase();
  return state.projectAccess?.[group]?.[alias] || [];
}

export function grantProjectAccess(projectAlias, groupJid, userIdentifier) {
  if (!projectAlias || !groupJid || !userIdentifier) return false;
  const state = loadProjectsState();
  const alias = projectAlias.toLowerCase();
  const group = groupJid.toLowerCase();
  state.projectAccess = state.projectAccess || {};
  state.projectAccess[group] = state.projectAccess[group] || {};
  state.projectAccess[group][alias] = state.projectAccess[group][alias] || [];

  const cleanUser = String(userIdentifier).trim();
  const existing = state.projectAccess[group][alias].find(
    u => u.toLowerCase() === cleanUser.toLowerCase()
  );
  if (!existing) {
    state.projectAccess[group][alias].push(cleanUser);
    saveProjectsState(state);
    return true;
  }
  return false;
}

export function revokeProjectAccess(projectAlias, groupJid, userIdentifier) {
  if (!groupJid || !userIdentifier) return false;
  const state = loadProjectsState();
  const group = groupJid.toLowerCase();
  if (!state.projectAccess?.[group]) return false;

  const rawClean = String(userIdentifier).replace(/^@/, '').trim().toLowerCase();
  if (!rawClean) return false;

  // Also check if this identifier corresponds to a registered friend
  const friends = Array.isArray(state.friends) ? state.friends : [];
  const matchedFriend = friends.find(
    f => f.name.toLowerCase() === rawClean || f.github.toLowerCase() === rawClean
  );
  const friendName = matchedFriend ? matchedFriend.name.toLowerCase() : null;
  const friendGithub = matchedFriend ? matchedFriend.github.toLowerCase() : null;

  function matchesUser(u) {
    const uLow = String(u).trim().toLowerCase();
    if (uLow === rawClean) return true;
    if (friendName && uLow === friendName) return true;
    if (friendGithub && uLow === friendGithub) return true;
    // Handle cases where "permission" or "access" got accidentally saved into the name
    if (uLow.startsWith(rawClean) || rawClean.startsWith(uLow)) return true;
    return false;
  }

  let anyRemoved = false;
  const alias = projectAlias ? projectAlias.toLowerCase() : null;

  // If alias provided and exists in group
  if (alias && state.projectAccess[group][alias]) {
    const initialLen = state.projectAccess[group][alias].length;
    state.projectAccess[group][alias] = state.projectAccess[group][alias].filter(u => !matchesUser(u));
    if (state.projectAccess[group][alias].length !== initialLen) {
      anyRemoved = true;
    }
  } else {
    // If alias not specified or not in group, sweep all projects in this group
    for (const p of Object.keys(state.projectAccess[group])) {
      const initialLen = state.projectAccess[group][p].length;
      state.projectAccess[group][p] = state.projectAccess[group][p].filter(u => !matchesUser(u));
      if (state.projectAccess[group][p].length !== initialLen) {
        anyRemoved = true;
      }
    }
  }

  if (anyRemoved) {
    saveProjectsState(state);
    return true;
  }
  return false;
}

/**
 * Saves/caches group display names in projects state so UI and bot can render real names.
 */
export function setGroupName(groupJid, groupName) {
  if (!groupJid || !groupName) return;
  const state = loadProjectsState();
  state.groupNames = state.groupNames || {};
  if (state.groupNames[groupJid] !== groupName) {
    state.groupNames[groupJid] = groupName;
    saveProjectsState(state);
  }
}

export function getGroupName(groupJid) {
  if (!groupJid) return '';
  const state = loadProjectsState();
  return state.groupNames?.[groupJid] || '';
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
  try {
    configEvents.emit('projects-updated', state);
  } catch {}
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

/**
 * Binds a group to a project (strictly one active project per group at a time).
 * Overwrites any previously active project for this group.
 */
export function bindGroupToProject(groupJid, projectAlias) {
  const state = loadProjectsState();
  const cleanAlias = (projectAlias || '').trim().toLowerCase();
  const matchedAlias = Object.keys(state.projects || {}).find(
    (k) => k.toLowerCase() === cleanAlias
  );
  if (!matchedAlias) {
    throw new Error(`Project alias "${projectAlias}" does not exist.`);
  }

  const prevAlias = state.groupBindings?.[groupJid] || null;
  state.groupBindings = state.groupBindings || {};
  state.groupBindings[groupJid] = matchedAlias;
  if (state.disabledGroups?.[groupJid]) {
    delete state.disabledGroups[groupJid];
  }
  saveProjectsState(state);
  return { prevAlias, newAlias: matchedAlias, state };
}

/**
 * Unbinds / turns OFF the active project for a group.
 */
export function unbindGroupProject(groupJid) {
  const state = loadProjectsState();
  const prevAlias = state.groupBindings?.[groupJid] || null;
  if (state.groupBindings?.[groupJid]) {
    delete state.groupBindings[groupJid];
    saveProjectsState(state);
  }
  return { prevAlias, state };
}

/**
 * Returns the currently active project alias for a given JID or global active project.
 */
export function getActiveProjectForJid(jid = null) {
  const state = loadProjectsState();
  if (jid && jid.endsWith('@g.us')) {
    return state.groupBindings?.[jid] || null;
  }
  return state.activeProject || '';
}

/**
 * Checks if a WhatsApp group is initialized.
 * Silent gate: agent must never interact unless initialized.
 */
export function isGroupInitialized(groupJid) {
  if (!groupJid) return false;
  const state = loadProjectsState();
  return Boolean(state.initializedGroups?.[groupJid]);
}

/**
 * Marks a WhatsApp group as initialized.
 */
export function markGroupInitialized(groupJid, userJid = null) {
  if (!groupJid) return null;
  const state = loadProjectsState();
  state.initializedGroups = state.initializedGroups || {};
  state.initializedGroups[groupJid] = {
    initializedAt: Date.now(),
    initializedBy: userJid || 'unknown',
  };
  saveProjectsState(state);
  return state.initializedGroups[groupJid];
}

/**
 * Deinitializes a WhatsApp group, placing it back behind the silent gate.
 */
export function markGroupDeinitialized(groupJid) {
  if (!groupJid) return false;
  const state = loadProjectsState();
  if (state.initializedGroups?.[groupJid]) {
    delete state.initializedGroups[groupJid];
    saveProjectsState(state);
    return true;
  }
  return false;
}

/**
 * Gets the active project for a specific group.
 */
export function getGroupActiveProject(groupJid) {
  if (!groupJid) return null;
  const state = loadProjectsState();
  return state.groupBindings?.[groupJid] || (!groupJid.endsWith('@g.us') ? state.activeProject : null) || null;
}

/**
 * Sets the active project for a specific group (1 project per group).
 */
export function setGroupActiveProject(groupJid, projectAlias) {
  if (!groupJid || !projectAlias) return null;
  return bindGroupToProject(groupJid, projectAlias);
}

/**
 * Returns all initialized groups with their active project.
 */
export function getAllInitializedGroups() {
  const state = loadProjectsState();
  const list = [];
  for (const [jid, info] of Object.entries(state.initializedGroups || {})) {
    list.push({
      jid,
      activeProject: state.groupBindings?.[jid] || null,
      initializedAt: info.initializedAt,
      initializedBy: info.initializedBy,
    });
  }
  return list;
}

/**
 * Saves a pending WhatsApp poll or reaction prompt to state.
 */
export function savePendingPoll(pollMsgId, pollData) {
  if (!pollMsgId || !pollData) return;
  const state = loadProjectsState();
  state.pendingPolls = state.pendingPolls || {};
  state.pendingPolls[pollMsgId] = {
    ...pollData,
    createdAt: Date.now(),
  };
  saveProjectsState(state);
}

/**
 * Retrieves a pending poll by message ID.
 */
export function getPendingPoll(pollMsgId) {
  if (!pollMsgId) return null;
  const state = loadProjectsState();
  return state.pendingPolls?.[pollMsgId] || null;
}

/**
 * Deletes a pending poll after voting or expiration.
 */
export function deletePendingPoll(pollMsgId) {
  if (!pollMsgId) return;
  const state = loadProjectsState();
  if (state.pendingPolls?.[pollMsgId]) {
    delete state.pendingPolls[pollMsgId];
    saveProjectsState(state);
  }
}

const messageMemoryStore = new Map();

/**
 * Stores raw Baileys messages in an LRU memory cache for retries and poll vote decryption.
 */
export function recordRawMessage(id, msg) {
  if (!id || !msg) return;
  messageMemoryStore.set(id, msg);
  if (messageMemoryStore.size > 2000) {
    const oldestKey = messageMemoryStore.keys().next().value;
    messageMemoryStore.delete(oldestKey);
  }
}

/**
 * Retrieves raw Baileys message by ID from the LRU memory cache.
 */
export function getRawMessage(id) {
  if (!id) return undefined;
  return messageMemoryStore.get(id) || undefined;
}


/**
 * Completely resets state (wiping bindings, initialized groups, polls, and caches).
 * Optionally preserves the masterDir path so user doesn't have to re-select it.
 */
export function resetAllState({ preserveMasterDir = true } = {}) {
  const currentState = loadProjectsState();
  const masterDir = preserveMasterDir ? (currentState.masterDir || '') : '';
  const discovered = discoverLocalProjects(masterDir);
  const firstAlias = Object.keys(discovered)[0] || '';

  const newState = {
    masterDir,
    activeProject: firstAlias,
    projects: discovered,
    initializedGroups: {},
    groupBindings: {},
    pendingPolls: {},
    conversations: {},
    autopilot: true,
    friends: [],
  };

  saveProjectsState(newState);

  // Clear tracking files in DATA_DIR
  const processedMsgsPath = path.join(DATA_DIR, '.processed-msgs.json');
  const sentMsgsPath = path.join(DATA_DIR, '.sent-msgs.json');
  try {
    if (fs.existsSync(processedMsgsPath)) fs.unlinkSync(processedMsgsPath);
  } catch {}
  try {
    if (fs.existsSync(sentMsgsPath)) fs.unlinkSync(sentMsgsPath);
  } catch {}

  return newState;
}


