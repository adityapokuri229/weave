import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { startWhatsAppBot, botEvents, getBotStatus, requestPairingCode } from '../src/bot.js';
import { CONFIG, loadProjectsState, saveProjectsState, ROOT_DIR, DATA_DIR } from '../src/config.js';
import { googleAuth } from '../src/auth.js';
import { runAntigravityTask, stopActiveTask } from '../src/agent.js';

if (process.platform === 'linux') {
  app.disableHardwareAcceleration();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let currentQrData = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1060,
    height: 780,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#09090b',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: fs.existsSync(path.join(__dirname, 'preload.cjs'))
        ? path.join(__dirname, 'preload.cjs')
        : path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer] [${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    // If QR data is already generated, immediately push it to the renderer
    if (currentQrData) {
      mainWindow.webContents.send('weave:qr-update', currentQrData);
    } else {
      // Check if whatsapp-qr.png exists on disk in DATA_DIR or ROOT_DIR as fallback
      const qrPath = path.join(DATA_DIR, 'whatsapp-qr.png');
      const fallbackPath = path.join(ROOT_DIR, 'whatsapp-qr.png');
      const targetPath = fs.existsSync(qrPath) ? qrPath : fs.existsSync(fallbackPath) ? fallbackPath : null;
      if (targetPath) {
        try {
          const imgBuffer = fs.readFileSync(targetPath);
          const dataUrl = `data:image/png;base64,${imgBuffer.toString('base64')}`;
          currentQrData = { dataUrl, qrPath: targetPath };
          mainWindow.webContents.send('weave:qr-update', currentQrData);
        } catch {}
      }
    }
  });

  // Live reload renderer files in development
  try {
    const rendererDir = path.join(__dirname, 'renderer');
    fs.watch(rendererDir, { recursive: true }, (_eventType, filename) => {
      if (mainWindow && !mainWindow.isDestroyed() && filename) {
        mainWindow.webContents.reloadIgnoringCache();
      }
    });
  } catch {}

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// Redirect console logs to renderer for live terminal stream
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function formatLogLine(level, ...args) {
  const line = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  sendToRenderer('weave:log', { level, text: line, time: new Date().toLocaleTimeString() });
}

console.log = (...args) => {
  originalLog(...args);
  formatLogLine('info', ...args);
};

console.warn = (...args) => {
  originalWarn(...args);
  formatLogLine('warn', ...args);
};

console.error = (...args) => {
  originalError(...args);
  formatLogLine('error', ...args);
};

// --- IPC HANDLERS ---

ipcMain.on('weave:window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('weave:window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});

ipcMain.on('weave:window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('weave:get-status', async () => {
  const botStatus = getBotStatus();
  const state = loadProjectsState();

  let qrToSend = currentQrData;
  if (!qrToSend && !botStatus.connected) {
    const qrPath = path.join(DATA_DIR, 'whatsapp-qr.png');
    const fallbackPath = path.join(ROOT_DIR, 'whatsapp-qr.png');
    const targetPath = fs.existsSync(qrPath) ? qrPath : fs.existsSync(fallbackPath) ? fallbackPath : null;
    if (targetPath) {
      try {
        const imgBuffer = fs.readFileSync(targetPath);
        qrToSend = {
          dataUrl: `data:image/png;base64,${imgBuffer.toString('base64')}`,
          qrPath: targetPath,
        };
        currentQrData = qrToSend;
      } catch {}
    }
  }

  return {
    bot: {
      connected: botStatus.connected,
      user: botStatus.user,
      registered: botStatus.registered,
      activeTask: botStatus.activeTask,
      triggerPrefix: CONFIG.triggerPrefix,
      qrData: qrToSend,
    },
    google: {
      authenticated: googleAuth.isAuthenticated(),
      email: googleAuth.getUserEmail(),
    },
    projects: state.projects,
    activeProject: state.activeProject,
    groupBindings: state.groupBindings,
  };
});

