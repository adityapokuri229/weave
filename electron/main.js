import { app, BrowserWindow, ipcMain, shell, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  syncOtaOnBoot,
  checkAndApplyOtaUpdate,
  getOtaStatus,
  onOtaUpdate,
} from '../src/ota.js';

if (process.platform === 'linux') {
  app.disableHardwareAcceleration();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let currentQrData = null;
let activeRuntimeDir = path.resolve(__dirname, '..');

// Dynamically loaded runtime modules (can be refreshed via OTA)
let botMod = null;
let configMod = null;
let authMod = null;
let agentMod = null;

async function loadRuntimeModules(runtimeDir, cacheBust = '') {
  const suffix = cacheBust ? `?v=${encodeURIComponent(cacheBust)}` : '';
  const importFromRuntime = (relPath) =>
    import(`${pathToFileURL(path.join(runtimeDir, relPath)).href}${suffix}`);

  configMod = await importFromRuntime('src/config.js');
  authMod = await importFromRuntime('src/auth.js');
  agentMod = await importFromRuntime('src/agent.js');
  if (!botMod) {
    botMod = await importFromRuntime('src/bot.js');
  }
}

function createWindow(runtimeDir) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const electronDir = path.join(runtimeDir, 'electron');

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#09090b',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: fs.existsSync(path.join(electronDir, 'preload.cjs'))
        ? path.join(electronDir, 'preload.cjs')
        : fs.existsSync(path.join(__dirname, 'preload.cjs'))
        ? path.join(__dirname, 'preload.cjs')
        : path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.maximize();
  const rendererHtml = path.join(electronDir, 'renderer', 'index.html');
  mainWindow.loadFile(
    fs.existsSync(rendererHtml)
      ? rendererHtml
      : path.join(__dirname, 'renderer', 'index.html')
  );

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer] [${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (currentQrData) {
      mainWindow.webContents.send('weave:qr-update', currentQrData);
    } else if (configMod) {
      const qrPath = path.join(configMod.DATA_DIR, 'whatsapp-qr.png');
      const fallbackPath = path.join(configMod.ROOT_DIR, 'whatsapp-qr.png');
      const targetPath = fs.existsSync(qrPath)
        ? qrPath
        : fs.existsSync(fallbackPath)
        ? fallbackPath
        : null;
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

  try {
    const rendererDir = path.join(electronDir, 'renderer');
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

ipcMain.handle('weave:ota-status', async () => {
  return getOtaStatus();
});

ipcMain.handle('weave:ota-update', async (_event, force = false) => {
  try {
    const res = await checkAndApplyOtaUpdate({ force: Boolean(force) });
    if (res.updated) {
      await loadRuntimeModules(res.runtimeDir || activeRuntimeDir, `${res.commitHash}-${Date.now()}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reloadIgnoringCache();
      }
    }
    return { success: true, ...res };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('weave:get-status', async () => {
  const botStatus = botMod.getBotStatus();
  const state = configMod.loadProjectsState();

  let qrToSend = currentQrData;
  if (!qrToSend && !botStatus.connected) {
    const qrPath = path.join(configMod.DATA_DIR, 'whatsapp-qr.png');
    const fallbackPath = path.join(configMod.ROOT_DIR, 'whatsapp-qr.png');
    const targetPath = fs.existsSync(qrPath)
      ? qrPath
      : fs.existsSync(fallbackPath)
      ? fallbackPath
      : null;
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
      triggerPrefix: configMod.CONFIG.triggerPrefix,
      qrData: qrToSend,
    },
    google: {
      authenticated: authMod.googleAuth.isAuthenticated(),
      email: authMod.googleAuth.getUserEmail(),
    },
    ota: getOtaStatus(),
    projects: state.projects,
    activeProject: state.activeProject,
    groupBindings: state.groupBindings,
  };
});

ipcMain.handle('weave:google-login', async () => {
  try {
    const tokens = await authMod.googleAuth.startLoginFlow((authUrl) => {
      shell.openExternal(authUrl);
    });

    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }

    return {
      success: true,
      email: tokens.email,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
});

ipcMain.handle('weave:request-pairing-code', async (_event, phoneNumber) => {
  try {
    const code = await botMod.requestPairingCode(phoneNumber);
    return { success: true, code };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('weave:update-handle', async (_event, newHandle) => {
  return configMod.updateTriggerPrefix(newHandle);
});

ipcMain.handle('weave:get-projects', async () => {
  return configMod.loadProjectsState();
});

ipcMain.handle('weave:add-project', async (_event, { alias, folderPath }) => {
  const state = configMod.loadProjectsState();
  const cleanAlias = (alias || '').trim().toLowerCase();
  const resolvedPath = path.resolve(folderPath);

  if (!cleanAlias || !fs.existsSync(resolvedPath)) {
    return { success: false, error: 'Invalid alias or folder does not exist' };
  }

  state.projects[cleanAlias] = resolvedPath;
  configMod.saveProjectsState(state);
  return { success: true, projects: state.projects };
});

ipcMain.handle('weave:bind-group', async (_event, { groupJid, alias }) => {
  const state = configMod.loadProjectsState();
  if (alias && state.projects[alias]) {
    state.groupBindings[groupJid] = alias;
  } else {
    delete state.groupBindings[groupJid];
  }
  configMod.saveProjectsState(state);
  return { success: true, groupBindings: state.groupBindings };
});

ipcMain.handle('weave:run-prompt', async (_event, { prompt, projectAlias }) => {
  const state = configMod.loadProjectsState();
  const targetAlias = projectAlias || state.activeProject || 'demo';
  const targetDir = state.projects[targetAlias] || configMod.CONFIG.defaultProjectDir;

  try {
    const result = await agentMod.runAntigravityTask({
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
  agentMod.stopActiveTask();
  return { success: true };
});

// Listen for OTA updates (triggered via WhatsApp `/update` or background timer)
onOtaUpdate(async (updateInfo) => {
  try {
    await loadRuntimeModules(
      updateInfo.runtimeDir || activeRuntimeDir,
      `${updateInfo.commitHash}-${Date.now()}`
    );
    sendToRenderer('weave:ota-updated', updateInfo);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reloadIgnoringCache();
    }
  } catch (err) {
    console.warn('OTA hot-reload warning:', err.message);
  }
});

// App Lifecycle
app.whenReady().then(async () => {
  // 1. Sync OTA bundle before loading app modules
  activeRuntimeDir = await syncOtaOnBoot();
  await loadRuntimeModules(activeRuntimeDir);

  // 2. Wire bot events
  botMod.botEvents.on('qr', (data) => {
    currentQrData = data;
    sendToRenderer('weave:qr-update', data);
  });

  botMod.botEvents.on('connection', (data) => {
    if (data.status === 'connected') {
      currentQrData = null;
    }
    sendToRenderer('weave:status-update', data);
  });

  // 3. Create window from active runtime directory
  createWindow(activeRuntimeDir);

  // 4. Start WhatsApp bot service
  botMod.startWhatsAppBot().catch((err) => {
    console.error('WhatsApp Bot startup error:', err.message);
  });

  // 5. Poll for live OTA updates every 3 minutes in the background
  setInterval(() => {
    checkAndApplyOtaUpdate({ force: false }).catch(() => {});
  }, 180000).unref?.();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(activeRuntimeDir);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
