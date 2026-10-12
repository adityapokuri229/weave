// Weave Desktop Monochrome Controller
document.addEventListener('DOMContentLoaded', async () => {
  const api = window.weaveAPI;

  // Window Controls
  const btnClose = document.getElementById('btn-close');
  const btnMinimize = document.getElementById('btn-minimize');
  const btnMaximize = document.getElementById('btn-maximize');

  if (btnClose) btnClose.addEventListener('click', () => api?.close());
  if (btnMinimize) btnMinimize.addEventListener('click', () => api?.minimize());
  if (btnMaximize) btnMaximize.addEventListener('click', () => api?.maximize());

  // Navigation Tabs
  const tabOnboarding = document.getElementById('tab-onboarding');
  const tabWorkspace = document.getElementById('tab-workspace');
  const viewOnboarding = document.getElementById('view-onboarding');
  const viewWorkspace = document.getElementById('view-workspace');
  const btnLaunchWorkspace = document.getElementById('btn-launch-workspace');

  let isConnected = false;
  const tabWorkspaceIcon = document.getElementById('tab-workspace-icon');

  function showView(view) {
    if (view === 'workspace') {
      if (!isConnected) {
        appendLog('warn', '⚠️ Please link WhatsApp first by scanning the QR code before opening the workspace.');
        // Subtle visual shake or highlight on QR box
        stepBtn1.classList.add('animate-pulse');
        setTimeout(() => stepBtn1.classList.remove('animate-pulse'), 1500);
        return;
      }
      viewOnboarding.classList.add('hidden');
      viewWorkspace.classList.remove('hidden');
      tabWorkspace.className = 'px-2.5 py-0.5 rounded text-[11px] font-medium text-black bg-white transition-all flex items-center gap-1.5 cursor-pointer';
      tabOnboarding.className = 'px-2.5 py-0.5 rounded text-[11px] font-medium text-app-secondary hover:text-white transition-all flex items-center gap-1.5 cursor-pointer';
    } else {
      viewWorkspace.classList.add('hidden');
      viewOnboarding.classList.remove('hidden');
      tabOnboarding.className = 'px-2.5 py-0.5 rounded text-[11px] font-medium text-black bg-white transition-all flex items-center gap-1.5 cursor-pointer';
      if (isConnected) {
        tabWorkspace.className = 'px-2.5 py-0.5 rounded text-[11px] font-medium text-app-secondary hover:text-white transition-all flex items-center gap-1.5 cursor-pointer';
      } else {
        tabWorkspace.className = 'px-2.5 py-0.5 rounded text-[11px] font-medium text-app-dim opacity-50 cursor-not-allowed transition-all flex items-center gap-1.5';
      }
    }
  }

  tabOnboarding.addEventListener('click', () => showView('onboarding'));
  tabWorkspace.addEventListener('click', () => showView('workspace'));
  btnLaunchWorkspace.addEventListener('click', () => showView('workspace'));

  // Header Elements
  const waHeaderDot = document.getElementById('wa-header-dot');
  const waHeaderText = document.getElementById('wa-header-text');
  const googleEmail = document.getElementById('google-email');
  const googleAvatarLetter = document.getElementById('google-avatar-letter');

  // Step Indicators
  const stepBtn1 = document.getElementById('step-btn-1');
  const stepIcon1 = document.getElementById('step-icon-1');
  const stepBtn2 = document.getElementById('step-btn-2');
  const stepIcon2 = document.getElementById('step-icon-2');

  // Step 1: QR & WhatsApp
  const qrImage = document.getElementById('qr-image');
  const qrPlaceholder = document.getElementById('qr-placeholder');
  const qrConnectedOverlay = document.getElementById('qr-connected-overlay');
  const qrConnectedNumber = document.getElementById('qr-connected-number');
  const qrLivePulse = document.getElementById('qr-live-pulse');

  // Step 2: Google PKCE
  const btnGoogleLogin = document.getElementById('btn-google-login');
  const googleStatusTitle = document.getElementById('google-status-title');
  const googleStatusDesc = document.getElementById('google-status-desc');
  const googleVerifiedIcon = document.getElementById('google-verified-icon');

  // Step 3: Trigger Handle
  const botTagInput = document.getElementById('bot-tag-input');
  const btnSaveHandle = document.getElementById('btn-save-handle');
  const callsignDisplay = document.getElementById('callsign-display');
  const btnCopyCallsign = document.getElementById('btn-copy-callsign');

  // Workspace Feed & Elements
  const terminalBody = document.getElementById('terminal-body');
  const btnClearLogs = document.getElementById('btn-clear-logs');
  const promptInput = document.getElementById('prompt-input');
  const btnRunPrompt = document.getElementById('btn-run-prompt');
  const btnQuickStop = document.getElementById('btn-quick-stop');
  const workspaceBotStatusTag = document.getElementById('workspace-bot-status-tag');
  const activeProjectPath = document.getElementById('active-project-path');

  // Copy callsign helper
  if (btnCopyCallsign) {
    btnCopyCallsign.addEventListener('click', () => {
      const text = callsignDisplay.textContent || '@agent';
      navigator.clipboard.writeText(text);
      btnCopyCallsign.innerHTML = '<span class="text-white">✓</span><span>Copied</span>';
      setTimeout(() => {
        btnCopyCallsign.innerHTML = '<span class="text-app-tertiary">⌘C</span><span>Copy</span>';
      }, 1500);
    });
  }

  // Terminal logging
  function appendLog(level, text, time = new Date().toLocaleTimeString()) {
    const row = document.createElement('div');
    row.className = 'flex items-start gap-2 leading-relaxed';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'text-app-dim shrink-0';
    timeSpan.textContent = `[${time}]`;

    const content = document.createElement('span');
    content.className = 'break-all';

    if (level === 'error') {
      content.className += ' text-neutral-300 font-semibold';
    } else if (level === 'warn') {
      content.className += ' text-neutral-400';
    } else if (text.includes('ONLINE') || text.includes('Connected') || text.includes('✅')) {
      content.className += ' text-white font-semibold';
    } else {
      content.className += ' text-app-secondary';
    }

    content.textContent = text;
    row.appendChild(timeSpan);
    row.appendChild(content);

    terminalBody.appendChild(row);
    terminalBody.scrollTop = terminalBody.scrollHeight;
  }

  if (btnClearLogs) {
    btnClearLogs.addEventListener('click', () => {
      terminalBody.innerHTML = '<div class="text-app-dim">// Stream cleared.</div>';
    });
  }

  // State Synchronizer
  function renderState(state) {
    if (!state) return;

    function setQrDisplay(dataUrl) {
      if (!dataUrl) return;
      qrImage.src = dataUrl;
      qrImage.style.display = 'block';
      qrImage.classList.remove('hidden');
      qrPlaceholder.style.display = 'none';
      qrPlaceholder.classList.add('hidden');
      qrConnectedOverlay.style.display = 'none';
      qrConnectedOverlay.classList.add('hidden');
      waHeaderDot.className = 'w-1.5 h-1.5 rounded-full bg-neutral-400 animate-pulse inline-block';
      waHeaderText.textContent = 'Scan QR Code';
      workspaceBotStatusTag.textContent = 'SCAN QR';
    }

    // 1. WhatsApp Bot State (Step 1)
    if (state.bot?.connected) {
      isConnected = true;
      tabWorkspace.className = 'px-2.5 py-0.5 rounded text-[11px] font-medium text-app-secondary hover:text-white transition-all flex items-center gap-1.5 cursor-pointer';
      tabWorkspace.removeAttribute('title');
      if (tabWorkspaceIcon) tabWorkspaceIcon.textContent = 'terminal';

      waHeaderDot.className = 'w-1.5 h-1.5 rounded-full bg-white inline-block';
      waHeaderText.textContent = 'WhatsApp Connected';
      qrPlaceholder.style.display = 'none';
      qrPlaceholder.classList.add('hidden');
      qrImage.style.display = 'none';
      qrImage.classList.add('hidden');
      qrConnectedOverlay.style.display = 'flex';
      qrConnectedOverlay.classList.remove('hidden');
      qrConnectedNumber.textContent = state.bot.user?.id?.split(':')[0] || 'Active';
      qrLivePulse.className = 'w-1.5 h-1.5 rounded-full bg-white';

      // Update Stepper: Step 1 completed
      stepBtn1.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-app-subtle border border-app-border text-white font-medium';
      stepIcon1.textContent = 'check_circle';
      stepIcon1.className = 'material-symbols-outlined text-[15px] text-white';

      // Advance attention to Step 2 (Google Auth)
      if (!state.google?.authenticated) {
        stepBtn2.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-white text-black font-semibold shadow-sm';
        stepIcon2.className = 'material-symbols-outlined text-[15px] text-black';
      }
      workspaceBotStatusTag.textContent = 'ONLINE';
    } else {
      isConnected = false;
      tabWorkspace.className = 'px-2.5 py-0.5 rounded text-[11px] font-medium text-app-dim opacity-50 cursor-not-allowed transition-all flex items-center gap-1.5';
      tabWorkspace.setAttribute('title', 'Link WhatsApp first to unlock Workspace');
      if (tabWorkspaceIcon) tabWorkspaceIcon.textContent = 'lock';

      if (state.bot?.qrData?.dataUrl) {
        setQrDisplay(state.bot.qrData.dataUrl);
      }
    }

    // 2. Google OAuth Status (Step 2)
    if (state.google?.authenticated && state.google?.email) {
      googleEmail.textContent = state.google.email;
      googleAvatarLetter.textContent = (state.google.email[0] || 'G').toUpperCase();
      googleStatusTitle.textContent = `Connected as ${state.google.email}`;
      googleStatusDesc.textContent = 'Gemini 2.5 Flash, Google Calendar & Gmail active';
      googleVerifiedIcon.classList.remove('hidden');
      btnGoogleLogin.textContent = 'Connected';
      btnGoogleLogin.className = 'text-xs font-mono font-medium px-3.5 py-1.5 rounded-lg bg-app-subtle text-white border border-app-border shrink-0 cursor-default';

      // Step 2 Completed
      stepBtn2.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-app-subtle border border-app-border text-white font-medium';
      stepIcon2.textContent = 'check_circle';
      stepIcon2.className = 'material-symbols-outlined text-[15px] text-white';
    }

    // 3. Trigger Handle (Step 3)
    const trigger = state.bot?.triggerPrefix || '@agent';
    botTagInput.value = trigger.replace(/^@/, '');
    callsignDisplay.textContent = trigger;

    // 4. Projects
    if (state.activeProject && state.projects?.[state.activeProject]) {
      activeProjectPath.textContent = state.projects[state.activeProject];
    }
  }

  async function syncStatus() {
    if (!api) return;
    try {
      const state = await api.getStatus();
      renderState(state);
    } catch (err) {
      appendLog('error', `Status sync error: ${err.message}`);
    }
  }

  // IPC Event Streams
  if (api) {
    api.onQrUpdate((qrData) => {
      if (qrData?.dataUrl) {
        qrImage.src = qrData.dataUrl;
        qrImage.style.display = 'block';
        qrImage.classList.remove('hidden');
        qrPlaceholder.style.display = 'none';
        qrPlaceholder.classList.add('hidden');
        qrConnectedOverlay.style.display = 'none';
        qrConnectedOverlay.classList.add('hidden');
        waHeaderDot.className = 'w-1.5 h-1.5 rounded-full bg-neutral-400 animate-pulse inline-block';
        waHeaderText.textContent = 'Scan QR Code';
        appendLog('info', '📱 Fresh WhatsApp QR generated. Ready to scan.');
      }
    });

    api.onStatusUpdate((update) => {
      if (update.status === 'connected') {
        waHeaderDot.className = 'w-1.5 h-1.5 rounded-full bg-white inline-block';
        waHeaderText.textContent = 'WhatsApp Connected';
        qrConnectedOverlay.classList.remove('hidden');
        qrImage.classList.add('hidden');
        qrPlaceholder.classList.add('hidden');
        appendLog('info', '✅ WhatsApp connection established and linked.');
        syncStatus();
      } else if (update.status === 'disconnected') {
        waHeaderDot.className = 'w-1.5 h-1.5 rounded-full bg-neutral-600 inline-block';
        waHeaderText.textContent = 'Disconnected';
        appendLog('warn', '⚠️ WhatsApp connection closed.');
      }
    });

    api.onLog(({ level, text, time }) => {
      appendLog(level, text, time);
    });
  }

  // Pairing Code Alternative Handler
  const btnTogglePairingCode = document.getElementById('btn-toggle-pairing-code');
  const pairingCodeBox = document.getElementById('pairing-code-box');
  const pairingPhoneInput = document.getElementById('pairing-phone-input');
  const btnRequestPairingCode = document.getElementById('btn-request-pairing-code');
  const pairingCodeDisplay = document.getElementById('pairing-code-display');
  const pairingCodeDigits = document.getElementById('pairing-code-digits');

  if (btnTogglePairingCode && pairingCodeBox) {
    btnTogglePairingCode.addEventListener('click', () => {
      pairingCodeBox.classList.toggle('hidden');
    });
  }

  if (btnRequestPairingCode) {
    btnRequestPairingCode.addEventListener('click', async () => {
      const phone = pairingPhoneInput.value.trim();
      if (!phone) {
        appendLog('warn', '⚠️ Please enter your phone number with country code (e.g. 15551234567).');
        pairingPhoneInput.focus();
        return;
      }
      btnRequestPairingCode.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      btnRequestPairingCode.disabled = true;

      try {
        const res = await api?.requestPairingCode(phone);
        if (res?.success && res?.code) {
          pairingCodeDigits.textContent = res.code;
          pairingCodeDisplay.classList.remove('hidden');
          appendLog('info', `🔑 Pairing Code generated: ${res.code}`);
        } else {
          appendLog('error', `Pairing code error: ${res?.error || 'Failed to request code'}`);
        }
      } catch (err) {
        appendLog('error', err.message);
      } finally {
        btnRequestPairingCode.textContent = 'Get Code';
        btnRequestPairingCode.disabled = false;
      }
    });
  }

  // Google Login Click
  btnGoogleLogin.addEventListener('click', async () => {
    if (btnGoogleLogin.textContent.trim() === 'Connected') return;
    btnGoogleLogin.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Opening...';
    const res = await api?.startGoogleLogin();
    if (res?.success) {
      appendLog('info', `✅ Google OAuth (PKCE) verified: ${res.email}`);
      syncStatus();
    } else {
      appendLog('error', `Google login failed: ${res?.error || 'Unknown error'}`);
      btnGoogleLogin.textContent = 'Sign In';
    }
  });

  // Handle Save
  btnSaveHandle.addEventListener('click', async () => {
    const handle = botTagInput.value.trim();
    if (!handle) return;
    const res = await api?.updateHandle(handle);
    if (res?.success) {
      callsignDisplay.textContent = res.triggerPrefix;
      appendLog('info', `Trigger prefix configured: ${res.triggerPrefix}`);
      btnSaveHandle.textContent = 'Saved';
      setTimeout(() => { btnSaveHandle.textContent = 'Save'; }, 1500);
    }
  });

  // Direct Prompt Runner in Workspace
  async function runPrompt() {
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    appendLog('info', `> ${prompt}`);
    promptInput.value = '';
    btnRunPrompt.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btnRunPrompt.disabled = true;

    try {
      const res = await api?.runPrompt(prompt);
      if (res?.success) {
        appendLog('info', `Task completed.`);
      } else {
        appendLog('error', `Task failed: ${res?.error || 'Unknown'}`);
      }
    } catch (err) {
      appendLog('error', err.message);
    } finally {
      btnRunPrompt.innerHTML = 'Run';
      btnRunPrompt.disabled = false;
    }
  }

  btnRunPrompt.addEventListener('click', runPrompt);
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runPrompt();
  });

  if (btnQuickStop) {
    btnQuickStop.addEventListener('click', async () => {
      await api?.stopTask();
      appendLog('warn', 'Task abort requested.');
    });
  }

  // Initial Sync
  syncStatus();
});
