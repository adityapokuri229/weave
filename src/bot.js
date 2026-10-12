import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadContentFromMessage,
  generateWAMessageFromContent,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import QRCodeImage from 'qrcode';
import nodemailer from 'nodemailer';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  CONFIG,
  ROOT_DIR,
  loadProjectsState,
  saveProjectsState,
  resolveProjectAndTask,
  PROJECT_PHONETIC_PATTERNS,
} from './config.js';
import { transcribeAudioFile } from './transcribe.js';
import { buildGoogleCalendarUrl, createIcsFile, sendCalendarInviteDirectly } from './calendar.js';
import { captureWebScreenshot, getProjectDeploymentUrl } from './qa.js';
import {
  runAntigravityTask,
  getActiveTaskInfo,
  stopActiveTask,
  gitCommitAndPush,
  addGitHubCollaborator,
  removeGitHubCollaborator,
  listGitHubCollaborators,
} from './agent.js';

const AUTH_DIR = path.join(ROOT_DIR, 'auth_info_baileys');
const CONTACTS_FILE = path.join(ROOT_DIR, 'contacts.json');
const PROCESSED_MSGS_FILE = path.join(ROOT_DIR, '.processed-msgs.json');
const SENT_MSGS_FILE = path.join(ROOT_DIR, '.sent-msgs.json');

function readIdArrayFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function atomicWriteJsonFile(filePath, value) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(value), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function safeStatIsFile(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

const sentMessageIds = new Set(readIdArrayFile(SENT_MSGS_FILE));
const processedMessageIds = new Set(readIdArrayFile(PROCESSED_MSGS_FILE));
const activeLiveLocations = new Map();
const taskQueue = [];
let isProcessingQueue = false;
let currentRunningItem = null;

function trimIdSet(set, max = 500) {
  while (set.size > max) {
    const first = set.values().next().value;
    set.delete(first);
  }
}

function recordSentMessageId(id) {
  if (!id) return;
  sentMessageIds.add(id);
  trimIdSet(sentMessageIds, 500);
  try {
    atomicWriteJsonFile(SENT_MSGS_FILE, Array.from(sentMessageIds).slice(-500));
  } catch {
    // Ignore write errors
  }
}

function recordProcessedMessageId(id) {
  if (!id) return;
  processedMessageIds.add(id);
  trimIdSet(processedMessageIds, 300);
  const arr = Array.from(processedMessageIds).slice(-300);
  try {
    atomicWriteJsonFile(PROCESSED_MSGS_FILE, arr);
  } catch {
    // Ignore write errors
  }
}

function loadContactsMap() {
  if (!fs.existsSync(CONTACTS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveContactsList(contacts) {
  if (!contacts) return;
  const list = Array.isArray(contacts) ? contacts : Object.values(contacts);
  const map = loadContactsMap();
  let updated = false;
  for (const c of list) {
    const id = c?.id || c?.jid;
    const lid = c?.lid;
    const name = c?.name || c?.notify || c?.verifiedName || c?.subject;
    if (id && name && map[id] !== name) {
      map[id] = name;
      updated = true;
    }
    if (lid && name && map[lid] !== name) {
      map[lid] = name;
      updated = true;
    }
  }
  if (updated) {
    try {
      atomicWriteJsonFile(CONTACTS_FILE, map);
    } catch {
      // Ignore write errors
    }
  }
}

/**
 * Unwraps ephemeral/disappearing wrappers from a Baileys message.
 */
function unwrapMessage(msg) {
  let m = msg.message;
  if (!m) return null;
  if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
  if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
  if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
  if (m.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;
  return m;
}

/**
 * Extracts a documentMessage either directly attached to the message OR from a quoted/replied-to message.
 */
function extractDocumentMessage(msg) {
  const m = unwrapMessage(msg);
  if (!m) return null;

  if (m.documentMessage) return m.documentMessage;

  const quoted =
    m.extendedTextMessage?.contextInfo?.quotedMessage ||
    m.imageMessage?.contextInfo?.quotedMessage ||
    m.videoMessage?.contextInfo?.quotedMessage ||
    m.documentMessage?.contextInfo?.quotedMessage;

  if (!quoted) return null;
  if (quoted.documentMessage) return quoted.documentMessage;
  if (quoted.documentWithCaptionMessage?.message?.documentMessage) {
    return quoted.documentWithCaptionMessage.message.documentMessage;
  }
  if (quoted.ephemeralMessage?.message?.documentMessage) {
    return quoted.ephemeralMessage.message.documentMessage;
  }
  return null;
}

/**
 * Extracts an imageMessage either directly attached to the message OR from a quoted/replied-to message.
 */
function extractImageMessage(msg) {
  const m = unwrapMessage(msg);
  if (!m) return null;

  if (m.imageMessage) return m.imageMessage;

  const quoted =
    m.extendedTextMessage?.contextInfo?.quotedMessage ||
    m.imageMessage?.contextInfo?.quotedMessage ||
    m.videoMessage?.contextInfo?.quotedMessage ||
    m.documentMessage?.contextInfo?.quotedMessage;

  if (!quoted) return null;
  if (quoted.imageMessage) return quoted.imageMessage;
  if (quoted.ephemeralMessage?.message?.imageMessage) {
    return quoted.ephemeralMessage.message.imageMessage;
  }
  if (quoted.viewOnceMessage?.message?.imageMessage) {
    return quoted.viewOnceMessage.message.imageMessage;
  }
  if (quoted.viewOnceMessageV2?.message?.imageMessage) {
    return quoted.viewOnceMessageV2.message.imageMessage;
  }
  return null;
}

/**
 * Extracts a videoMessage either directly attached to the message OR from a quoted/replied-to message.
 */
function extractVideoMessage(msg) {
  const m = unwrapMessage(msg);
  if (!m) return null;

  if (m.videoMessage) return m.videoMessage;

  const quoted =
    m.extendedTextMessage?.contextInfo?.quotedMessage ||
    m.imageMessage?.contextInfo?.quotedMessage ||
    m.videoMessage?.contextInfo?.quotedMessage ||
    m.documentMessage?.contextInfo?.quotedMessage;

  if (!quoted) return null;
  if (quoted.videoMessage) return quoted.videoMessage;
  if (quoted.ephemeralMessage?.message?.videoMessage) {
    return quoted.ephemeralMessage.message.videoMessage;
  }
  return null;
}

/**
 * Extracts an audioMessage (voice note or audio file) either directly attached
 * to the message OR from a quoted/replied-to message.
 */
function extractAudioMessage(msg) {
  const m = unwrapMessage(msg);
  if (!m) return null;

  if (m.audioMessage) return m.audioMessage;

  const quoted =
    m.extendedTextMessage?.contextInfo?.quotedMessage ||
    m.imageMessage?.contextInfo?.quotedMessage ||
    m.videoMessage?.contextInfo?.quotedMessage ||
    m.documentMessage?.contextInfo?.quotedMessage ||
    m.audioMessage?.contextInfo?.quotedMessage;

  if (!quoted) return null;
  if (quoted.audioMessage) return quoted.audioMessage;
  if (quoted.ephemeralMessage?.message?.audioMessage) {
    return quoted.ephemeralMessage.message.audioMessage;
  }
  if (quoted.viewOnceMessage?.message?.audioMessage) {
    return quoted.viewOnceMessage.message.audioMessage;
  }
  if (quoted.viewOnceMessageV2?.message?.audioMessage) {
    return quoted.viewOnceMessageV2.message.audioMessage;
  }
  return null;
}

function sanitizeUploadFileName(name, fallback) {
  const sanitized = String(name || fallback || `file-${Date.now()}`).replace(
    /[^a-zA-Z0-9._ -]/g,
    '_'
  );
  // Prevent directory traversal / dot-only names ("..", ".", "...").
  if (!sanitized || sanitized === '.' || sanitized === '..' || /^\.+$/.test(sanitized)) {
    return fallback || `file-${Date.now()}`;
  }
  return sanitized.slice(0, 200) || fallback || `file-${Date.now()}`;
}

/**
 * Ensures `.whatsapp-uploads/` is listed in `<projectDir>/.git/info/exclude`
 * so temporary WhatsApp attachments never pollute `git status` or commits.
 */
function ensureGitExcludeUploads(projectDir) {
  try {
    const excludeFile = path.join(projectDir, '.git', 'info', 'exclude');
    if (fs.existsSync(excludeFile)) {
      const content = fs.readFileSync(excludeFile, 'utf8');
      if (!content.includes('.whatsapp-uploads')) {
        fs.appendFileSync(excludeFile, '\n.whatsapp-uploads/\n', 'utf8');
      }
    }
  } catch {
    // Ignore if not a git repo
  }
}

/**
 * Downloads an attached or quoted WhatsApp document, image, or video into `<projectDir>/.whatsapp-uploads/`.
 * Returns `{ filePath, fileName, type: 'document' | 'image' | 'video' }` or `null`.
 */
async function downloadWhatsAppAttachment(msg, projectDir) {
  const docMsg = extractDocumentMessage(msg);
  if (docMsg) {
    try {
      const stream = await downloadContentFromMessage(docMsg, 'document');
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      const uploadDir = path.join(projectDir, '.whatsapp-uploads');
      fs.mkdirSync(uploadDir, { recursive: true });
      ensureGitExcludeUploads(projectDir);

      const origName = sanitizeUploadFileName(docMsg.fileName, `document-${Date.now()}`);
      const filePath = path.join(uploadDir, origName);
      fs.writeFileSync(filePath, buffer);
      return { filePath, fileName: origName, type: 'document' };
    } catch (err) {
      console.error('⚠️ Failed to download WhatsApp document:', err?.message || err);
    }
  }

  const imageMsg = extractImageMessage(msg);
  if (imageMsg) {
    try {
      const stream = await downloadContentFromMessage(imageMsg, 'image');
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      const mime = imageMsg.mimetype || 'image/jpeg';
      let ext = '.jpg';
      if (mime.includes('png')) ext = '.png';
      else if (mime.includes('webp')) ext = '.webp';
      else if (mime.includes('gif')) ext = '.gif';

      const uploadDir = path.join(projectDir, '.whatsapp-uploads');
      fs.mkdirSync(uploadDir, { recursive: true });
      ensureGitExcludeUploads(projectDir);

      const fileName = `whatsapp-image-${Date.now()}${ext}`;
      const filePath = path.join(uploadDir, fileName);
      fs.writeFileSync(filePath, buffer);
      return { filePath, fileName, type: 'image' };
    } catch (err) {
      console.error('⚠️ Failed to download WhatsApp image:', err?.message || err);
      return null;
    }
  }

  const videoMsg = extractVideoMessage(msg);
  if (videoMsg) {
    try {
    const stream = await downloadContentFromMessage(videoMsg, 'video');
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const mime = videoMsg.mimetype || 'video/mp4';
    let ext = '.mp4';
    if (mime.includes('quicktime') || mime.includes('mov')) ext = '.mov';
    else if (mime.includes('webm')) ext = '.webm';

    const uploadDir = path.join(projectDir, '.whatsapp-uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    ensureGitExcludeUploads(projectDir);

      const fileName = `whatsapp-video-${Date.now()}${ext}`;
      const filePath = path.join(uploadDir, fileName);
      fs.writeFileSync(filePath, buffer);
      return { filePath, fileName, type: 'video' };
    } catch (err) {
      console.error('⚠️ Failed to download WhatsApp video:', err?.message || err);
      return null;
    }
  }

  const audioMsg = extractAudioMessage(msg);
  if (!audioMsg) return null;

  try {
    const stream = await downloadContentFromMessage(audioMsg, 'audio');
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const mime = audioMsg.mimetype || 'audio/ogg';
    let ext = '.ogg';
    if (mime.includes('mp4') || mime.includes('m4a')) ext = '.m4a';
    else if (mime.includes('mpeg') || mime.includes('mp3')) ext = '.mp3';
    else if (mime.includes('wav')) ext = '.wav';

    const uploadDir = path.join(projectDir, '.whatsapp-uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    ensureGitExcludeUploads(projectDir);

    const fileName = `whatsapp-audio-${Date.now()}${ext}`;
    const filePath = path.join(uploadDir, fileName);
    fs.writeFileSync(filePath, buffer);
    return { filePath, fileName, type: 'audio' };
  } catch (err) {
    console.error('⚠️ Failed to download WhatsApp audio:', err?.message || err);
    return null;
  }
}

/**
 * Unwraps ephemeral/disappearing wrappers and extracts text from a Baileys message.
 */
function extractMessageText(msg) {
  const m = unwrapMessage(msg);
  if (!m) return '';

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  ).trim();
}

/**
 * In-memory rolling buffer of recent messages per chat (up to 30 messages per JID).
 * Provides rich multi-turn context (meeting agendas, agreed timings, discussion topics).
 */
const chatMessageHistory = new Map();

function recordChatMessage(jid, { sender, text, timestamp, quotedText }) {
  if (!jid || !text) return;
  if (!chatMessageHistory.has(jid)) {
    chatMessageHistory.set(jid, []);
  }
  const history = chatMessageHistory.get(jid);
  const trimmedText = text.trim();
  const isDuplicate = history.length > 0 && history[history.length - 1].text === trimmedText;
  if (isDuplicate) return;

  history.push({
    sender: sender || 'User',
    text: trimmedText,
    timestamp: timestamp || Date.now(),
    quotedText: quotedText ? quotedText.slice(0, 100) : null,
  });
  if (history.length > 30) {
    history.shift();
  }
}

function getRecentChatContext(jid) {
  const history = chatMessageHistory.get(jid) || [];
  if (history.length === 0) return '';
  return history
    .map((m) => {
      const timeStr = new Date(m.timestamp).toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      const quoteStr = m.quotedText ? ` (replying to: "${m.quotedText}")` : '';
      return `[${timeStr}] ${m.sender}${quoteStr}: ${m.text}`;
    })
    .join('\n');
}

/**
 * Extracts the text of the message being replied to (quoted), including nested quotes.
 * If the quoted message itself replied to an agenda or announcement, both are unrolled.
 */
function extractQuotedText(msg) {
  const m = unwrapMessage(msg);
  const contextInfo =
    m?.extendedTextMessage?.contextInfo ||
    m?.imageMessage?.contextInfo ||
    m?.videoMessage?.contextInfo ||
    m?.documentMessage?.contextInfo;
  if (!contextInfo?.quotedMessage) return '';

  const quoteChain = [];

  function unwrapRecursive(quotedObj, depth = 0) {
    if (!quotedObj || depth > 4) return;
    const q =
      quotedObj.ephemeralMessage?.message ||
      quotedObj.viewOnceMessage?.message ||
      quotedObj.viewOnceMessageV2?.message ||
      quotedObj.documentWithCaptionMessage?.message ||
      quotedObj;

    const text = (
      q.conversation ||
      q.extendedTextMessage?.text ||
      q.imageMessage?.caption ||
      q.videoMessage?.caption ||
      q.documentMessage?.caption ||
      ''
    ).trim();

    if (text && !quoteChain.includes(text)) {
      quoteChain.push(text);
    }

    const nestedCtx =
      q.extendedTextMessage?.contextInfo ||
      q.imageMessage?.contextInfo ||
      q.videoMessage?.contextInfo ||
      q.documentMessage?.contextInfo;

    if (nestedCtx?.quotedMessage) {
      unwrapRecursive(nestedCtx.quotedMessage, depth + 1);
    }
  }

  unwrapRecursive(contextInfo.quotedMessage, 0);

  if (quoteChain.length === 0) return '';
  if (quoteChain.length === 1) return quoteChain[0];
  return quoteChain[0] + '\n\n[In reply to referenced meeting/agenda]:\n' + quoteChain.slice(1).join('\n\n');
}

/**
 * Smart date/time parser for CALENDAR_EVENT start times.
 * Handles ISO timestamps, time strings ("7:00 PM", "7 PM", "19:00"), and relative ("today at 7 PM").
 */
function parseCalendarDateTime(rawStr) {
  if (!rawStr) return new Date(Date.now() + 60 * 60 * 1000);
  const trimmed = String(rawStr).trim();

  // 1. Try standard new Date(trimmed)
  let d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    return d;
  }

  // 2. Handle "today at 7 PM", "tomorrow at 3 PM", etc.
  const lower = trimmed.toLowerCase();
  const baseDate = new Date();
  if (lower.includes('tomorrow')) {
    baseDate.setDate(baseDate.getDate() + 1);
  }

  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridian = timeMatch[3] ? timeMatch[3].toLowerCase() : null;

    if (meridian === 'pm' && hours < 12) hours += 12;
    if (meridian === 'am' && hours === 12) hours = 0;
    if (!meridian && hours >= 1 && hours <= 7) {
      hours += 12;
    }

    baseDate.setHours(hours, minutes, 0, 0);
    return baseDate;
  }

  return new Date(Date.now() + 60 * 60 * 1000);
}

/**
 * Extracts the quoted message stanza ID (the message ID being swipe-replied to), if any.
 */
function getQuotedStanzaId(msg) {
  const m = unwrapMessage(msg);
  const contextInfo =
    m?.extendedTextMessage?.contextInfo ||
    m?.imageMessage?.contextInfo ||
    m?.videoMessage?.contextInfo ||
    m?.audioMessage?.contextInfo ||
    m?.documentMessage?.contextInfo;
  return contextInfo?.stanzaId || null;
}

/**
 * Returns true if the text is a short stop/cancel command (e.g. "stop", "/stop", "cancel").
 */
function isStopWord(str) {
  const clean = (str || '').trim().toLowerCase().replace(/^[/@!]+/, '').trim();
  return ['stop', 'stop it', 'abort', 'halt', 'kill'].includes(clean);
}

/**
 * Checks if the user is swipe-replying to a message sent by the bot itself.
 */
function isReplyingToBot(msg) {
  const m = unwrapMessage(msg);
  const contextInfo =
    m?.extendedTextMessage?.contextInfo ||
    m?.imageMessage?.contextInfo ||
    m?.videoMessage?.contextInfo ||
    m?.audioMessage?.contextInfo ||
    m?.documentMessage?.contextInfo;

  const stanzaId = contextInfo?.stanzaId;
  if (stanzaId && sentMessageIds.has(stanzaId)) {
    return true;
  }

  const quotedText = extractQuotedText(msg);
  if (!quotedText) return false;

  const botSignatures = [
    'Changes Completed!',
    'Gemini Agent working',
    'WhatsApp Antigravity Agent',
    'Agent Task Failed',
    'Group Locked to Project',
    'Task Queued',
    'Email Draft (Awaiting Confirmation)',
    'Pushed to GitHub',
    'Auto-Pushed to GitHub',
    'Email Sent Successfully',
    'Live Location Shared',
    'Agent Status:',
  ];
  return botSignatures.some((sig) => quotedText.includes(sig));
}

function matchesCommand(lowerText, cmd) {
  return lowerText === cmd || lowerText.startsWith(cmd + ' ') || lowerText.startsWith(cmd + '\n');
}

/**
 * Checks if the message either:
 * 1) Starts with the text trigger (e.g. "@agent <task>"), OR
 * 2) Swipe-replies to a message from the bot, OR
 * 3) Natively @mentions the bot's WhatsApp account in a group chat (when TRIGGER_ON_MENTION=true)
 * Returns the extracted task body if triggered, or null if not triggered.
 */
function extractTriggeredBody(sock, msg, text) {
  const trimmedText = (text || '').trim();
  const lowerText = trimmedText.toLowerCase();
  const trigger = CONFIG.triggerPrefix;

  // 0. Swipe-replying "stop" to a task message (either the running task, a queued task, or a "@agent ..." message)
  if (isStopWord(lowerText)) {
    const quotedId = getQuotedStanzaId(msg);
    const quotedText = extractQuotedText(msg).toLowerCase();
    const matchesRunning =
      quotedId && currentRunningItem?.msg?.key?.id === quotedId;
    const matchesQueued =
      quotedId && taskQueue.some((item) => item.msg?.key?.id === quotedId);
    const matchesTriggerText = quotedText.startsWith(trigger);
    if (matchesRunning || matchesQueued || matchesTriggerText) {
      return '/stop';
    }
  }

  // 1. Direct owner commands (works even without "@agent" prefix!)
  if (isOwner(msg)) {
    if (
      matchesCommand(lowerText, '/bind') ||
      matchesCommand(lowerText, '/unbind') ||
      matchesCommand(lowerText, '/projects') ||
      matchesCommand(lowerText, '/project') ||
      matchesCommand(lowerText, '/addproject') ||
      matchesCommand(lowerText, '/msg') ||
      matchesCommand(lowerText, '/dm') ||
      matchesCommand(lowerText, '/send') ||
      matchesCommand(lowerText, '/mailsetup') ||
      matchesCommand(lowerText, '/livelocation') ||
      matchesCommand(lowerText, '/setlocation') ||
      matchesCommand(lowerText, '/stoplocation') ||
      matchesCommand(lowerText, '/collab') ||
      matchesCommand(lowerText, '/addcollab') ||
      matchesCommand(lowerText, '/collaborator') ||
      matchesCommand(lowerText, '/addcollaborator') ||
      matchesCommand(lowerText, '/invite') ||
      matchesCommand(lowerText, '/removecollab') ||
      matchesCommand(lowerText, '/uncollab') ||
      matchesCommand(lowerText, '/removeinvite') ||
      matchesCommand(lowerText, '/collabs') ||
      matchesCommand(lowerText, '/collaborators') ||
      matchesCommand(lowerText, '/push') ||
      matchesCommand(lowerText, '/screenshot') ||
      matchesCommand(lowerText, '/ss') ||
      matchesCommand(lowerText, '/qa') ||
      matchesCommand(lowerText, '/stop') ||
      matchesCommand(lowerText, '/status') ||
      matchesCommand(lowerText, '/autopush') ||
      matchesCommand(lowerText, '/help') ||
      lowerText === '/shutdown' ||
      lowerText === '/wakeup' ||
      lowerText === '/resume' ||
      lowerText === '/start' ||
      lowerText === '/confirm' ||
      lowerText === '/sendemail' ||
      lowerText === '/cancel' ||
      lowerText === '/discard'
    ) {
      return trimmedText;
    }

    // If there is a pending email draft in this chat, allow direct "confirm" / "send" / "cancel"
    if (
      ['confirm', 'send', 'send it', 'yes', 'yes send', 'yes, send', 'send now', 'confirm send', 'cancel', 'discard'].includes(lowerText)
    ) {
      const state = loadProjectsState();
      if (state.pendingEmailDrafts?.[msg.key.remoteJid]) {
        return lowerText === 'cancel' || lowerText === 'discard' ? '/cancel' : '/confirm';
      }
    }
  }

  // 2. Explicit text trigger prefix (e.g. "@agent ...")
  // NOTE: slice the *trimmed* text — slicing the raw text breaks when the
  // message has leading whitespace ("  @agent hi" -> "nt hi").
  if (lowerText.startsWith(trigger)) {
    const rest = trimmedText.slice(trigger.length).trim();
    if (isStopWord(rest)) return '/stop';
    return rest;
  }

  // 3. Swipe-replying directly to a bot message (even without typing "@agent")
  if (isReplyingToBot(msg)) {
    if (isStopWord(lowerText)) return '/stop';
    return text.trim();
  }

  // 4. Native WhatsApp @mention in a chat (dedicated bot account or explicit @tag)
  if (sock.user) {
    const m = unwrapMessage(msg);
    let contextInfo =
      m?.extendedTextMessage?.contextInfo ||
      m?.imageMessage?.contextInfo ||
      m?.videoMessage?.contextInfo ||
      m?.audioMessage?.contextInfo ||
      m?.documentMessage?.contextInfo;
    if (!contextInfo && m) {
      for (const val of Object.values(m)) {
        if (val && typeof val === 'object' && val.contextInfo?.mentionedJid) {
          contextInfo = val.contextInfo;
          break;
        }
      }
    }
    const mentionedJids = contextInfo?.mentionedJid || [];

    const botNumber = (sock.user.id || '').split(':')[0].split('@')[0];
    const botLid = (sock.user.lid || '').split(':')[0].split('@')[0];

    const isBotMentioned = mentionedJids.some((jid) => {
      const base = jid.split(':')[0].split('@')[0];
      return (botNumber && base === botNumber) || (botLid && base === botLid);
    });

    if (isBotMentioned) {
      let cleaned = text;
      if (botNumber) {
        cleaned = cleaned.replace(new RegExp(`@${botNumber}\\b`, 'g'), '');
      }
      if (botLid) {
        cleaned = cleaned.replace(new RegExp(`@${botLid}\\b`, 'g'), '');
      }
      return cleaned.trim();
    }
  }

  // Voice notes & audio messages MUST be explicitly tagged with @agent or an @mention.
  // Untagged voice notes are strictly ignored.
  return null;
}

/**
 * Extracts numeric sender phone/ID from a message.
 */
function getSenderNumber(msg) {
  const rawJid = msg.key.participant || msg.key.remoteJid || '';
  return rawJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

/**
 * Checks if the message was sent by YOU (the Owner/Admin).
 * - If you scanned the QR code with your own WhatsApp, `msg.key.fromMe` is true for your messages.
 * - If you also listed your phone number in ADMIN_NUMBERS in .env, that matches too.
 */
function isOwner(msg) {
  if (msg.key.fromMe) return true;
  if (CONFIG.adminNumbers.length > 0) {
    const senderNum = getSenderNumber(msg);
    // Guard: empty sender (e.g. @lid JIDs with no digits) must NEVER match,
    // because admin.endsWith('') is true for every string (auth bypass).
    if (!senderNum) return false;
    return CONFIG.adminNumbers.some(
      (admin) => senderNum.endsWith(admin) || admin.endsWith(senderNum)
    );
  }
  return false;
}

/**
 * Checks if sender is allowed to trigger tasks in a bound group.
 */
function isSenderAuthorized(msg) {
  // fromMe = the linked device itself (respects ALLOW_FROM_ME).
  // Admin numbers from a *different* device are always authorized.
  if (msg.key.fromMe) return CONFIG.allowFromMe;
  if (isOwner(msg)) return true;
  if (CONFIG.allowedSenders.includes('*') || CONFIG.allowedSenders.length === 0) {
    return true;
  }
  const senderNum = getSenderNumber(msg);
  if (!senderNum) return false;
  return CONFIG.allowedSenders.some(
    (allowed) => senderNum.endsWith(allowed) || allowed.endsWith(senderNum)
  );
}

/**
 * Helper to send a WhatsApp reply and track its message ID so we never self-loop.
 */
async function sendReply(sock, jid, text, quotedMsg) {
  const sent = await sock.sendMessage(jid, { text }, { quoted: quotedMsg });
  if (sent?.key?.id) recordSentMessageId(sent.key.id);
  return sent;
}

/**
 * Returns MIME type based on file extension.
 */
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.opus': 'audio/opus',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.apk': 'application/vnd.android.package-archive',
    '.epub': 'application/epub+zip',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.js': 'text/javascript',
    '.py': 'text/x-python',
    '.html': 'text/html',
    '.css': 'text/css',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * Resolves or searches for a local file on the PC.
 */
function findLocalFile(query, projectDir) {
  let cleaned = (query || '').trim().replace(/^["']|["']$/g, '');
  if (!cleaned) return null;

  const homeDir = os.homedir();
  if (cleaned.startsWith('~/')) {
    cleaned = path.join(homeDir, cleaned.slice(2));
  }

  // 1. Direct path check
  const directCandidates = [
    path.isAbsolute(cleaned) ? cleaned : null,
    projectDir ? path.resolve(projectDir, cleaned) : null,
    path.resolve(homeDir, cleaned),
    path.resolve(homeDir, 'Downloads', cleaned),
    path.resolve(homeDir, 'Documents', cleaned),
    path.resolve(homeDir, 'Desktop', cleaned),
    path.resolve(homeDir, 'Pictures', cleaned),
  ].filter(Boolean);

  for (const candidate of directCandidates) {
    if (safeStatIsFile(candidate)) {
      return candidate;
    }
  }

  // 2. Recursive filename search across common user directories (up to depth 4).
  // NOTE: the home root itself is deliberately NOT scanned — a synchronous
  // recursive walk over all of $HOME blocks the event loop for minutes and
  // can OOM on large trees. Downloads/Documents/Desktop/Pictures + project
  // cover the documented use-cases.
  const baseName = path.basename(cleaned);
  if (!baseName || baseName === '.' || baseName === '..' || baseName === '/') {
    return null;
  }
  const targetLower = baseName.toLowerCase();
  const searchRoots = [
    path.join(homeDir, 'Downloads'),
    path.join(homeDir, 'Documents'),
    path.join(homeDir, 'Desktop'),
    path.join(homeDir, 'Pictures'),
    projectDir,
  ].filter((d) => d && fs.existsSync(d));

  const skipDirs = new Set([
    'node_modules',
    '.git',
    '.cache',
    '.local',
    '.npm',
    '.gemini',
    '.vscode',
    '.config',
    'auth_info_baileys',
  ]);

  let partialMatch = null;
  let visitedFiles = 0;
  const MAX_VISITED_FILES = 5000;

  function searchDir(dir, depth) {
    if (depth > 4 || visitedFiles > MAX_VISITED_FILES) return null;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      if (entry.isFile()) {
        visitedFiles += 1;
        if (visitedFiles > MAX_VISITED_FILES) return null;
        const nameLower = entry.name.toLowerCase();
        const fullPath = path.join(dir, entry.name);
        if (nameLower === targetLower) {
          return fullPath;
        }
        if (!partialMatch && targetLower && nameLower.includes(targetLower)) {
          partialMatch = fullPath;
        }
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !skipDirs.has(entry.name)) {
        const found = searchDir(path.join(dir, entry.name), depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  for (const root of searchRoots) {
    const exact = searchDir(root, 1);
    if (exact) return exact;
  }

  return partialMatch;
}

/**
 * Sends a local file over WhatsApp as a document (preserving filename & original quality).
 */
async function sendWhatsAppFile(sock, targetJid, filePath, caption, quotedMsg) {
  if (!safeStatIsFile(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  const MAX_FILE_BYTES = 150 * 1024 * 1024;
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(
      `File "${path.basename(filePath)}" is ${(stat.size / 1048576).toFixed(1)}MB, over the 150MB WhatsApp limit.`
    );
  }
  const buffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const mimetype = getMimeType(filePath);

  const sent = mimetype.startsWith('image/')
    ? await sock.sendMessage(
        targetJid,
        {
          image: buffer,
          caption: caption || `📸 ${fileName}`,
        },
        quotedMsg ? { quoted: quotedMsg } : undefined
      )
    : await sock.sendMessage(
        targetJid,
        {
          document: buffer,
          mimetype,
          fileName,
          caption: caption || `📎 ${fileName}`,
        },
        quotedMsg ? { quoted: quotedMsg } : undefined
      );

  if (sent?.key?.id) recordSentMessageId(sent.key.id);
  return sent;
}

/**
 * Returns active SMTP credentials from projects.json or .env
 */
function getSmtpConfig() {
  const state = loadProjectsState();
  const saved = state.smtp || {};
  return {
    host: saved.host || CONFIG.smtpHost || 'smtp.gmail.com',
    port: Number(saved.port || CONFIG.smtpPort || 465),
    user: saved.user || CONFIG.smtpUser || '',
    pass: saved.pass || CONFIG.smtpPass || '',
  };
}

/**
 * Sends an email with optional attachments via Nodemailer.
 */
async function sendEmailWithAttachments({ to, subject, body, attachmentPaths = [] }) {
  const smtp = getSmtpConfig();
  if (!smtp.user || !smtp.pass) {
    const err = new Error('SMTP_NOT_CONFIGURED');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });

  const attachments = attachmentPaths
    .filter((p) => p && safeStatIsFile(p))
    .map((p) => ({
      filename: path.basename(p),
      path: p,
    }));

  const info = await transporter.sendMail({
    from: smtp.user,
    to,
    subject,
    text: body,
    attachments,
  });

  return { messageId: info.messageId, attachmentsCount: attachments.length, from: smtp.user };
}

/**
 * Extracts a location pin from a message or its quoted message, if present.
 */
function extractLocationFromMessage(msg) {
  const m = unwrapMessage(msg);
  if (!m) return null;

  const directLoc = m.locationMessage || m.liveLocationMessage;
  if (directLoc && typeof directLoc.degreesLatitude === 'number') {
    return {
      lat: directLoc.degreesLatitude,
      lon: directLoc.degreesLongitude,
      label: directLoc.name || directLoc.address || directLoc.caption || 'Shared WhatsApp Pin',
    };
  }

  const quoted =
    m.extendedTextMessage?.contextInfo?.quotedMessage ||
    m.imageMessage?.contextInfo?.quotedMessage ||
    m.videoMessage?.contextInfo?.quotedMessage ||
    m.documentMessage?.contextInfo?.quotedMessage;

  if (!quoted) return null;
  const q =
    quoted.ephemeralMessage?.message ||
    quoted.viewOnceMessage?.message ||
    quoted.viewOnceMessageV2?.message ||
    quoted;

  const quotedLoc = q.locationMessage || q.liveLocationMessage;
  if (quotedLoc && typeof quotedLoc.degreesLatitude === 'number') {
    return {
      lat: quotedLoc.degreesLatitude,
      lon: quotedLoc.degreesLongitude,
      label: quotedLoc.name || quotedLoc.address || quotedLoc.caption || 'Quoted WhatsApp Pin',
    };
  }
  return null;
}

/**
 * Resolves coordinates from:
 * 1) Attached/quoted WhatsApp location pin
 * 2) Explicit "lat, lon" or place name (via OpenStreetMap Nominatim)
 * 3) Saved default location in projects.json (/setlocation)
 * 4) Automatic PC IP Geolocation (https://ipwho.is/)
 */
async function resolveLocationCoordinates(customQuery = '', msg = null) {
  // 1. Check if the user attached or quoted a location pin in WhatsApp
  if (msg) {
    const pin = extractLocationFromMessage(msg);
    if (pin) return pin;
  }

  const q = (customQuery || '').trim();
  if (q && !['AUTO', 'DEFAULT', 'CURRENT', 'HERE', 'NONE'].includes(q.toUpperCase())) {
    // 2a. Explicit lat, lon coordinates (e.g. "12.9716, 77.5946")
    const coordMatch = q.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lon = parseFloat(coordMatch[2]);
      return { lat, lon, label: `${lat.toFixed(5)}, ${lon.toFixed(5)}` };
    }

    // 2b. Geocode place name / address via OpenStreetMap Nominatim
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'WhatsAppAntigravityAgent/1.0' },
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lon: parseFloat(data[0].lon),
          label: data[0].display_name.split(',').slice(0, 3).join(',').trim(),
        };
      }
    } catch {
      // Fall through to saved or IP location
    }
  }

  // 3. Saved default location in projects.json (set via /setlocation)
  const state = loadProjectsState();
  if (
    state.savedLocation &&
    typeof state.savedLocation.lat === 'number' &&
    typeof state.savedLocation.lon === 'number'
  ) {
    return state.savedLocation;
  }

  // 4. Automatic PC IP Geolocation fallback
  try {
    const res = await fetch('https://ipwho.is/', {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (data && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
      const label = [data.city, data.region, data.country].filter(Boolean).join(', ');
      return {
        lat: data.latitude,
        lon: data.longitude,
        label: label || 'Current PC Location',
      };
    }
  } catch {
    // Ignore IP lookup error
  }

  throw new Error(
    'Could not determine location automatically. Set your location once using `/setlocation <place or lat,lon>` or swipe-reply `/setlocation` to a location pin!'
  );
}

/**
 * Relays a native WhatsApp liveLocationMessage packet.
 */
async function sendLiveLocationPacket(sock, targetJid, { lat, lon, caption, seq, remainingSec }) {
  const content = generateWAMessageFromContent(
    targetJid,
    {
      liveLocationMessage: {
        degreesLatitude: lat,
        degreesLongitude: lon,
        accuracyInMeters: 15,
        caption,
        sequenceNumber: seq,
        timeOffset: remainingSec,
      },
    },
    { userJid: sock.user?.id }
  );
  await sock.relayMessage(targetJid, content.message, {
    messageId: content.key.id,
  });
  if (content?.key?.id) recordSentMessageId(content.key.id);
  return content;
}

/**
 * Stops an active live location session for a target JID (or all active sessions if targetJid is null).
 */
function stopLiveLocationShare(targetJid = null) {
  if (targetJid) {
    const existing = activeLiveLocations.get(targetJid);
    if (existing) {
      clearInterval(existing.intervalId);
      clearTimeout(existing.timeoutId);
      activeLiveLocations.delete(targetJid);
      return [existing];
    }
    return [];
  }

  const stopped = [];
  for (const [jidKey, session] of activeLiveLocations.entries()) {
    clearInterval(session.intervalId);
    clearTimeout(session.timeoutId);
    stopped.push(session);
    activeLiveLocations.delete(jidKey);
  }
  return stopped;
}

/**
 * Starts sharing live location with `targetJid` for `durationHours` (default 8 hours).
 * Sends an interactive map pin + native liveLocationMessage stream and updates periodically.
 */
async function startLiveLocationShare(
  sock,
  targetJid,
  durationHours = 8,
  customPlaceOrCoords = '',
  msg = null
) {
  const hours = Math.max(0.25, Math.min(24, Number(durationHours) || 8));
  const totalSeconds = Math.round(hours * 3600);
  const loc = await resolveLocationCoordinates(customPlaceOrCoords, msg);

  // Stop any previous live location session for this recipient
  stopLiveLocationShare(targetJid);

  const endTimeMs = Date.now() + totalSeconds * 1000;
  const endTimeFormatted = new Date(endTimeMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  // 1. Send interactive map location pin so it renders a rich map card on all devices
  const pinSent = await sock.sendMessage(targetJid, {
    location: {
      degreesLatitude: loc.lat,
      degreesLongitude: loc.lon,
      name: `📍 Live Location (${hours}h — until ${endTimeFormatted})`,
      address: loc.label,
    },
  });
  if (pinSent?.key?.id) recordSentMessageId(pinSent.key.id);

  // 2. Send native liveLocationMessage packet
  let seq = 1;
  try {
    await sendLiveLocationPacket(sock, targetJid, {
      lat: loc.lat,
      lon: loc.lon,
      caption: `📍 Live Location (${hours}h — active until ${endTimeFormatted})\n${loc.label}`,
      seq,
      remainingSec: totalSeconds,
    });
  } catch {
    // Ignore if device prefers standard location pin
  }

  // 3. Keep background live location session active for the full duration (e.g. 8 hours),
  // pushing live coordinate updates every 5 minutes. Reuse the originally resolved
  // location — re-resolving via IP geolocation here would make the pin jump around
  // and hammer the geolocation API on every tick.
  const intervalId = setInterval(async () => {
    const remainingSec = Math.max(0, Math.round((endTimeMs - Date.now()) / 1000));
    if (remainingSec <= 0) {
      stopLiveLocationShare(targetJid);
      return;
    }
    seq += 1;
    try {
      await sendLiveLocationPacket(sock, targetJid, {
        lat: loc.lat,
        lon: loc.lon,
        caption: `📍 Live Location (active until ${endTimeFormatted}) — ${loc.label}`,
        seq,
        remainingSec,
      });
    } catch {
      // Ignore transient network errors during background update
    }
  }, 5 * 60 * 1000);

  const timeoutId = setTimeout(() => {
    stopLiveLocationShare(targetJid);
  }, totalSeconds * 1000);

  const contacts = loadContactsMap();
  const targetName = contacts[targetJid] || targetJid;

  activeLiveLocations.set(targetJid, {
    targetJid,
    targetName,
    lat: loc.lat,
    lon: loc.lon,
    label: loc.label,
    hours,
    endTimeFormatted,
    intervalId,
    timeoutId,
  });

  return {
    loc,
    hours,
    endTimeFormatted,
    targetName,
  };
}

/**
 * Extracts all mentioned JIDs in a message (excluding the bot itself if needed).
 */
function getMentionedJids(msg) {
  const m = unwrapMessage(msg);
  const contextInfo =
    m?.extendedTextMessage?.contextInfo ||
    m?.imageMessage?.contextInfo ||
    m?.videoMessage?.contextInfo ||
    m?.documentMessage?.contextInfo;
  return contextInfo?.mentionedJid || [];
}

/**
 * Resolves a contact target (@mention, JID, phone number, or contact name) to a valid WhatsApp JID.
 */
function resolveContactTarget(msg, targetInput, { exactOnly = false } = {}) {
  const raw = (targetInput || '').trim();
  if (!raw) return null;
  const mentioned = getMentionedJids(msg);

  // 1. If the user @mentioned a contact in this WhatsApp message
  if (mentioned.length > 0 && raw.startsWith('@')) {
    const stripped = raw.replace(/^@/, '');
    const exactMatch = mentioned.find((jid) => jid.startsWith(stripped));
    return exactMatch || mentioned[0];
  }

  // 2. If it's already a full WhatsApp JID
  if (raw.includes('@s.whatsapp.net') || raw.includes('@lid') || raw.includes('@g.us')) {
    return raw;
  }

  // 3. If it's a phone number (e.g. 919876543210 or +919876543210)
  const digitsOnly = raw.replace(/[^0-9]/g, '');
  if (digitsOnly.length >= 10 && digitsOnly.length <= 15 && /^[@+\d\s-]+$/.test(raw)) {
    const contacts = loadContactsMap();
    for (const jid of Object.keys(contacts)) {
      if (jid.includes(digitsOnly) && jid.endsWith('@s.whatsapp.net')) return jid;
    }
    return `${digitsOnly}@s.whatsapp.net`;
  }

  // 4. Search saved contact names (case-insensitive, preferring @s.whatsapp.net over @lid)
  const contacts = loadContactsMap();
  const entries = Object.entries(contacts).sort(([jidA], [jidB]) => {
    const aPhone = jidA.endsWith('@s.whatsapp.net') ? 0 : 1;
    const bPhone = jidB.endsWith('@s.whatsapp.net') ? 0 : 1;
    return aPhone - bPhone;
  });

  const lowerTarget = raw.toLowerCase().replace(/^@/, '');
  for (const [jid, name] of entries) {
    if (name.toLowerCase().trim() === lowerTarget) return jid;
  }
  if (!exactOnly) {
    for (const [jid, name] of entries) {
      if (name.toLowerCase().includes(lowerTarget)) return jid;
    }
  }

  return null;
}

/**
 * Helper to react to a message with an emoji.
 */
async function reactToMessage(sock, msg, emoji) {
  try {
    await sock.sendMessage(msg.key.remoteJid, {
      react: { text: emoji, key: msg.key },
    });
  } catch {
    // Ignore reaction errors
  }
}

/**
 * Extracts `[TAG: ...]` directives from agent output, tolerating `]` characters
 * inside the payload (e.g. "hello [world]"). The old non-greedy regexes
 * (`[\s\S]+?\]`) truncated at the first inner `]`.
 *
 * A directive ends at the first `]` that is followed by end-of-string,
 * a newline, or the start of another `[TAG:` directive.
 */
function extractBracketDirectives(response, tag) {
  const results = [];
  const open = `[${tag}:`;
  let searchFrom = 0;
  while (true) {
    const start = response.indexOf(open, searchFrom);
    if (start === -1) break;
    const payloadStart = start + open.length;
    // Find all candidate closing brackets and pick the right terminator.
    let end = -1;
    let cursor = payloadStart;
    while (true) {
      const close = response.indexOf(']', cursor);
      if (close === -1) break;
      const after = response.slice(close + 1);
      if (after === '' || after.startsWith('\n') || /^\s*\[/.test(after)) {
        end = close;
        break;
      }
      // Heuristic: a `]` followed by end-of-line-ish boundary also terminates.
      // Otherwise treat it as payload content (e.g. "[world]") and keep scanning.
      const nextOpen = response.indexOf('[', close + 1);
      if (nextOpen === -1) {
        end = response.lastIndexOf(']');
        break;
      }
      cursor = close + 1;
    }
    if (end === -1) break;
    const fullMatch = response.slice(start, end + 1);
    const payload = response.slice(payloadStart, end);
    results.push({ fullMatch, payload });
    searchFrom = end + 1;
  }
  return results;
}

function splitFirstPipe(s) {
  const i = s.indexOf('|');
  if (i === -1) return [s.trim(), ''];
  return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
}

/**
 * Processes queued coding tasks sequentially so two agents don't edit the same repo simultaneously.
 */
async function processQueue(sock) {
  if (isProcessingQueue || taskQueue.length === 0) return;
  isProcessingQueue = true;

  try {
    while (taskQueue.length > 0) {
      const item = taskQueue.shift();
      currentRunningItem = item;
      try {
        await processQueueItem(sock, item);
      } catch (err) {
        if (!err.cancelled) {
          try {
            await sendReply(
              sock,
              item.jid,
              `❌ ${err.message}`,
              item.msg
            );
          } catch {
            // Ignore reply errors so the queue keeps draining
          }
        }
      } finally {
        currentRunningItem = null;
      }
    }
  } finally {
    currentRunningItem = false;
    isProcessingQueue = false;
  }
}

async function processQueueItem(sock, item) {
  const { jid, msg, projectAlias, projectDir, taskPrompt, continueSession } = item;
  const isGroup = jid.endsWith('@g.us');
  const owner = isOwner(msg);
  const mentionedJids = getMentionedJids(msg);

  await reactToMessage(sock, msg, '⏳');
  const attachmentInfo = await downloadWhatsAppAttachment(msg, projectDir);
  const imagePath = attachmentInfo?.type === 'image' ? attachmentInfo.filePath : null;

  try {
    const preState = loadProjectsState();
    const existingDraft = preState.pendingEmailDrafts?.[jid] || null;

    const recentChatContext = getRecentChatContext(jid);

    const result = await runAntigravityTask({
      projectAlias,
      projectDir,
      taskPrompt,
      continueSession,
      imagePath,
      attachmentInfo,
      pendingEmailDraft: existingDraft,
      ownerAllowedToMessage: owner,
      mentionedJids,
      recentChatContext,
    });

    let cleanedResponse = result.response;
    const dmNotifications = [];
    const stripDirectives = [];
    let hasOwnerEmailAction = false;
    let hasCalendarAction = false;

    // Only execute owner directives if triggered by the Owner!
    if (owner) {
      for (const { fullMatch, payload } of extractBracketDirectives(result.response, 'SEND_WHATSAPP')) {
        const [targetRaw, dmText] = splitFirstPipe(payload);
        stripDirectives.push(fullMatch);
        if (!targetRaw || !dmText) continue;
        const targetJid = resolveContactTarget(msg, targetRaw);
        if (targetJid) {
          try {
            const sentDm = await sock.sendMessage(targetJid, { text: dmText });
            if (sentDm?.key?.id) recordSentMessageId(sentDm.key.id);
            const contacts = loadContactsMap();
            const displayTarget = contacts[targetJid] || targetRaw;
            dmNotifications.push(
              `📨 Sent to *${displayTarget}*: "${dmText}"`
            );
          } catch (dmErr) {
            dmNotifications.push(
              `⚠️ Failed to message ${targetRaw}: ${dmErr.message}`
            );
          }
        } else {
          dmNotifications.push(
            `⚠️ Could not find contact "${targetRaw}".`
          );
        }
      }

      for (const { fullMatch, payload } of extractBracketDirectives(result.response, 'SEND_FILE')) {
        const [targetRaw, rawPath] = splitFirstPipe(payload);
        stripDirectives.push(fullMatch);
        if (!targetRaw || !rawPath) continue;
        const resolvedFile = findLocalFile(rawPath, projectDir);

        if (!resolvedFile) {
          dmNotifications.push(`⚠️ File not found: \`${rawPath}\``);
          continue;
        }

        const isHere = ['HERE', 'SELF', 'ME', 'CHAT'].includes(targetRaw.toUpperCase());
        const targetJid = isHere ? jid : resolveContactTarget(msg, targetRaw);

        if (targetJid) {
          try {
            await sendWhatsAppFile(
              sock,
              targetJid,
              resolvedFile,
              `📎 \`${path.basename(resolvedFile)}\``,
              isHere ? msg : undefined
            );
            if (!isHere) {
              const contacts = loadContactsMap();
              const displayTarget = contacts[targetJid] || targetRaw;
              dmNotifications.push(
                `📎 Sent \`${path.basename(resolvedFile)}\` to *${displayTarget}*.`
              );
            }
          } catch (fileErr) {
            dmNotifications.push(
              `⚠️ Failed to send \`${path.basename(resolvedFile)}\`: ${fileErr.message}`
            );
          }
        } else {
          dmNotifications.push(
            `⚠️ Could not find contact "${targetRaw}".`
          );
        }
      }

      for (const tag of ['DRAFT_EMAIL', 'SEND_EMAIL']) {
        for (const { fullMatch, payload } of extractBracketDirectives(result.response, tag)) {
          stripDirectives.push(fullMatch);
          // Split payload into to | subject | attachments | body (body may contain | and ])
          const firstPipe = payload.indexOf('|');
          const secondPipe = firstPipe === -1 ? -1 : payload.indexOf('|', firstPipe + 1);
          const thirdPipe = secondPipe === -1 ? -1 : payload.indexOf('|', secondPipe + 1);
          if (firstPipe === -1 || secondPipe === -1 || thirdPipe === -1) continue;
          let toEmail = payload.slice(0, firstPipe).trim();
          if (['me', 'myself', 'owner', 'self'].includes(toEmail.toLowerCase())) {
            toEmail = CONFIG.ownerEmail || '';
          }
          const subject = payload.slice(firstPipe + 1, secondPipe).trim();
          const rawAttachments = payload.slice(secondPipe + 1, thirdPipe).trim();
          const emailBody = payload.slice(thirdPipe + 1).trim();
          if (!toEmail || !subject) continue;

          const resolvedAttachments = [];
          if (rawAttachments && rawAttachments.toUpperCase() !== 'NONE') {
            for (const part of rawAttachments.split(',')) {
              const found = findLocalFile(part.trim(), projectDir);
              if (found && !resolvedAttachments.includes(found)) {
                resolvedAttachments.push(found);
              }
            }
          }
          // If the user attached a file in WhatsApp, make sure it's included!
          if (
            attachmentInfo?.filePath &&
            safeStatIsFile(attachmentInfo.filePath) &&
            !resolvedAttachments.includes(attachmentInfo.filePath)
          ) {
            resolvedAttachments.push(attachmentInfo.filePath);
          }
          // If revising an existing draft and no new attachments were specified, keep the existing draft's attachments
          if (
            resolvedAttachments.length === 0 &&
            existingDraft?.attachments?.length > 0 &&
            rawAttachments.toUpperCase() !== 'CLEAR'
          ) {
            for (const prevPath of existingDraft.attachments) {
              if (safeStatIsFile(prevPath) && !resolvedAttachments.includes(prevPath)) {
                resolvedAttachments.push(prevPath);
              }
            }
          }

          const isOwnerEmail =
            Boolean(CONFIG.ownerEmail) &&
            toEmail.toLowerCase() === CONFIG.ownerEmail.toLowerCase();
          const shouldSendImmediately = tag === 'SEND_EMAIL' || isOwnerEmail;

          if (shouldSendImmediately) {
            try {
              await sendEmailWithAttachments({
                to: toEmail,
                subject,
                body: emailBody,
                attachmentPaths: resolvedAttachments,
              });

              if (isOwnerEmail) {
                hasOwnerEmailAction = true;
                // For owner emails: do NOT leak personal email or full body into group chats!
              } else {
                const attachNames =
                  resolvedAttachments.length > 0
                    ? resolvedAttachments.map((p) => `\`${path.basename(p)}\``).join(', ')
                    : '_None_';

                dmNotifications.push(
                  [
                    `📧 *Email Sent to \`${toEmail}\`*`,
                    `• *Subject:* ${subject}`,
                    `• *Attachments:* ${attachNames}`,
                    ``,
                    emailBody,
                  ].join('\n')
                );
              }
            } catch (mailErr) {
              console.error(`⚠️ Failed to send email to ${toEmail}:`, mailErr.message);
              if (!isGroup) {
                dmNotifications.push(
                  `❌ *Failed to send email to \`${toEmail}\`:*\n${mailErr.message}`
                );
              }
            }
          } else {
            // Save draft to state.pendingEmailDrafts[jid] so the user can review & confirm before sending
            // Reload fresh state to avoid clobbering concurrent updates.
            const latestState = loadProjectsState();
            latestState.pendingEmailDrafts = latestState.pendingEmailDrafts || {};
            latestState.pendingEmailDrafts[jid] = {
              to: toEmail,
              subject,
              body: emailBody,
              attachments: resolvedAttachments,
              updatedAt: new Date().toISOString(),
            };
            saveProjectsState(latestState);

            const attachNames =
              resolvedAttachments.length > 0
                ? resolvedAttachments.map((p) => `\`${path.basename(p)}\``).join(', ')
                : '_None_';

            dmNotifications.push(
              [
                `📝 *Email Draft*`,
                `• *To:* \`${toEmail}\``,
                `• *Subject:* ${subject}`,
                `• *Attachments:* ${attachNames}`,
                ``,
                emailBody,
                ``,
                `_Reply *confirm* to send, swipe-reply to edit, or *cancel* to discard._`,
              ].join('\n')
            );
          }
        }
      }

      // Handle CALENDAR_EVENT directive
      for (const { fullMatch, payload } of extractBracketDirectives(result.response, 'CALENDAR_EVENT')) {
        stripDirectives.push(fullMatch);
        hasCalendarAction = true;
        const parts = payload.split('|').map((s) => s.trim());
        const title = parts[0] || 'Calendar Event';
        const startRaw = parts[1] || '';
        const endOrDuration = parts[2] || '1h';
        const description = parts[3] || '';
        const location = parts[4] || '';

        let startDate = parseCalendarDateTime(startRaw);

        let endDate;
        if (endOrDuration.endsWith('h') || endOrDuration.endsWith('hr') || endOrDuration.endsWith('hours')) {
          const hours = parseFloat(endOrDuration) || 1;
          endDate = new Date(startDate.getTime() + hours * 60 * 60 * 1000);
        } else if (endOrDuration.endsWith('m') || endOrDuration.endsWith('min') || endOrDuration.endsWith('mins')) {
          const mins = parseFloat(endOrDuration) || 30;
          endDate = new Date(startDate.getTime() + mins * 60 * 1000);
        } else {
          const parsedEnd = endOrDuration ? new Date(endOrDuration) : null;
          endDate = parsedEnd && !isNaN(parsedEnd.getTime()) ? parsedEnd : new Date(startDate.getTime() + 60 * 60 * 1000);
        }

        const gcalUrl = buildGoogleCalendarUrl({
          title,
          start: startDate,
          end: endDate,
          description,
          location,
        });

        let inviteSynced = false;
        try {
          const stateForSmtp = loadProjectsState();
          const smtpConfig = stateForSmtp.smtp || {
            host: CONFIG.smtpHost,
            port: CONFIG.smtpPort,
            user: CONFIG.smtpUser,
            pass: CONFIG.smtpPass,
          };

          if (smtpConfig.user && smtpConfig.pass && CONFIG.ownerEmail) {
            await sendCalendarInviteDirectly({
              to: CONFIG.ownerEmail,
              title,
              start: startDate,
              end: endDate,
              description,
              location,
              smtpConfig,
            });
            inviteSynced = true;
          }
        } catch (syncErr) {
          console.warn('⚠️ Direct Google Calendar invite sync failed:', syncErr.message);
        }

        // Never dump .ics file attachment into WhatsApp group chats!
        // In 1-on-1 DMs, only send .ics file if direct invite sync failed as a fallback.
        if (!isGroup && !inviteSynced) {
          try {
            const icsPath = createIcsFile({
              title,
              start: startDate,
              end: endDate,
              description,
              location,
              organizerEmail: CONFIG.ownerEmail || '',
              attendeeEmail: CONFIG.ownerEmail || '',
              method: 'REQUEST',
            });

            await sendWhatsAppFile(
              sock,
              jid,
              icsPath,
              `📅 \`${path.basename(icsPath)}\``,
              msg
            );
          } catch (icsErr) {
            console.warn('⚠️ Could not send .ics attachment:', icsErr.message);
          }
        }

        // In groups, NEVER leak calendar cards or owner email into the chat!
        // In private DMs, only provide fallback link if direct sync failed
        if (!isGroup && !inviteSynced) {
          dmNotifications.push(`🔗 [Add to Google Calendar](${gcalUrl})`);
        }
      }

      for (const { fullMatch, payload } of extractBracketDirectives(result.response, 'SHARE_LIVE_LOCATION')) {
        stripDirectives.push(fullMatch);
        const segments = payload.split('|').map((s) => s.trim());
        const targetRaw = (segments[0] || 'HERE').trim() || 'HERE';
        const hoursRaw = parseFloat((segments[1] || '8').trim()) || 8;
        const placeRaw = (segments[2] || 'AUTO').trim() || 'AUTO';

        const isHere = ['HERE', 'SELF', 'ME', 'CHAT'].includes(targetRaw.toUpperCase());
        const targetJid = isHere ? jid : resolveContactTarget(msg, targetRaw);

        if (!targetJid) {
          dmNotifications.push(
            `⚠️ Could not find contact "${targetRaw}".`
          );
          continue;
        }

        try {
          const locInfo = await startLiveLocationShare(
            sock,
            targetJid,
            hoursRaw,
            placeRaw,
            msg
          );
          const displayTarget = isHere ? 'this chat' : locInfo.targetName;
          dmNotifications.push(
            `📍 Sharing live location with *${displayTarget}* for ${locInfo.hours}h (until ${locInfo.endTimeFormatted}).`
          );
        } catch (locErr) {
          dmNotifications.push(
            `⚠️ Failed to share live location: ${locErr.message}`
          );
        }
      }

      for (const { fullMatch, payload } of extractBracketDirectives(result.response, 'ADD_COLLABORATOR')) {
        stripDirectives.push(fullMatch);
        const segments = payload.split('|').map((s) => s.trim());
        const targetUser = (segments[0] || '').trim();
        const repoRaw = (segments[1] || 'CURRENT').trim();
        const permRaw = (segments[2] || 'push').trim();
        const isCurrent = !repoRaw || ['CURRENT', 'HERE', 'DEFAULT', 'AUTO'].includes(repoRaw.toUpperCase());
        let repoInput = isCurrent ? '' : repoRaw;
        if (repoInput && preState.projects?.[repoInput.toLowerCase()]) {
          repoInput = '';
        }
        const targetProjDir =
          repoRaw && preState.projects?.[repoRaw.toLowerCase()]
            ? preState.projects[repoRaw.toLowerCase()]
            : projectDir;

        try {
          const res = await addGitHubCollaborator({
            username: targetUser,
            permission: permRaw,
            projectDir: targetProjDir,
            repoInput,
          });
          if (res.status === 'already_collaborator') {
            dmNotifications.push(
              `✅ *@${res.username}* is already a collaborator on \`${res.owner}/${res.repo}\` (${res.permission}).`
            );
          } else {
            dmNotifications.push(
              `🤝 Invited *@${res.username}* to \`${res.owner}/${res.repo}\` (${res.permission}) — https://github.com/${res.owner}/${res.repo}/invitations`
            );
          }
        } catch (collabErr) {
          dmNotifications.push(`⚠️ Failed to add collaborator: ${collabErr.message}`);
        }
      }

      for (const { fullMatch, payload } of extractBracketDirectives(result.response, 'REMOVE_COLLABORATOR')) {
        stripDirectives.push(fullMatch);
        const segments = payload.split('|').map((s) => s.trim());
        const targetUser = (segments[0] || '').trim();
        const repoRaw = (segments[1] || 'CURRENT').trim();
        const isCurrent = !repoRaw || ['CURRENT', 'HERE', 'DEFAULT', 'AUTO'].includes(repoRaw.toUpperCase());
        const repoInput = isCurrent ? '' : repoRaw;
        const targetProjDir =
          repoRaw && preState.projects?.[repoRaw.toLowerCase()]
            ? preState.projects[repoRaw.toLowerCase()]
            : projectDir;

        try {
          const res = await removeGitHubCollaborator({
            username: targetUser,
            projectDir: targetProjDir,
            repoInput,
          });
          dmNotifications.push(
            res.status === 'invitation_cancelled'
              ? `🗑️ Cancelled pending invitation for *@${res.username}* on \`${res.owner}/${res.repo}\`.`
              : `🗑️ Removed *@${res.username}* from \`${res.owner}/${res.repo}\`.`
          );
        } catch (collabErr) {
          dmNotifications.push(`⚠️ Failed to remove collaborator: ${collabErr.message}`);
        }
      }

      for (const { fullMatch, payload } of extractBracketDirectives(result.response, 'LIST_COLLABORATORS')) {
        stripDirectives.push(fullMatch);
        const repoRaw = (payload || 'CURRENT').trim();
        const isCurrent = !repoRaw || ['CURRENT', 'HERE', 'DEFAULT', 'AUTO'].includes(repoRaw.toUpperCase());
        const repoInput = isCurrent ? '' : repoRaw;
        const targetProjDir =
          repoRaw && preState.projects?.[repoRaw.toLowerCase()]
            ? preState.projects[repoRaw.toLowerCase()]
            : projectDir;

        try {
          const info = await listGitHubCollaborators({
            projectDir: targetProjDir,
            repoInput,
          });
          const collabLines = info.collaborators.map(
            (c) => `• *@${c.username}* (${c.roleName})`
          );
          const invLines = info.pendingInvitations.map(
            (inv) => `• *@${inv.username}* _(pending ${inv.permission} invite)_`
          );
          dmNotifications.push(
            [
              `👥 *Collaborators on \`${info.owner}/${info.repo}\`:*`,
              collabLines.length > 0 ? collabLines.join('\n') : '_None_',
              invLines.length > 0 ? `\n⏳ *Pending Invitations:*\n${invLines.join('\n')}` : null,
            ]
              .filter(Boolean)
              .join('\n')
          );
        } catch (collabErr) {
          dmNotifications.push(`⚠️ Failed to list collaborators: ${collabErr.message}`);
        }
      }

      for (const d of stripDirectives) {
        cleanedResponse = cleanedResponse.split(d).join('');
      }
      cleanedResponse = cleanedResponse.trim();
    }

    const hadPersonalAction = hasOwnerEmailAction || hasCalendarAction;

    function isPersonalEcho(text) {
      if (!text) return true;
      const lower = text.toLowerCase().trim();
      if (lower.startsWith('hi ramanand') || lower.startsWith('hello ramanand') || lower.startsWith('dear ramanand')) return true;
      if (lower.includes('here is your google meet link') || lower.includes('here is the google meet link')) return true;
      if (lower.includes('i have sent') || lower.includes("i've sent") || lower.includes('i have drafted')) return true;
      if (lower.includes('added to your calendar') || lower.includes('scheduled on your calendar')) return true;
      if (lower.includes('calendar event') || lower.includes('email sent')) return true;
      return false;
    }

    // In group chats: If this was a personal action for the owner (email/calendar), keep it completely silent & clean.
    // Do NOT post personal greetings, meet links, or status cards to the group unless there were actual code changes.
    if (isGroup && hadPersonalAction && (!result.gitSummary || isPersonalEcho(cleanedResponse))) {
      cleanedResponse = '';
    }

    // In 1-on-1 DMs: If purely personal actions and response is a greeting/link echo, simplify to a clean one-liner.
    if (!isGroup && hadPersonalAction && !result.gitSummary && (!cleanedResponse || isPersonalEcho(cleanedResponse))) {
      if (hasOwnerEmailAction && hasCalendarAction) {
        cleanedResponse = '✅ Added to your Google Calendar and sent to your email.';
      } else if (hasCalendarAction) {
        cleanedResponse = '✅ Added to your Google Calendar.';
      } else if (hasOwnerEmailAction) {
        cleanedResponse = '✅ Sent to your email.';
      }
    }

    const replyParts = [
      cleanedResponse,
      ...dmNotifications,
    ];

    if (result.gitSummary) {
      const currentState = loadProjectsState();
      const autoPushEnabled = currentState.autoPush?.[projectAlias];

      if (autoPushEnabled) {
        try {
          const pushInfo = gitCommitAndPush(
            projectDir,
            `Auto-update via WhatsApp: ${taskPrompt.slice(0, 60)}`
          );
          replyParts.push(
            `🚀 Pushed to \`${pushInfo.branch}\` (\`${pushInfo.commitHash}\`).`
          );
        } catch (pushErr) {
          replyParts.push(
            `⚠️ Auto-push failed: ${pushErr.message}`
          );
        }
      }
    }

    await reactToMessage(sock, msg, '✅');
    const finalReply = replyParts.filter(Boolean).join('\n\n').trim();
    if (finalReply) {
      await sendReply(sock, jid, finalReply, msg);
    }
  } catch (err) {
    if (err.cancelled) {
      return;
    }
    await reactToMessage(sock, msg, '❌');
    await sendReply(
      sock,
      jid,
      `❌ ${err.message}`,
      msg
    );
  }
}

/**
 * Handles built-in slash commands.
 * Group members can ONLY run /help, /push, /status, /stop on their bound group.
 * ONLY the Owner can run /bind, /unbind, /projects, /addproject, /autopush, /msg, /dm, /send, /mailsetup, /confirm, /cancel, /livelocation, /setlocation, /stoplocation.
 */
async function handleSlashCommand(sock, jid, msg, commandBody) {
  const parts = commandBody.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg1 = parts[1];
  const arg2 = parts.slice(2).join(' ');
  const isGroup = jid.endsWith('@g.us');
  const owner = isOwner(msg);
  const state = loadProjectsState();
  const boundProject = isGroup ? state.groupBindings?.[jid] : state.activeProject;

  // Mutate the freshest state on disk (not the snapshot above) so a
  // concurrently-finishing agent task can't have its save clobbered.
  function persistFresh(mutator) {
    const fresh = loadProjectsState();
    mutator(fresh);
    saveProjectsState(fresh);
    // Keep the local snapshot consistent for any code below in this call.
    Object.assign(state, fresh);
    return fresh;
  }

  if (cmd === '/help' || cmd === 'help') {
    const trig = CONFIG.triggerPrefix;
    const helpLines = [
      `🤖 *WhatsApp Agent* (${boundProject ? `\`${boundProject}\`` : 'unbound'})`,
      `• *${trig} <task>* — Run task`,
      `• *${trig} /screenshot [url]* — Capture page screenshot (add mobile for phone view)`,
      `• *${trig} /push [msg]* — Commit & push`,
      `• *${trig} /status* — Check status`,
      `• *${trig} /stop* — Stop task (or swipe-reply *stop*)`,
    ];

    if (owner) {
      helpLines.push(
        `• */collab <github_user> [repo] [read|write|admin]* — Invite GitHub collaborator`,
        `• */removecollab <github_user> [repo]* — Remove collaborator / invite`,
        `• */collabs [repo]* — List repo collaborators & pending invites`,
        `• */bind <project>* | */unbind* | */projects* | */addproject <alias> <path>*`,
        `• */autopush on|off* | */shutdown* | */wakeup*`,
        `• */msg <Contact> <text>* | */send [Contact :] <file>*`,
        `• */livelocation <Contact> [hours]* | */setlocation <place>* | */stoplocation*`,
        `• */mailsetup <email> <app_pass>* | */confirm* | */cancel*`
      );
    }

    await sendReply(sock, jid, helpLines.join('\n'), msg);
    return true;
  }

  if (cmd === '/shutdown') {
    if (!owner) {
      await sendReply(
        sock,
        jid,
        `🔒 Only the bot owner can shut down the agent.`,
        msg
      );
      return true;
    }

    state.disabledGroups = state.disabledGroups || {};
    state.disabledGroups[jid] = true;
    persistFresh((fresh) => {
      fresh.disabledGroups = fresh.disabledGroups || {};
      fresh.disabledGroups[jid] = true;
    });

    // Cancel any running task or queued tasks for this group
    const active = getActiveTaskInfo();
    if (active && boundProject && active.projectAlias === boundProject) {
      stopActiveTask();
    }
    for (let i = taskQueue.length - 1; i >= 0; i--) {
      if (taskQueue[i].jid === jid) {
        taskQueue.splice(i, 1);
      }
    }

    await reactToMessage(sock, msg, '🛑');
    await sendReply(
      sock,
      jid,
      `🛑 Agent shut down in this chat. Send */wakeup* to turn it back on.`,
      msg
    );
    return true;
  }

  if (cmd === '/wakeup' || cmd === '/resume' || cmd === '/start') {
    if (!owner) {
      await sendReply(
        sock,
        jid,
        `🔒 Only the bot owner can wake up the agent.`,
        msg
      );
      return true;
    }

    if (state.disabledGroups?.[jid]) {
      persistFresh((fresh) => {
        if (fresh.disabledGroups?.[jid]) delete fresh.disabledGroups[jid];
      });
    }

    await reactToMessage(sock, msg, '🟢');
    await sendReply(
      sock,
      jid,
      `🟢 Agent online${boundProject ? ` (\`${boundProject}\`)` : ''}.`,
      msg
    );
    return true;
  }

  if (cmd === '/setlocation') {
    if (!owner) {
      await sendReply(sock, jid, `🔒 Only the bot owner can configure location settings.`, msg);
      return true;
    }

    const rest = commandBody.trim().replace(/^\/setlocation\s*/i, '').trim();
    const quotedPin = extractLocationFromMessage(msg);

    if (!rest && !quotedPin) {
      const saved = state.savedLocation;
      await sendReply(
        sock,
        jid,
        saved
          ? `📍 Saved location: *${saved.label}* (\`${saved.lat.toFixed(5)}, ${saved.lon.toFixed(5)}\`).\nUsage: */setlocation <place or lat,lon>* or */setlocation auto*`
          : `📍 Saved location: _Auto (IP)_.\nUsage: */setlocation <place or lat,lon>* or swipe-reply to a location pin.`,
        msg
      );
      return true;
    }

    if (rest.toLowerCase() === 'auto' || rest.toLowerCase() === 'reset') {
      persistFresh((fresh) => {
        delete fresh.savedLocation;
      });
      await sendReply(
        sock,
        jid,
        `✅ Cleared saved location. Live location will now use automatic PC geolocation.`,
        msg
      );
      return true;
    }

    try {
      const loc = await resolveLocationCoordinates(rest, msg);
      persistFresh((fresh) => {
        fresh.savedLocation = loc;
      });
      await reactToMessage(sock, msg, '📍');
      await sendReply(
        sock,
        jid,
        `📍 Saved default location: *${loc.label}* (\`${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}\`).`,
        msg
      );
    } catch (err) {
      await sendReply(sock, jid, `❌ ${err.message}`, msg);
    }
    return true;
  }

  if (cmd === '/stoplocation') {
    if (!owner) {
      await sendReply(sock, jid, `🔒 Only the bot owner can stop live location shares.`, msg);
      return true;
    }
    const stopped = stopLiveLocationShare();
    if (stopped.length === 0) {
      await sendReply(sock, jid, `ℹ️ No active live location sessions are currently running.`, msg);
    } else {
      const names = stopped.map((s) => `*${s.targetName}*`).join(', ');
      await reactToMessage(sock, msg, '🛑');
      await sendReply(
        sock,
        jid,
        `🛑 Stopped sharing live location with ${names}.`,
        msg
      );
    }
    return true;
  }

  if (cmd === '/livelocation') {
    if (!owner) {
      await sendReply(sock, jid, `🔒 Only the bot owner can share live location.`, msg);
      return true;
    }

    const rest = commandBody.trim().replace(/^\/livelocation\s*/i, '').trim();
    if (!rest) {
      await sendReply(
        sock,
        jid,
        `⚠️ Usage: */livelocation <Contact or here> [hours]*`,
        msg
      );
      return true;
    }

    let targetStr = rest;
    let hours = 8;

    // Parse optional trailing hours (e.g. "/livelocation Mum 8" or "/livelocation The Big P : 8")
    const quoteMatch = rest.match(/^["']([^"']+)["'](?:\s+(\d+(?:\.\d+)?)h?)?$/i);
    const sepMatch = !quoteMatch && rest.match(/^([^:|]+?)\s*[:|]\s*(\d+(?:\.\d+)?)h?$/i);
    const trailingNumMatch =
      !quoteMatch && !sepMatch && rest.match(/^([\s\S]+?)\s+(\d+(?:\.\d+)?)h?$/i);

    if (quoteMatch) {
      targetStr = quoteMatch[1].trim();
      if (quoteMatch[2]) hours = parseFloat(quoteMatch[2]);
    } else if (sepMatch) {
      targetStr = sepMatch[1].trim();
      hours = parseFloat(sepMatch[2]);
    } else if (trailingNumMatch) {
      targetStr = trailingNumMatch[1].trim();
      hours = parseFloat(trailingNumMatch[2]);
    }

    const isHere = ['HERE', 'SELF', 'ME', 'CHAT'].includes(targetStr.toUpperCase());
    const targetJid = isHere ? jid : resolveContactTarget(msg, targetStr);

    if (!targetJid) {
      await sendReply(
        sock,
        jid,
        `❌ Could not find contact *"${targetStr}"*.\nTry */livelocation "${targetStr}" 8* or use their phone number.`,
        msg
      );
      return true;
    }

    await reactToMessage(sock, msg, '📍');
    try {
      const locInfo = await startLiveLocationShare(sock, targetJid, hours, '', msg);
      const displayTarget = isHere ? 'this chat' : locInfo.targetName;
      await sendReply(
        sock,
        jid,
        `📍 Sharing live location with *${displayTarget}* for ${locInfo.hours}h (until ${locInfo.endTimeFormatted}).`,
        msg
      );
    } catch (err) {
      await sendReply(sock, jid, `❌ Failed to share live location: ${err.message}`, msg);
    }
    return true;
  }

  if (cmd === '/confirm' || cmd === '/sendemail') {
    if (!owner) {
      await sendReply(sock, jid, `🔒 Only the bot owner can confirm and send emails.`, msg);
      return true;
    }

    const draft = state.pendingEmailDrafts?.[jid];
    if (!draft) {
      await sendReply(
        sock,
        jid,
        `ℹ️ No pending email draft in this chat.`,
        msg
      );
      return true;
    }

    await reactToMessage(sock, msg, '⏳');
    try {
      await sendEmailWithAttachments({
        to: draft.to,
        subject: draft.subject,
        body: draft.body,
        attachmentPaths: draft.attachments || [],
      });

      delete state.pendingEmailDrafts[jid];
      persistFresh((fresh) => {
        if (fresh.pendingEmailDrafts?.[jid]) delete fresh.pendingEmailDrafts[jid];
      });

      await reactToMessage(sock, msg, '📧');
      await sendReply(
        sock,
        jid,
        `📧 Sent email to \`${draft.to}\` ("${draft.subject}").`,
        msg
      );
    } catch (mailErr) {
      if (mailErr.code === 'SMTP_NOT_CONFIGURED') {
        await sendReply(
          sock,
          jid,
          `⚠️ SMTP not configured. Run */mailsetup your.email@gmail.com <app-password>* then reply *confirm*.`,
          msg
        );
      } else {
        await sendReply(
          sock,
          jid,
          `❌ *Failed to send email to \`${draft.to}\`:*\n${mailErr.message}`,
          msg
        );
      }
    }
    return true;
  }

  if (cmd === '/cancel' || cmd === '/discard') {
    if (!owner) {
      await sendReply(sock, jid, `🔒 Only the bot owner can discard email drafts.`, msg);
      return true;
    }
    const draft = state.pendingEmailDrafts?.[jid];
    if (!draft) {
      await sendReply(sock, jid, `ℹ️ No pending email draft to cancel.`, msg);
      return true;
    }
    delete state.pendingEmailDrafts[jid];
    persistFresh((fresh) => {
      if (fresh.pendingEmailDrafts?.[jid]) delete fresh.pendingEmailDrafts[jid];
    });
    await reactToMessage(sock, msg, '🗑️');
    await sendReply(
      sock,
      jid,
      `🗑️ *Email draft to \`${draft.to}\` ("${draft.subject}") has been discarded.*`,
      msg
    );
    return true;
  }

  if (cmd === '/mailsetup') {
    if (!owner) {
      await sendReply(sock, jid, `🔒 Only the bot owner can configure email settings.`, msg);
      return true;
    }
    if (!arg1 || !arg2) {
      const currentSmtp = getSmtpConfig();
      await sendReply(
        sock,
        jid,
        `📧 SMTP: ${currentSmtp.user ? `\`${currentSmtp.user}\`` : '_Not configured_'}\nUsage: */mailsetup your.email@gmail.com <app-password>*`,
        msg
      );
      return true;
    }

    const emailUser = arg1.trim();
    const appPass = arg2.replace(/\s+/g, '').trim();
    const savedSmtp = {
      host: CONFIG.smtpHost || 'smtp.gmail.com',
      port: CONFIG.smtpPort || 465,
      user: emailUser,
      pass: appPass,
    };
    persistFresh((fresh) => {
      fresh.smtp = savedSmtp;
    });

    await sendReply(
      sock,
      jid,
      `✅ SMTP configured for \`${emailUser}\`.`,
      msg
    );
    return true;
  }

  if (cmd === '/send') {
    if (!owner) {
      await sendReply(
        sock,
        jid,
        `🔒 Only the bot owner can access and send local files from the PC.`,
        msg
      );
      return true;
    }

    const rest = commandBody.trim().replace(/^\/send\s*/i, '').trim();
    if (!rest) {
      await sendReply(
        sock,
        jid,
        `⚠️ Usage:\n• */send <filename or path>* (sends the file to this chat)\n• */send <Contact Name> : <filename or path>* (sends the file to a contact)`,
        msg
      );
      return true;
    }

    const projectDir = boundProject ? state.projects?.[boundProject] : os.homedir();
    let targetJid = jid;
    let targetLabel = 'this chat';
    let fileQuery = rest;

    // 1. Quoted contact name followed by file: /send "The Big P" resume.pdf
    const quoteMatch = rest.match(/^["']([^"']+)["']\s+([\s\S]+)$/);
    // 2. Colon or pipe separator: /send The Big P : resume.pdf
    const sepMatch = !quoteMatch && rest.match(/^([^:|]+?)\s*[:|]\s*([\s\S]+)$/);

    // Avoid running the expensive recursive file search more than needed:
    // if the whole input is a file, send it here; otherwise try contact + file.
    let foundFile = findLocalFile(rest, projectDir);
    if (foundFile) {
      fileQuery = rest;
    } else if (quoteMatch || sepMatch) {
      const m = quoteMatch || sepMatch;
      const candidateTarget = m[1].trim();
      const candidateFile = m[2].trim();
      const resolvedContact = resolveContactTarget(msg, candidateTarget);
      if (resolvedContact) {
        targetJid = resolvedContact;
        const contacts = loadContactsMap();
        targetLabel = contacts[resolvedContact] || candidateTarget;
        fileQuery = candidateFile;
        foundFile = findLocalFile(fileQuery, projectDir);
      }
    }
    if (!foundFile) {
      await sendReply(
        sock,
        jid,
        `❌ File not found: \`${fileQuery}\``,
        msg
      );
      return true;
    }

    try {
      await reactToMessage(sock, msg, '📎');
      await sendWhatsAppFile(
        sock,
        targetJid,
        foundFile,
        `📎 \`${path.basename(foundFile)}\``,
        targetJid === jid ? msg : undefined
      );
      if (targetJid !== jid) {
        await sendReply(
          sock,
          jid,
          `📎 Sent \`${path.basename(foundFile)}\` to *${targetLabel}*.`,
          msg
        );
      }
    } catch (err) {
      await sendReply(
        sock,
        jid,
        `❌ Failed to send file \`${foundFile}\`: ${err.message}`,
        msg
      );
    }
    return true;
  }

  if (cmd === '/msg' || cmd === '/dm') {
    if (!owner) {
      await sendReply(
        sock,
        jid,
        `🔒 Only the bot owner can send messages to contacts.`,
        msg
      );
      return true;
    }

    const rest = commandBody.trim().replace(/^\/(msg|dm)\s*/i, '').trim();
    if (!rest) {
      await sendReply(
        sock,
        jid,
        `⚠️ Usage: */msg <Contact or Number> : <message>*`,
        msg
      );
      return true;
    }

    let targetStr = '';
    let messageText = '';

    // 1. Quoted contact name: /msg "The Big P" hi
    const quoteMatch = rest.match(/^["']([^"']+)["']\s+([\s\S]+)$/);
    // 2. Colon or pipe separator: /msg The Big P : hi
    const sepMatch = !quoteMatch && rest.match(/^([^:|]+?)\s*[:|]\s*([\s\S]+)$/);

    if (quoteMatch) {
      targetStr = quoteMatch[1].trim();
      messageText = quoteMatch[2].trim();
    } else if (sepMatch) {
      targetStr = sepMatch[1].trim();
      messageText = sepMatch[2].trim();
    } else {
      // 3. Unquoted multi-word matching: test longest prefix down to 1 word against known contacts
      const words = rest.split(/\s+/);
      if (words.length < 2) {
        await sendReply(
          sock,
          jid,
          `⚠️ Please include both a contact and a message (e.g. */msg "The Big P" hi* or */msg The Big P : hi*).`,
          msg
        );
        return true;
      }

      let matchedJid = null;
      // Pass 1: Exact contact name match (longest prefix first)
      for (let i = words.length - 1; i >= 1; i--) {
        const candidateName = words.slice(0, i).join(' ');
        const resolved = resolveContactTarget(msg, candidateName, { exactOnly: true });
        if (resolved) {
          targetStr = candidateName;
          messageText = words.slice(i).join(' ');
          matchedJid = resolved;
          break;
        }
      }
      // Pass 2: Partial contact name match (longest prefix first)
      if (!matchedJid) {
        for (let i = words.length - 1; i >= 1; i--) {
          const candidateName = words.slice(0, i).join(' ');
          const resolved = resolveContactTarget(msg, candidateName, { exactOnly: false });
          if (resolved) {
            targetStr = candidateName;
            messageText = words.slice(i).join(' ');
            matchedJid = resolved;
            break;
          }
        }
      }

      if (!matchedJid) {
        await sendReply(
          sock,
          jid,
          `❌ Could not match contact in "${rest}". Try */msg Name : message*.`,
          msg
        );
        return true;
      }
    }

    if (!messageText) {
      await sendReply(
        sock,
        jid,
        `⚠️ Please include a message to send (e.g. */msg "${targetStr}" hi*).`,
        msg
      );
      return true;
    }

    const targetJid = resolveContactTarget(msg, targetStr);
    if (!targetJid) {
      await sendReply(
        sock,
        jid,
        `❌ Contact "${targetStr}" not found. Tag them or use their phone number.`,
        msg
      );
      return true;
    }

    try {
      const sentDm = await sock.sendMessage(targetJid, { text: messageText });
      if (sentDm?.key?.id) recordSentMessageId(sentDm.key.id);
      const contacts = loadContactsMap();
      const displayTarget = contacts[targetJid] || targetStr;
      await reactToMessage(sock, msg, '📨');
      await sendReply(
        sock,
        jid,
        `📨 Sent to *${displayTarget}*: "${messageText}"`,
        msg
      );
    } catch (err) {
      await sendReply(
        sock,
        jid,
        `❌ Failed to message \`${targetStr}\`: ${err.message}`,
        msg
      );
    }
    return true;
  }

  // --- GITHUB COLLABORATOR MANAGEMENT (/collab, /removecollab, /collabs) ---
  if (
    [
      '/collab',
      '/addcollab',
      '/collaborator',
      '/addcollaborator',
      '/invite',
      '/removecollab',
      '/uncollab',
      '/removeinvite',
      '/collabs',
      '/collaborators',
    ].includes(cmd)
  ) {
    if (!owner) {
      await sendReply(
        sock,
        jid,
        `🔒 Only the bot owner can manage GitHub collaborators.`,
        msg
      );
      return true;
    }

    const resolveTargetRepoAndDir = (repoArg) => {
      if (repoArg) {
        const aliasKey = repoArg.toLowerCase();
        if (state.projects?.[repoArg]) {
          return { projectDir: state.projects[repoArg], repoInput: '' };
        }
        if (state.projects?.[aliasKey]) {
          return { projectDir: state.projects[aliasKey], repoInput: '' };
        }
        return {
          projectDir: boundProject ? state.projects?.[boundProject] : '',
          repoInput: repoArg,
        };
      }
      return {
        projectDir: boundProject ? state.projects?.[boundProject] : '',
        repoInput: '',
      };
    };

    if (cmd === '/collabs' || cmd === '/collaborators') {
      const { projectDir: targetProjDir, repoInput } = resolveTargetRepoAndDir(arg1);
      await reactToMessage(sock, msg, '⏳');
      try {
        const info = await listGitHubCollaborators({
          projectDir: targetProjDir,
          repoInput,
        });
        const collabLines = info.collaborators.map(
          (c) => `• *@${c.username}* (${c.roleName})`
        );
        const invLines = info.pendingInvitations.map(
          (inv) => `• *@${inv.username}* _(pending ${inv.permission} invite)_`
        );
        await reactToMessage(sock, msg, '✅');
        await sendReply(
          sock,
          jid,
          [
            `👥 *Collaborators on \`${info.owner}/${info.repo}\`:*`,
            collabLines.length > 0 ? collabLines.join('\n') : '_None_',
            invLines.length > 0
              ? `\n⏳ *Pending Invitations:*\n${invLines.join('\n')}`
              : null,
          ]
            .filter(Boolean)
            .join('\n'),
          msg
        );
      } catch (err) {
        await reactToMessage(sock, msg, '❌');
        await sendReply(sock, jid, `❌ ${err.message}`, msg);
      }
      return true;
    }

    if (['/removecollab', '/uncollab', '/removeinvite'].includes(cmd)) {
      if (!arg1) {
        await sendReply(
          sock,
          jid,
          `⚠️ Usage: */removecollab <github-username> [repo-or-project]*`,
          msg
        );
        return true;
      }
      const { projectDir: targetProjDir, repoInput } = resolveTargetRepoAndDir(
        parts[2] || ''
      );
      await reactToMessage(sock, msg, '⏳');
      try {
        const res = await removeGitHubCollaborator({
          username: arg1,
          projectDir: targetProjDir,
          repoInput,
        });
        await reactToMessage(sock, msg, '🗑️');
        await sendReply(
          sock,
          jid,
          res.status === 'invitation_cancelled'
            ? `🗑️ Cancelled pending invitation for *@${res.username}* on \`${res.owner}/${res.repo}\`.`
            : `🗑️ Removed *@${res.username}* from \`${res.owner}/${res.repo}\`.`,
          msg
        );
      } catch (err) {
        await reactToMessage(sock, msg, '❌');
        await sendReply(sock, jid, `❌ ${err.message}`, msg);
      }
      return true;
    }

    // Otherwise: /collab, /addcollab, /collaborator, /addcollaborator, /invite
    if (!arg1) {
      await sendReply(
        sock,
        jid,
        `⚠️ Usage: */collab <github-username> [repo-or-project] [read|write|admin]*`,
        msg
      );
      return true;
    }

    const permKeywords = new Set([
      'read',
      'pull',
      'view',
      'triage',
      'write',
      'push',
      'maintain',
      'maintainer',
      'admin',
      'owner',
    ]);
    let repoArg = '';
    let permArg = 'push';
    let notifyEmail = '';

    for (const token of parts.slice(2)) {
      const cleanedToken = token.replace(/^[,;()]+|[,;()]+$/g, '');
      if (!cleanedToken) continue;
      if (cleanedToken.includes('@') && cleanedToken.includes('.')) {
        notifyEmail = cleanedToken;
      } else if (permKeywords.has(cleanedToken.toLowerCase())) {
        permArg = cleanedToken.toLowerCase();
      } else if (!repoArg) {
        repoArg = cleanedToken;
      }
    }

    const { projectDir: targetProjDir, repoInput } = resolveTargetRepoAndDir(repoArg);
    await reactToMessage(sock, msg, '⏳');
    try {
      const res = await addGitHubCollaborator({
        username: arg1,
        permission: permArg,
        projectDir: targetProjDir,
        repoInput,
      });
      const invLink = `https://github.com/${res.owner}/${res.repo}/invitations`;
      let emailNotice = '';
      if (notifyEmail) {
        try {
          const smtp = getSmtpConfig();
          if (smtp.user && smtp.pass) {
            await sendEmailWithAttachments({
              to: notifyEmail,
              subject: `GitHub Collaborator Invitation: ${res.owner}/${res.repo}`,
              body: `Hi @${res.username},\n\nYou have been invited as a collaborator (${res.permission} access) on the GitHub repository ${res.owner}/${res.repo}.\n\nAccept your invitation here:\n${invLink}\n\nRepository URL:\nhttps://github.com/${res.owner}/${res.repo}`,
              attachmentPaths: [],
            });
            emailNotice = `\n📧 Sent invite link to \`${notifyEmail}\`.`;
          }
        } catch {
          // Ignore optional email notification errors
        }
      }
      await reactToMessage(sock, msg, '🤝');
      await sendReply(
        sock,
        jid,
        res.status === 'already_collaborator'
          ? `✅ *@${res.username}* is already a collaborator on \`${res.owner}/${res.repo}\` (${res.permission}).${emailNotice}`
          : `🤝 Invited *@${res.username}* to \`${res.owner}/${res.repo}\` (${res.permission}) — ${invLink}${emailNotice}`,
        msg
      );
    } catch (err) {
      await reactToMessage(sock, msg, '❌');
      await sendReply(sock, jid, `❌ ${err.message}`, msg);
    }
    return true;
  }

  if (cmd === '/screenshot' || cmd === '/ss' || cmd === '/qa') {
    let rawTarget = parts.slice(1).join(' ').trim();
    const isMobile = rawTarget.toLowerCase().includes('mobile') || parts.includes('--mobile');
    rawTarget = rawTarget.replace(/--mobile|\bmobile\b/gi, '').trim();

    const currentState = loadProjectsState();
    const activeProj = isGroup ? currentState.groupBindings?.[jid] : currentState.activeProject;
    const projDir = (activeProj && currentState.projects?.[activeProj]) || CONFIG.defaultProjectDir;

    let cleanedTarget = rawTarget;
    if (!cleanedTarget) {
      cleanedTarget = (await getProjectDeploymentUrl(projDir, activeProj)) || 'http://localhost:3000';
    }

    await reactToMessage(sock, msg, '📸');
    try {
      const { filePath, url, width, height } = await captureWebScreenshot(cleanedTarget, {
        mobile: isMobile,
      });
      const projectLabel = activeProj ? `\n📁 *Project:* \`${activeProj}\`` : '';
      await sendWhatsAppFile(
        sock,
        jid,
        filePath,
        `📸 *Visual QA Screenshot*${projectLabel}\n🌐 *URL:* ${url}\n📐 *Resolution:* ${width}x${height}${isMobile ? ' (Mobile)' : ''}`,
        msg
      );
      await reactToMessage(sock, msg, '✅');
    } catch (err) {
      await reactToMessage(sock, msg, '❌');
      await sendReply(
        sock,
        jid,
        `❌ *Screenshot Failed:*\n${err.message}`,
        msg
      );
    }
    return true;
  }

  if (cmd === '/push') {
    if (!boundProject || !state.projects[boundProject]) {
      await sendReply(sock, jid, `⚠️ No project bound to this chat.`, msg);
      return true;
    }
    const commitMsg =
      parts.slice(1).join(' ').trim() || 'Update via WhatsApp Agent';
    await reactToMessage(sock, msg, '⏳');
    try {
      const info = gitCommitAndPush(state.projects[boundProject], commitMsg);
      await reactToMessage(sock, msg, '🚀');
      await sendReply(
        sock,
        jid,
        `🚀 Pushed \`${boundProject}\` to \`${info.branch}\` (\`${info.commitHash}\`).`,
        msg
      );
    } catch (err) {
      await reactToMessage(sock, msg, '❌');
      await sendReply(
        sock,
        jid,
        `❌ *Git Push Failed on \`${boundProject}\`:*\n${err.message}`,
        msg
      );
    }
    return true;
  }

  if (cmd === '/autopush') {
    if (!owner) {
      await sendReply(
        sock,
        jid,
        `🔒 Only the bot owner can toggle auto-push.`,
        msg
      );
      return true;
    }
    if (!boundProject || !state.projects[boundProject]) {
      await sendReply(sock, jid, `⚠️ No project bound to this chat. Bind one first with */bind <project>*.`, msg);
      return true;
    }
    const enable = arg1?.toLowerCase() !== 'off';
    persistFresh((fresh) => {
      fresh.autoPush = fresh.autoPush || {};
      fresh.autoPush[boundProject] = enable;
    });
    await sendReply(
      sock,
      jid,
      `🚀 Auto-push to GitHub for *${boundProject}* is now *${enable ? 'ON' : 'OFF'}*.`,
      msg
    );
    return true;
  }

  // --- OWNER-ONLY COMMANDS (/bind, /unbind, /projects, /project, /addproject) ---
  if (
    ['/bind', '/unbind', '/projects', '/project', '/addproject'].includes(cmd)
  ) {
    if (!owner) {
      await sendReply(
        sock,
        jid,
        `🔒 Only the bot owner can manage project bindings.`,
        msg
      );
      return true;
    }

    if (cmd === '/bind') {
      if (!arg1) {
        await sendReply(
          sock,
          jid,
          `⚠️ Usage: *${CONFIG.triggerPrefix} /bind <project-alias>*\nExample: *${CONFIG.triggerPrefix} /bind wisewallets*`,
          msg
        );
        return true;
      }
      const key = arg1.toLowerCase();
      const matchedAlias = state.projects[arg1]
        ? arg1
        : state.projects[key]
        ? key
        : null;

      if (!matchedAlias) {
        await sendReply(
          sock,
          jid,
          `❌ Project \`${arg1}\` not found.\nSend *${CONFIG.triggerPrefix} /projects* in your private chat to see available projects, or *${CONFIG.triggerPrefix} /addproject ${arg1} ~/path/to/folder*.`,
          msg
        );
        return true;
      }

      state.groupBindings = state.groupBindings || {};
      state.groupBindings[jid] = matchedAlias;
      if (state.disabledGroups?.[jid]) {
        delete state.disabledGroups[jid];
      }
      persistFresh((fresh) => {
        fresh.groupBindings = fresh.groupBindings || {};
        fresh.groupBindings[jid] = matchedAlias;
        if (fresh.disabledGroups?.[jid]) delete fresh.disabledGroups[jid];
      });

      await sendReply(
        sock,
        jid,
        `🔒 Bound this group to \`${matchedAlias}\`.`,
        msg
      );
      return true;
    }

    if (cmd === '/unbind') {
      if (state.groupBindings?.[jid]) {
        const prev = state.groupBindings[jid];
        persistFresh((fresh) => {
          if (fresh.groupBindings?.[jid]) delete fresh.groupBindings[jid];
        });
        await sendReply(
          sock,
          jid,
          `🔓 Unlinked this group from \`${prev}\`.`,
          msg
        );
      } else {
        await sendReply(sock, jid, `ℹ️ This group is not bound to any project.`, msg);
      }
      return true;
    }

    if (cmd === '/projects') {
      const lines = Object.entries(state.projects).map(([alias, dir]) => {
        return `• *${alias}* → \`${dir}\``;
      });
      await sendReply(
        sock,
        jid,
        `📂 *Projects:*\n${lines.join('\n')}`,
        msg
      );
      return true;
    }

    if (cmd === '/project') {
      if (!arg1) {
        await sendReply(
          sock,
          jid,
          `⚠️ Usage: *${CONFIG.triggerPrefix} /project <alias>*`,
          msg
        );
        return true;
      }
      const key = arg1.toLowerCase();
      const matchedAlias = state.projects[arg1]
        ? arg1
        : state.projects[key]
        ? key
        : null;
      if (!matchedAlias) {
        await sendReply(sock, jid, `❌ Project \`${arg1}\` not found.`, msg);
        return true;
      }
      if (isGroup) {
        persistFresh((fresh) => {
          fresh.groupBindings = fresh.groupBindings || {};
          fresh.groupBindings[jid] = matchedAlias;
        });
        await sendReply(
          sock,
          jid,
          `🔒 Bound this group to project *${matchedAlias}*.`,
          msg
        );
      } else {
        persistFresh((fresh) => {
          fresh.activeProject = matchedAlias;
        });
        await sendReply(
          sock,
          jid,
          `✅ Active project switched to *${matchedAlias}*.`,
          msg
        );
      }
      return true;
    }

    if (cmd === '/addproject') {
      if (!arg1 || !arg2) {
        await sendReply(
          sock,
          jid,
          `⚠️ Usage: *${CONFIG.triggerPrefix} /addproject <alias> <path>*`,
          msg
        );
        return true;
      }
      const resolvedPath = arg2.startsWith('~')
        ? path.join(os.homedir(), arg2.slice(1))
        : path.resolve(ROOT_DIR, arg2);

      let isDir = false;
      try {
        isDir = fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory();
      } catch {
        isDir = false;
      }
      if (!isDir) {
        await sendReply(
          sock,
          jid,
          `❌ Directory does not exist: \`${resolvedPath}\``,
          msg
        );
        return true;
      }

      const alias = arg1.toLowerCase();
      persistFresh((fresh) => {
        fresh.projects = fresh.projects || {};
        fresh.projects[alias] = resolvedPath;
      });

      await sendReply(
        sock,
        jid,
        `✅ Registered *${alias}* → \`${resolvedPath}\`.`,
        msg
      );
      return true;
    }
  }

  if (cmd === '/status') {
    const active = getActiveTaskInfo();
    if (!active) {
      await sendReply(
        sock,
        jid,
        `🟢 Idle (Queued: ${taskQueue.length})`,
        msg
      );
    } else {
      await sendReply(
        sock,
        jid,
        `🟡 Busy on \`${active.projectAlias}\`: "${active.taskPrompt}" (Queued: ${taskQueue.length})`,
        msg
      );
    }
    return true;
  }

  if (cmd === '/stop') {
    const quotedId = getQuotedStanzaId(msg);

    // 1. If the user swipe-replied "stop" to a specific queued task message, remove that queued task!
    if (quotedId) {
      const qIdx = taskQueue.findIndex((item) => item.msg?.key?.id === quotedId);
      if (qIdx !== -1) {
        const [removed] = taskQueue.splice(qIdx, 1);
        await reactToMessage(sock, msg, '🛑');
        await reactToMessage(sock, removed.msg, '🛑');
        await sendReply(sock, jid, `🛑 Cancelled queued task.`, msg);
        return true;
      }
    }

    const active = getActiveTaskInfo();
    // Only allow stopping if owner OR if the running task belongs to this group's bound project
    if (active && !owner && isGroup && active.projectAlias !== boundProject) {
      await sendReply(
        sock,
        jid,
        `🔒 Cannot stop a task running for another group.`,
        msg
      );
      return true;
    }
    const runningMsg = currentRunningItem?.msg;
    const stopped = stopActiveTask();
    if (stopped) {
      await reactToMessage(sock, msg, '🛑');
      if (runningMsg) {
        await reactToMessage(sock, runningMsg, '🛑');
      }
      await sendReply(
        sock,
        jid,
        `🛑 Stopped task.`,
        msg
      );
    } else {
      await sendReply(sock, jid, `ℹ️ No task is currently running.`, msg);
    }
    return true;
  }

  return false;
}

let activeSock = null;
let reconnectTimer = null;
let isStartingBot = false;
const BOT_START_TIME_SEC = Math.floor(Date.now() / 1000);

/**
 * Starts the Baileys WhatsApp client and listens for group/direct messages.
 */
export async function startWhatsAppBot() {
  if (isStartingBot) return;
  isStartingBot = true;

  if (activeSock) {
    try { activeSock.ev.removeAllListeners(); } catch {}
    try { activeSock.ws?.close(); } catch {}
    activeSock = null;
  }

  let sock;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      markOnlineOnConnect: true,
      shouldSyncHistoryMessage: () => false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      defaultQueryTimeoutMs: 60000,
    });
    activeSock = sock;

    if (CONFIG.pairingPhoneNumber && !sock.authState.creds.registered) {
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(CONFIG.pairingPhoneNumber);
          console.log(`\n========================================`);
          console.log(`🔑 WHATSAPP PAIRING CODE: ${code}`);
          console.log(`========================================\n`);
        } catch (err) {
          console.error('Failed to request pairing code:', err.message);
        }
      }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('contacts.upsert', (contacts) => saveContactsList(contacts));
    sock.ev.on('contacts.update', (contacts) => saveContactsList(contacts));
    sock.ev.on('chats.upsert', (chats) => saveContactsList(chats));
    sock.ev.on('messaging-history.set', ({ contacts, chats }) => {
      if (contacts) saveContactsList(contacts);
      if (chats) saveContactsList(chats);
    });

    let acceptMessagesAfter = Date.now() + 3000;

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n📱 Scan this QR code with WhatsApp (Linked Devices -> Link a Device):\n');
        qrcode.generate(qr, { small: true });
        const qrPath = path.join(ROOT_DIR, 'whatsapp-qr.png');
        QRCodeImage.toFile(qrPath, qr, { width: 400, margin: 2 }).catch(() => {});
        console.log(`🖼️ QR Code image generated at: ${qrPath}`);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(
          `⚠️ Connection closed (status: ${statusCode}). Reconnecting: ${shouldReconnect}`
        );

        if (activeSock === sock) {
          try { sock.ev.removeAllListeners(); } catch {}
          try { sock.ws?.close(); } catch {}
          activeSock = null;
        }

        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (shouldReconnect) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            startWhatsAppBot();
          }, 3500);
        } else {
          console.log(
            `❌ Logged out. Delete '${AUTH_DIR}' and restart to scan QR code again.`
          );
        }
      } else if (connection === 'open') {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        acceptMessagesAfter = Date.now() + 3000;
        const projState = loadProjectsState();
        const boundCount = Object.keys(projState.groupBindings || {}).length;
        console.log('\n========================================');
        console.log('✅ WhatsApp Antigravity Agent is ONLINE!');
        console.log(`📣 Trigger Prefix : ${CONFIG.triggerPrefix}`);
        console.log(`🔒 Bound Groups   : ${boundCount} group(s)`);
        console.log('========================================\n');
        console.log(
          `💡 Go to any project group and send "${CONFIG.triggerPrefix} /bind <project-name>" to lock that group to its project!\n`
        );

        // Ensure server has fresh pre-keys so incoming messages from all group members decrypt cleanly
        sock.uploadPreKeysToServerIfRequired().catch(() => {});
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return;

      const nowSec = Math.floor(Date.now() / 1000);

      for (const msg of messages) {
        try {
          await handleIncomingMessage(sock, msg, type, nowSec, acceptMessagesAfter);
        } catch (err) {
          console.error('⚠️ Error handling WhatsApp message:', err?.message || err);
        }
      }
    });
  } finally {
    isStartingBot = false;
  }
}

