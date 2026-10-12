// Wait for DOM to load
document.addEventListener('DOMContentLoaded', async () => {
  const api = window.weaveAPI;

  // DOM Elements - Window controls
  const btnClose = document.getElementById('btn-close');
  const btnMinimize = document.getElementById('btn-minimize');
  const btnMaximize = document.getElementById('btn-maximize');

  // Views & Tabs
  const tabOnboarding = document.getElementById('tab-onboarding');
  const tabWorkspace = document.getElementById('tab-workspace');
  const viewOnboarding = document.getElementById('view-onboarding');
  const viewWorkspace = document.getElementById('view-workspace');
  const btnLaunchWorkspace = document.getElementById('btn-launch-workspace');

  // Status Elements
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const googleEmail = document.getElementById('google-email');
  const googlePill = document.getElementById('google-pill');
  const googleStatusTitle = document.getElementById('google-status-title');
  const googleStatusDesc = document.getElementById('google-status-desc');
  const googleVerifiedIcon = document.getElementById('google-verified-icon');
  const btnGoogleLogin = document.getElementById('btn-google-login');

  // QR Elements
  const qrImage = document.getElementById('qr-image');
  const qrPlaceholder = document.getElementById('qr-placeholder');
  const qrConnectedOverlay = document.getElementById('qr-connected-overlay');
  const qrConnectedNumber = document.getElementById('qr-connected-number');
  const qrLivePulse = document.getElementById('qr-live-pulse');

  // Bot Handle
  const botTagInput = document.getElementById('bot-tag-input');
  const btnSaveHandle = document.getElementById('btn-save-handle');
  const userTriggerPill = document.getElementById('user-trigger-pill');

  // Workspace
  const projectsList = document.getElementById('projects-list');
  const activeProjectPath = document.getElementById('active-project-path');
  const promptInput = document.getElementById('prompt-input');
  const btnRunPrompt = document.getElementById('btn-run-prompt');
  const btnQuickStop = document.getElementById('btn-quick-stop');
  const terminalBody = document.getElementById('terminal-body');
  const btnClearLogs = document.getElementById('btn-clear-logs');
  const logCount = document.getElementById('log-count');

  let entryCounter = 0;

  // --- WINDOW CONTROLS ---
  if (btnClose) btnClose.addEventListener('click', () => api?.close());
  if (btnMinimize) btnMinimize.addEventListener('click', () => api?.minimize());
  if (btnMaximize) btnMaximize.addEventListener('click', () => api?.maximize());

  // --- TAB NAVIGATION ---
  function showView(view) {
    if (view === 'workspace') {
      viewOnboarding.classList.add('hidden');
      viewWorkspace.classList.remove('hidden');
      tabWorkspace.className = 'px-3 py-1 rounded-md font-medium text-[#f1f5f9] bg-[#243247] transition-all flex items-center gap-1.5';
      tabOnboarding.className = 'px-3 py-1 rounded-md font-medium text-[#94a3b8] hover:text-white transition-all flex items-center gap-1.5';
    } else {
      viewWorkspace.classList.add('hidden');
      viewOnboarding.classList.remove('hidden');
      tabOnboarding.className = 'px-3 py-1 rounded-md font-medium text-[#f1f5f9] bg-[#243247] transition-all flex items-center gap-1.5';
      tabWorkspace.className = 'px-3 py-1 rounded-md font-medium text-[#94a3b8] hover:text-white transition-all flex items-center gap-1.5';
    }
  }

  tabOnboarding.addEventListener('click', () => showView('onboarding'));
  tabWorkspace.addEventListener('click', () => showView('workspace'));
  btnLaunchWorkspace.addEventListener('click', () => showView('workspace'));

  // --- LOGGING HELPER ---
  function appendLog(level, text, time = new Date().toLocaleTimeString()) {
    entryCounter += 1;
    logCount.textContent = `${entryCounter} entries`;

    const row = document.createElement('div');
    row.className = 'flex items-start gap-2 text-[11px] leading-relaxed';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'text-[#475569] shrink-0 font-mono';
    timeSpan.textContent = time;

    const content = document.createElement('span');
    content.className = 'font-mono break-all';

    if (level === 'error') {
      content.className += ' text-[#ef4444]';
    } else if (level === 'warn') {
      content.className += ' text-[#f59e0b]';
    } else if (text.includes('✅') || text.includes('ONLINE')) {
      content.className += ' text-[#10b981] font-semibold';
    } else if (text.includes('📱') || text.includes('QR')) {
      content.className += ' text-[#38bdf8]';
    } else {
      content.className += ' text-[#cbd5e1]';
    }

    content.textContent = text;
    row.appendChild(timeSpan);
    row.appendChild(content);

    terminalBody.appendChild(row);
    terminalBody.scrollTop = terminalBody.scrollHeight;
  }

  btnClearLogs.addEventListener('click', () => {
    terminalBody.innerHTML = '<div class="text-[#64748b]">// Console cleared.</div>';
    entryCounter = 0;
    logCount.textContent = '0 entries';
  });

  // --- INITIAL STATUS SYNC ---
  async function syncStatus() {
    if (!api) return;
    try {
      const state = await api.getStatus();
      renderState(state);
    } catch (err) {
      appendLog('error', `Failed to query initial status: ${err.message}`);
    }
  }

  function renderState(state) {
    if (!state) return;

    // 1. Google OAuth Status
    if (state.google?.authenticated && state.google?.email) {
      googleEmail.textContent = state.google.email;
      googlePill.classList.remove('hidden');
      googleStatusTitle.textContent = `Connected as ${state.google.email}`;
      googleStatusDesc.textContent = 'Gemini 2.5 Flash, Google Calendar & Gmail active';
      googleVerifiedIcon.classList.remove('hidden');
      btnGoogleLogin.textContent = 'Connected';
      btnGoogleLogin.className = 'text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0';
    }

    // 2. Trigger Handle
    const trigger = state.bot?.triggerPrefix || '@agent';
    botTagInput.value = trigger.replace(/^@/, '');
    userTriggerPill.textContent = trigger;

    // 3. Projects List
    if (state.projects) {
      projectsList.innerHTML = '';
      for (const [alias, folder] of Object.entries(state.projects)) {
        const item = document.createElement('div');
        item.className = 'flex items-center justify-between p-1.5 rounded hover:bg-[#161f30] transition-colors';
        item.innerHTML = `
          <span class="font-mono text-[#38bdf8] truncate">${alias}</span>
          <span class="text-[#64748b] text-[10px] truncate max-w-[120px]">${folder.split('/').pop()}</span>
        `;
        projectsList.appendChild(item);
      }
    }
    if (state.activeProject && state.projects?.[state.activeProject]) {
      activeProjectPath.textContent = state.projects[state.activeProject];
    }

    // 4. WhatsApp Bot State
    if (state.bot?.connected) {
      statusDot.className = 'w-2 h-2 rounded-full bg-emerald-400 glow-emerald';
      statusText.textContent = 'WhatsApp Online';
      qrPlaceholder.classList.add('hidden');
      qrImage.classList.add('hidden');
      qrConnectedOverlay.classList.remove('hidden');
      qrConnectedNumber.textContent = state.bot.user?.id?.split(':')[0] || 'Active';
      qrLivePulse.className = 'w-2 h-2 rounded-full bg-emerald-400';
    } else if (state.bot?.qrData?.dataUrl) {
      statusDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
      statusText.textContent = 'Scan QR Code';
      qrImage.src = state.bot.qrData.dataUrl;
      qrImage.classList.remove('hidden');
      qrPlaceholder.classList.add('hidden');
      qrConnectedOverlay.classList.add('hidden');
    } else {
      statusDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
      statusText.textContent = 'Initializing...';
    }
  }

  // --- EVENT LISTENERS (PUSH STREAMS) ---
  if (api) {
    api.onQrUpdate((qrData) => {
      if (qrData?.dataUrl) {
        qrImage.src = qrData.dataUrl;
        qrImage.classList.remove('hidden');
        qrPlaceholder.classList.add('hidden');
        qrConnectedOverlay.classList.add('hidden');
        statusDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
        statusText.textContent = 'Scan QR Code';
      }
    });

    api.onStatusUpdate((update) => {
      if (update.status === 'connected') {
        statusDot.className = 'w-2 h-2 rounded-full bg-emerald-400 glow-emerald';
        statusText.textContent = 'WhatsApp Online';
        qrConnectedOverlay.classList.remove('hidden');
        qrImage.classList.add('hidden');
        qrPlaceholder.classList.add('hidden');
      } else if (update.status === 'disconnected') {
        statusDot.className = 'w-2 h-2 rounded-full bg-red-400';
        statusText.textContent = 'Disconnected';
      }
    });

    api.onLog(({ level, text, time }) => {
      appendLog(level, text, time);
    });
  }

  // --- ACTIONS ---
  btnGoogleLogin.addEventListener('click', async () => {
    btnGoogleLogin.innerHTML = '<span class="material-symbols-outlined text-[14px] animate-spin">sync</span> Signing in...';
    const res = await api?.startGoogleLogin();
    if (res?.success) {
      appendLog('info', `✅ Successfully connected to Google as: ${res.email}`);
      syncStatus();
    } else {
      appendLog('error', `Google login failed: ${res?.error || 'Unknown error'}`);
      btnGoogleLogin.textContent = 'Sign In';
    }
  });

  btnSaveHandle.addEventListener('click', async () => {
    const handle = botTagInput.value.trim();
    if (!handle) return;
    const res = await api?.updateHandle(handle);
    if (res?.success) {
      userTriggerPill.textContent = res.triggerPrefix;
      appendLog('info', `Updated assistant trigger to: ${res.triggerPrefix}`);
      btnSaveHandle.textContent = 'Saved!';
      setTimeout(() => { btnSaveHandle.textContent = 'Save'; }, 1500);
    }
  });

  // Prompt Execution
  async function triggerPrompt() {
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    appendLog('info', `🚀 Running prompt: "${prompt}"`);
    promptInput.value = '';
    btnRunPrompt.innerHTML = '<span class="material-symbols-outlined text-[14px] animate-spin">sync</span> Running...';
    btnRunPrompt.disabled = true;

    try {
      const res = await api?.runPrompt(prompt);
      if (res?.success) {
        appendLog('info', `✅ Task Completed! Result:`);
        appendLog('info', res.result?.response || 'Done');
      } else {
        appendLog('error', `Task failed: ${res?.error || 'Unknown error'}`);
      }
    } catch (err) {
      appendLog('error', `Execution error: ${err.message}`);
    } finally {
      btnRunPrompt.innerHTML = '<span>Run</span><i class="fa-solid fa-arrow-right text-[11px]"></i>';
      btnRunPrompt.disabled = false;
    }
  }

  btnRunPrompt.addEventListener('click', triggerPrompt);
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') triggerPrompt();
  });

  btnQuickStop.addEventListener('click', async () => {
    await api?.stopTask();
    appendLog('warn', '⏹️ Stopped active task process.');
  });

  // Start initial sync
  syncStatus();
});