ipcMain.handle('weave:google-login', async () => {
  let authWindow = null;
  try {
    const tokens = await googleAuth.startLoginFlow((authUrl) => {
      authWindow = new BrowserWindow({
        width: 480,
        height: 600,
        parent: mainWindow || undefined,
        modal: Boolean(mainWindow),
        backgroundColor: '#09090b',
        autoHideMenuBar: true,
        title: 'Sign in with Google — Weave PKCE',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      authWindow.loadURL(authUrl);
      authWindow.on('closed', () => {
        authWindow = null;
      });
    });

    if (authWindow && !authWindow.isDestroyed()) {
      setTimeout(() => {
        try {
          if (authWindow && !authWindow.isDestroyed()) authWindow.close();
        } catch {}
      }, 600);
    }

    return {
      success: true,
      email: tokens.email,
    };
  } catch (err) {
    if (authWindow && !authWindow.isDestroyed()) {
      try { authWindow.close(); } catch {}
    }
    return {
      success: false,
      error: err.message,
    };
  }
});

ipcMain.handle('weave:request-pairing-code', async (_event, phoneNumber) => {
  try {
    const code = await requestPairingCode(phoneNumber);
    return { success: true, code };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('weave:update-handle', async (_event, newHandle) => {
  if (!newHandle) return { success: false, error: 'Empty handle' };
  const cleanHandle = newHandle.startsWith('@') ? newHandle : `@${newHandle}`;
  CONFIG.triggerPrefix = cleanHandle.toLowerCase();

  // Persist into .env file
  try {
    const envPath = path.join(DATA_DIR, '.env');
    if (fs.existsSync(envPath)) {
      let content = fs.readFileSync(envPath, 'utf8');
      if (content.includes('BOT_TRIGGER=')) {
        content = content.replace(/BOT_TRIGGER=.*/g, `BOT_TRIGGER=${cleanHandle}`);
      } else {
        content += `\nBOT_TRIGGER=${cleanHandle}\n`;
      }
      fs.writeFileSync(envPath, content, 'utf8');
    }
  } catch {}

  return { success: true, triggerPrefix: CONFIG.triggerPrefix };
});

ipcMain.handle('weave:get-projects', async () => {
  const state = loadProjectsState();
  return state;
});

ipcMain.handle('weave:add-project', async (_event, { alias, folderPath }) => {
  const state = loadProjectsState();
  const cleanAlias = (alias || '').trim().toLowerCase();
  const resolvedPath = path.resolve(folderPath);

  if (!cleanAlias || !fs.existsSync(resolvedPath)) {
    return { success: false, error: 'Invalid alias or folder does not exist' };
  }

  state.projects[cleanAlias] = resolvedPath;
  saveProjectsState(state);
  return { success: true, projects: state.projects };
});

ipcMain.handle('weave:bind-group', async (_event, { groupJid, alias }) => {
  const state = loadProjectsState();
  if (alias && state.projects[alias]) {
    state.groupBindings[groupJid] = alias;
  } else {
    delete state.groupBindings[groupJid];
  }
  saveProjectsState(state);
  return { success: true, groupBindings: state.groupBindings };
});

ipcMain.handle('weave:run-prompt', async (_event, { prompt, projectAlias }) => {
  const state = loadProjectsState();
  const targetAlias = projectAlias || state.activeProject || 'demo';
  const targetDir = state.projects[targetAlias] || CONFIG.defaultProjectDir;

  try {
    const result = await runAntigravityTask({
      projectAlias: targetAlias,
      projectDir: targetDir,
      taskPrompt: prompt,
    });
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('weave:stop-task', async () => {
  stopActiveTask();
  return { success: true };
});

// Forward bot events to renderer
botEvents.on('qr', (data) => {
  currentQrData = data;
  sendToRenderer('weave:qr-update', data);
});

botEvents.on('connection', (data) => {
  if (data.status === 'connected') {
    currentQrData = null;
  }
  sendToRenderer('weave:status-update', data);
});

// App Lifecycle
app.whenReady().then(() => {
  createWindow();

  // Start the background WhatsApp bot service
  startWhatsAppBot().catch((err) => {
    console.error('WhatsApp Bot startup error:', err.message);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