async function handleIncomingMessage(sock, msg, type, nowSec, acceptMessagesAfter = 0) {
      if (process.env.DEBUG_MSGS === 'true') {
        try {
          const dbg = unwrapMessage(msg);
          console.log(
            `🔍 [MSG] type=${type} jid=${msg.key?.remoteJid} fromMe=${msg.key?.fromMe} id=${msg.key?.id} keys=${dbg ? Object.keys(dbg).join(',') : 'null'}`
          );
        } catch {
          // Ignore debug errors
        }
      }
      if (!msg.message || !msg.key?.remoteJid) return;
      if (msg.key.remoteJid === 'status@broadcast') return;

      // Record sender's pushName so we can message them by name later
      if (msg.pushName && !msg.key.fromMe) {
        const senderJid = msg.key.participant || msg.key.remoteJid;
        if (senderJid) {
          saveContactsList([{ id: senderJid, notify: msg.pushName }]);
        }
      }

      // Only ignore stale backlog messages from before this bot process was started (with 60s grace window)
      // Never drop messages sent while the bot was running or reconnecting!
      const msgTime = Number(msg.messageTimestamp || 0);
      if (msgTime > 0 && msgTime < BOT_START_TIME_SEC - 60) {
        return;
      }

      // Never process messages sent by the bot itself or already processed
      if (!msg.key.id) return;
      if (sentMessageIds.has(msg.key.id) || processedMessageIds.has(msg.key.id)) return;

      // Skip text-less messages (stickers, reactions, location-only pings
      // without captions are handled via their captions/attachment download).
      const text = extractMessageText(msg);
      const audioMsg = extractAudioMessage(msg);
      const hasAttachment =
        !!extractDocumentMessage(msg) ||
        !!extractImageMessage(msg) ||
        !!extractVideoMessage(msg) ||
        !!audioMsg;

      console.log(`🔍 [Incoming Msg] JID=${msg.key?.remoteJid} fromMe=${msg.key?.fromMe} text="${text}" hasAudio=${!!audioMsg} hasAttach=${hasAttachment}`);

      if (text && msg.key?.remoteJid) {
        const senderDisplay = msg.pushName || (msg.key?.fromMe ? 'Owner' : getSenderNumber(msg));
        recordChatMessage(msg.key.remoteJid, {
          sender: senderDisplay,
          text,
          timestamp: Number(msg.messageTimestamp || 0) * 1000 || Date.now(),
          quotedText: extractQuotedText(msg),
        });
      }

      if (!text && !hasAttachment) return;

      const rawTriggeredBody = extractTriggeredBody(sock, msg, text);
      if (rawTriggeredBody === null) {
        console.log(`⏭️ Not triggered: text="${text}" hasAudio=${!!audioMsg}`);
        return;
      }

      recordProcessedMessageId(msg.key.id);

      console.log(
        `📩 [WhatsApp Trigger] JID=${msg.key.remoteJid} | fromMe=${msg.key.fromMe} | rawBody="${rawTriggeredBody}"`
      );

      if (!isSenderAuthorized(msg)) {
        console.log(`🔒 Ignored unauthorized sender: ${getSenderNumber(msg)}`);
        return;
      }

      const jid = msg.key.remoteJid;
      const isGroup = jid.endsWith('@g.us');
      const owner = isOwner(msg);
      const currentState = loadProjectsState();
      let rawBody = rawTriggeredBody;

      // Handle voice notes / audio messages: transcribe voice note into text prompt!
      if (audioMsg) {
        try {
          await reactToMessage(sock, msg, '🎙️');
          const boundProj = isGroup ? currentState.groupBindings?.[jid] : currentState.activeProject;
          const targetProjDir =
            (boundProj && currentState.projects?.[boundProj]) || CONFIG.defaultProjectDir;

          const downloadedAudio = await downloadWhatsAppAttachment(msg, targetProjDir);
          if (!downloadedAudio?.filePath) {
            console.warn(`⚠️ Failed to download voice note audio attachment from ${jid}`);
            await reactToMessage(sock, msg, '❌');
            await sendReply(
              sock,
              jid,
              `⚠️ Failed to download the voice note from WhatsApp. Please try sending again.`,
              msg
            );
            return;
          }

          console.log(`🎙️ Transcribing voice note from ${jid}: ${downloadedAudio.filePath}`);
          const transcribedText = await transcribeAudioFile(downloadedAudio.filePath);

          if (transcribedText) {
            console.log(`🗣️ Transcribed text: "${transcribedText}"`);
            const isDirectAudio = !!unwrapMessage(msg)?.audioMessage;
            if (isDirectAudio) {
              // Audio is attached to the current message
              if (rawBody && rawBody !== transcribedText) {
                rawBody = `${rawBody} (Voice Note: "${transcribedText}")`;
              } else {
                rawBody = transcribedText;
              }
            } else {
              // Audio was quoted/replied to by the user (e.g. user swiped voice note and sent "@agent" or "@agent fix this")
              if (!rawBody || rawBody.toLowerCase() === CONFIG.triggerPrefix || isStopWord(rawBody)) {
                rawBody = transcribedText;
              } else {
                rawBody = `${rawBody}\n\nTranscribed Quoted Voice Note: "${transcribedText}"`;
              }
            }
            recordChatMessage(jid, {
              sender: msg.pushName || (msg.key?.fromMe ? 'Owner' : getSenderNumber(msg)),
              text: `[Voice Note]: "${transcribedText}"`,
              timestamp: Number(msg.messageTimestamp || 0) * 1000 || Date.now(),
              quotedText: extractQuotedText(msg),
            });
          } else {
            console.warn('⚠️ Voice note transcription returned empty string.');
            await reactToMessage(sock, msg, '❌');
            if (!rawBody || rawBody.toLowerCase() === CONFIG.triggerPrefix) {
              await sendReply(
                sock,
                jid,
                `🎙️ Couldn't detect clear speech in that voice note. Please speak clearly or send text.`,
                msg
              );
              return;
            }
          }
        } catch (sttErr) {
          console.error('⚠️ Voice transcription failed:', sttErr?.message || sttErr);
          await reactToMessage(sock, msg, '❌');
          if (!rawBody || rawBody.toLowerCase() === CONFIG.triggerPrefix) {
            await sendReply(
              sock,
              jid,
              `⚠️ Failed to transcribe voice note: ${sttErr?.message || sttErr}`,
              msg
            );
            return;
          }
        }
      }

      // Never allow non-owners to trigger the agent in private 1-on-1 DMs!
      if (!isGroup && !owner) {
        console.log(`🔒 Ignored non-owner DM trigger from: ${jid}`);
        return;
      }

      // If this is an unbound group and a non-owner tries to message @agent, stay completely silent!
      if (isGroup && !currentState.groupBindings?.[jid] && !owner) {
        console.log(`🔒 Ignored non-owner trigger in unbound group: ${jid}`);
        return;
      }

      // If this group was shut down via /shutdown, completely ignore non-owners!
      if (isGroup && currentState.disabledGroups?.[jid] && !owner) {
        console.log(`🛑 Ignored non-owner trigger in shut-down group: ${jid}`);
        return;
      }

      const quotedText = extractQuotedText(msg);
      const replyingToBot = isReplyingToBot(msg);

      // If user sent just "@agent" while quoting a message, use the quoted message as the task!
      if (!rawBody && quotedText && !replyingToBot) {
        rawBody = quotedText;
      }

      if (!rawBody) {
        if (!text && hasAttachment && !audioMsg) {
          rawBody = '(uploaded a file with no caption — inspect the attachment and describe what you see)';
        } else {
          await handleSlashCommand(sock, jid, msg, '/help');
          return;
        }
      }

      if (
        owner &&
        currentState.pendingEmailDrafts?.[jid] &&
        ['confirm', 'send', 'send it', 'yes', 'yes send', 'yes, send', 'send now', 'confirm send', 'cancel', 'discard'].includes(
          rawBody.toLowerCase().trim()
        )
      ) {
        const lowerCmd = rawBody.toLowerCase().trim();
        rawBody = lowerCmd === 'cancel' || lowerCmd === 'discard' ? '/cancel' : '/confirm';
      }

      // Handle owner response to a pending project confirmation
      if (owner && currentState.pendingProjectConfirmations?.[jid]) {
        const pending = currentState.pendingProjectConfirmations[jid];
        const lowerResp = rawBody.toLowerCase().trim();

        // 1. Cancel / Discard
        if (['cancel', 'discard', 'no', 'stop', 'nevermind', 'abort'].includes(lowerResp)) {
          delete currentState.pendingProjectConfirmations[jid];
          saveProjectsState(currentState);
          await reactToMessage(sock, msg, '🗑️');
          await sendReply(sock, jid, `🗑️ *Cancelled.* No files were created or modified.`, msg);
          return;
        }

        // 2. Confirmed (yes, confirm, proceed, ok, sure, do it) or project name
        const isYes = ['yes', 'y', 'confirm', 'proceed', 'sure', 'do it', 'ok', 'okay', 'yep', 'yeah'].includes(lowerResp);
        let chosenProject = null;

        if (isYes) {
          chosenProject = pending.suggestedProject;
        } else {
          // Check if user replied with a project name (e.g. "wisewallets", "rocktoberfest", "lattice", "demo")
          const cleanResp = lowerResp.replace(/[^a-z0-9]/g, '');
          for (const key of Object.keys(currentState.projects)) {
            if (key.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanResp) {
              chosenProject = key;
              break;
            }
          }
          if (!chosenProject) {
            for (const [alias, patterns] of Object.entries(PROJECT_PHONETIC_PATTERNS)) {
              if (!currentState.projects[alias]) continue;
              if (patterns.some((p) => p.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanResp)) {
                chosenProject = alias;
                break;
              }
            }
          }
        }

        if (chosenProject && currentState.projects[chosenProject]) {
          delete currentState.pendingProjectConfirmations[jid];
          currentState.activeProject = chosenProject;
          saveProjectsState(currentState);

          await reactToMessage(sock, msg, '🎯');

          if (pending.isScreenshot) {
            const targetUrl =
              (await getProjectDeploymentUrl(currentState.projects[chosenProject], chosenProject)) ||
              'http://localhost:3000';
            await sendReply(
              sock,
              jid,
              `🎯 *Confirmed project: \`${chosenProject}\`*\nCapturing screenshot of ${targetUrl}...`,
              msg
            );
            rawBody = `/screenshot ${targetUrl}${pending.isMobile ? ' mobile' : ''}`;
          } else {
            await sendReply(
              sock,
              jid,
              `🎯 *Confirmed project: \`${chosenProject}\`*\nProceeding with task...`,
              msg
            );
            rawBody = `[${chosenProject}] ${pending.taskPrompt}`;
          }
        } else if (!rawBody.startsWith('/')) {
          await sendReply(
            sock,
            jid,
            `❓ Reply *yes* to proceed on \`${pending.suggestedProject || 'active'}\`, or reply with a project name (*wisewallets*, *rocktoberfest*, *lattice*...), or *cancel*.`,
            msg
          );
          return;
        }
      }

      // Fast-path: natural language GitHub collaborator requests from the owner
      // (e.g. "add @octocat as collaborator to wisewallets", "invite https://github.com/user as a collaborator", "remove octocat from collaborators")
      if (owner && !rawBody.startsWith('/')) {
        const normalizedCollabText = rawBody
          .replace(/\[([^\]]+)\]\((https?:\/\/github\.com\/[^)]+)\)/gi, '$2')
          .replace(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+)/gi, '$1')
          .trim();

        const emailInTextMatch = normalizedCollabText.match(
          /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/
        );
        const extractedEmail = emailInTextMatch ? emailInTextMatch[1] : '';

        const addCollabMatch =
          normalizedCollabText.match(
            /^(?:please\s+)?(?:can\s+you\s+)?(?:add|invite)\s+@?([A-Za-z0-9_.-]+)(?:\s*\([^)]*\))?\s+(?:as\s+(?:a\s+)?)?(?:github\s+)?collaborator(?:\s+(?:on|to|in|for)\s+(?:the\s+)?(?:repo(?:sitory)?\s+|project\s+)?([A-Za-z0-9_./-]+))?/i
          ) ||
          normalizedCollabText.match(
            /^(?:please\s+)?(?:can\s+you\s+)?(?:add|invite)\s+(?:github\s+)?collaborator\s+@?([A-Za-z0-9_.-]+)(?:\s*\([^)]*\))?(?:\s+(?:on|to|in|for)\s+(?:the\s+)?(?:repo(?:sitory)?\s+|project\s+)?([A-Za-z0-9_./-]+))?/i
          );
        const removeCollabMatch = normalizedCollabText.match(
          /^(?:please\s+)?(?:can\s+you\s+)?(?:remove|delete|revoke|uninvite)\s+@?([A-Za-z0-9_.-]+)\s+(?:as\s+(?:a\s+)?)?(?:collaborator|from\s+collaborators)(?:\s+(?:on|from|in)\s+(?:the\s+)?(?:repo(?:sitory)?\s+|project\s+)?([A-Za-z0-9_./-]+))?/i
        );
        const listCollabMatch = normalizedCollabText.match(
          /^(?:please\s+)?(?:list|show|get)\s+(?:all\s+)?(?:github\s+)?collaborators(?:\s+(?:on|for|in|of)\s+(?:the\s+)?(?:repo(?:sitory)?\s+|project\s+)?([A-Za-z0-9_./-]+))?$/i
        );

        const stopWords = new Set(['this', 'that', 'the', 'my', 'our', 'current', 'repo', 'repository', 'project', 'here']);
        if (addCollabMatch) {
          const user = addCollabMatch[1];
          const repoCandidate = (addCollabMatch[2] || '').replace(/[,.!?]+$/, '');
          const repoPart = repoCandidate && !stopWords.has(repoCandidate.toLowerCase()) ? ` ${repoCandidate}` : '';
          const emailPart = extractedEmail ? ` ${extractedEmail}` : '';
          rawBody = `/collab ${user}${repoPart}${emailPart}`;
        } else if (removeCollabMatch) {
          const user = removeCollabMatch[1];
          const repoCandidate = (removeCollabMatch[2] || '').replace(/[,.!?]+$/, '');
          const repoPart = repoCandidate && !stopWords.has(repoCandidate.toLowerCase()) ? ` ${repoCandidate}` : '';
          rawBody = `/removecollab ${user}${repoPart}`;
        } else if (listCollabMatch) {
          const repoCandidate = (listCollabMatch[1] || '').replace(/[,.!?]+$/, '');
          const repoPart = repoCandidate && !stopWords.has(repoCandidate.toLowerCase()) ? ` ${repoCandidate}` : '';
          rawBody = `/collabs${repoPart}`;
        }
      }

      // Fast-path: deployment / vercel URL query
      // (e.g. "pull out the vercel link", "what is the deployment link", "where is it deployed")
      if (!rawBody.startsWith('/')) {
        const lowerBody = rawBody.toLowerCase();
        if (
          lowerBody.includes('vercel link') ||
          lowerBody.includes('vercel url') ||
          lowerBody.includes('deployment link') ||
          lowerBody.includes('deployment url') ||
          lowerBody.includes('deployed link') ||
          lowerBody.includes('live link') ||
          lowerBody.includes('live url')
        ) {
          let projectDir = CONFIG.defaultProjectDir;
          let detectedAlias = null;
          try {
            const resolved = resolveProjectAndTask(rawBody, jid);
            if (resolved.projectDir) {
              projectDir = resolved.projectDir;
              detectedAlias = resolved.projectAlias;
            }
          } catch {
            const boundProject = isGroup ? currentState.groupBindings?.[jid] : currentState.activeProject;
            projectDir = (boundProject && currentState.projects?.[boundProject]) || CONFIG.defaultProjectDir;
            detectedAlias = boundProject;
          }

          const liveUrl = await getProjectDeploymentUrl(projectDir, detectedAlias);
          if (liveUrl) {
            await sendReply(
              sock,
              jid,
              `🌐 *Live Deployment for \`${detectedAlias || 'project'}\`:*\n${liveUrl}`,
              msg
            );
            return;
          }
        }
      }

      // Fast-path: natural language screenshot / visual inspection requests
      // (e.g. "take a screenshot of the current page", "send me a screenshot of localhost 3000", "screenshot https://example.com mobile")
      if (!rawBody.startsWith('/')) {
        const lowerBody = rawBody.toLowerCase();
        if (
          lowerBody.includes('screenshot') ||
          lowerBody.includes('screen shot') ||
          lowerBody.includes('capture the page') ||
          lowerBody.includes('capture page') ||
          lowerBody.includes('visual test') ||
          lowerBody.includes('qa test') ||
          lowerBody.includes('landing page screenshot')
        ) {
          // Check if there is an explicit URL or port
          const urlMatch = rawBody.match(/(?:https?:\/\/[^\s]+|localhost:[0-9]+|:[0-9]{2,5}|\b[0-9]{4,5}\b)/i);
          const isMobile = lowerBody.includes('mobile') || lowerBody.includes('phone');
          let target = urlMatch ? urlMatch[0] : '';

          // If no specific URL was given, check if project has a live Vercel/GitHub deployment URL!
          if (!target) {
            let projectDir = CONFIG.defaultProjectDir;
            let detectedAlias = null;
            let resolved = null;
            try {
              resolved = resolveProjectAndTask(rawBody, jid);
              if (resolved.projectDir) {
                projectDir = resolved.projectDir;
                detectedAlias = resolved.projectAlias;
              }
            } catch {
              const boundProject = isGroup ? currentState.groupBindings?.[jid] : currentState.activeProject;
              projectDir = (boundProject && currentState.projects?.[boundProject]) || CONFIG.defaultProjectDir;
              detectedAlias = boundProject;
            }


            // 1. Try to discover live Vercel / GitHub Pages / deployment URL
            const liveUrl = await getProjectDeploymentUrl(projectDir, detectedAlias);
            if (liveUrl) {
              target = liveUrl;
            } else {
              // 2. Fall back to local project index.html or dev server
              const indexPath = path.join(projectDir, 'index.html');
              if (fs.existsSync(indexPath)) {
                target = `file://${indexPath}`;
              } else {
                target = 'http://localhost:3000';
              }
            }
          }

          rawBody = `/screenshot ${target}${isMobile ? ' mobile' : ''}`;
        }
      }

      // Check if it's a slash command
      if (rawBody.startsWith('/') || rawBody.toLowerCase() === 'help') {
        const handled = await handleSlashCommand(sock, jid, msg, rawBody);
        if (handled) return;
      }

      // If owner sends a normal task in a group that is currently shut down, remind them to /wakeup first
      if (isGroup && currentState.disabledGroups?.[jid]) {
        await sendReply(
          sock,
          jid,
          `🛑 *Agent is currently shut down in this group.*\nSend */wakeup* (or */start*) to turn it back on!`,
          msg
        );
        return;
      }

      // Check for continuation flag (-c or --continue) OR automatic continuation when swipe-replying to the bot!
      let continueSession = replyingToBot;
      if (rawBody.startsWith('-c ') || rawBody.startsWith('--continue ')) {
        continueSession = true;
        rawBody = rawBody.replace(/^(-c|--continue)\s+/, '').trim();
      }

      // If quoting a non-bot message AND also providing instructions (e.g. quoting a meeting link and typing "@agent mail this to me and add it to my calendar")
      if (quotedText && !replyingToBot && rawBody !== quotedText) {
        rawBody = `Referenced quoted message:\n"""\n${quotedText}\n"""\n\nUser Instruction: ${rawBody}`;
      }

      try {
        const resolved = resolveProjectAndTask(rawBody, jid);
        const {
          projectAlias,
          projectDir,
          taskPrompt,
        } = resolved;

        if (isProcessingQueue || taskQueue.length > 0) {
          const position = taskQueue.length + 1;
          await sendReply(
            sock,
            jid,
            `⏳ Queued (#${position})`,
            msg
          );
        }

        taskQueue.push({
          jid,
          msg,
          projectAlias,
          projectDir,
          taskPrompt,
          continueSession,
        });

        processQueue(sock).catch((err) => {
          console.error('⚠️ processQueue failed:', err?.message || err);
        });
      } catch (err) {
        // Only show "group not bound yet" instructions if the Owner triggered it
        if (err.code === 'UNBOUND_GROUP' && !owner) {
          return;
        }
        await sendReply(sock, jid, `⚠️ ${err.message}`, msg);
      }
}
