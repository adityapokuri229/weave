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
  let isGoogleConnected = false;
  const tabWorkspaceIcon = document.getElementById('tab-workspace-icon');

  // Step Indicators
  const stepBtn1 = document.getElementById('step-btn-1');
  const stepIcon1 = document.getElementById('step-icon-1');
  const stepBtn2 = document.getElementById('step-btn-2');
  const stepIcon2 = document.getElementById('step-icon-2');
  const stepBtn3 = document.getElementById('step-btn-3');

  // Step Cards
  const step2Card = document.getElementById('step-2-card');
  const step3Card = document.getElementById('step-3-card');
  const step3Badge = document.getElementById('step-3-badge');

  function showView(view) {
    if (view === 'workspace') {
      if (!isConnected) {
        appendLog('warn', '⚠️ Complete Step 1 (Link WhatsApp) first before opening the workspace.');
        if (stepBtn1) {
          stepBtn1.classList.add('animate-pulse');
          setTimeout(() => stepBtn1.classList.remove('animate-pulse'), 1500);
        }
        return;
      }
      if (!isGoogleConnected) {
        appendLog('warn', '⚠️ Complete Step 2 (Connect Google Account) first before opening the workspace.');
        if (stepBtn2) {
          stepBtn2.classList.add('animate-pulse');
          setTimeout(() => stepBtn2.classList.remove('animate-pulse'), 1500);
        }
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
      if (isConnected && isGoogleConnected) {
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

    isConnected = Boolean(state.bot?.connected);
    isGoogleConnected = Boolean(state.google?.authenticated && state.google?.email);

    // 1. WhatsApp Bot State (Step 1)
    if (isConnected) {
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

      // Step 1 completed
      stepBtn1.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-app-subtle border border-app-border text-white font-medium';
      stepIcon1.textContent = 'check_circle';
      stepIcon1.className = 'material-symbols-outlined text-[15px] text-white';

      workspaceBotStatusTag.textContent = 'ONLINE';
    } else {
      stepBtn1.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-white text-black font-semibold shadow-sm';
      stepIcon1.textContent = 'qr_code_scanner';
      stepIcon1.className = 'material-symbols-outlined text-[15px] text-black';

      if (state.bot?.qrData?.dataUrl) {
        setQrDisplay(state.bot.qrData.dataUrl);
      }
    }

    // 2. Google OAuth Status (Step 2 — Strictly Gated Behind Step 1)
    if (!isConnected) {
      // Locked until Step 1 is done
      if (step2Card) {
        step2Card.style.opacity = '0.45';
      }
      googleStatusTitle.textContent = 'Step 2: Connect Google Account (PKCE)';
      googleStatusDesc.textContent = 'Link WhatsApp in Step 1 first to unlock Google PKCE Sign-In';
      googleVerifiedIcon.classList.add('hidden');
      btnGoogleLogin.textContent = '🔒 Locked';
      btnGoogleLogin.className = 'text-xs font-mono font-medium px-3.5 py-1.5 rounded-lg bg-app-subtle text-app-dim border border-app-border transition-all shrink-0 cursor-not-allowed';

      stepBtn2.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-app-subtle border border-app-border text-app-dim font-medium';
      stepIcon2.textContent = 'lock';
      stepIcon2.className = 'material-symbols-outlined text-[15px] text-app-dim';
    } else if (!isGoogleConnected) {
      // Step 1 is complete -> Unlock Step 2!
      if (step2Card) {
        step2Card.style.opacity = '1';
      }
      googleStatusTitle.textContent = 'Step 2: Connect Google Account (PKCE)';
      googleStatusDesc.textContent = 'Required for Gemini 2.5/3.8 Flash execution & calendar actions';
      googleVerifiedIcon.classList.add('hidden');
      if (!btnGoogleLogin.innerHTML.includes('fa-spinner')) {
        btnGoogleLogin.textContent = 'Sign In';
      }
      btnGoogleLogin.className = 'text-xs font-mono font-medium px-3.5 py-1.5 rounded-lg bg-white hover:bg-neutral-200 text-black transition-all shrink-0 active:scale-95 shadow cursor-pointer';

      stepBtn2.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-white text-black font-semibold shadow-sm';
      stepIcon2.textContent = 'login';
      stepIcon2.className = 'material-symbols-outlined text-[15px] text-black';
    } else {
      // Both Step 1 & Step 2 completed!
      if (step2Card) {
        step2Card.style.opacity = '1';
      }
      googleEmail.textContent = state.google.email;
      googleAvatarLetter.textContent = (state.google.email[0] || 'G').toUpperCase();
      googleStatusTitle.textContent = `Connected as ${state.google.email}`;
      googleStatusDesc.textContent = 'Gemini 2.5/3.8 Flash, Google Calendar & Gmail active';
      googleVerifiedIcon.classList.remove('hidden');
      btnGoogleLogin.textContent = 'Connected ✓';
      btnGoogleLogin.className = 'text-xs font-mono font-medium px-3.5 py-1.5 rounded-lg bg-app-subtle text-white border border-app-border shrink-0 cursor-pointer hover:border-white';

      stepBtn2.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-app-subtle border border-app-border text-white font-medium';
      stepIcon2.textContent = 'check_circle';
      stepIcon2.className = 'material-symbols-outlined text-[15px] text-white';
    }

    // 3. Trigger Handle & Workspace (Step 3 — Strictly Gated Behind Step 1 & Step 2)
    const trigger = state.bot?.triggerPrefix || '@agent';
    if (document.activeElement !== botTagInput) {
      botTagInput.value = trigger.replace(/^@/, '');
    }
    callsignDisplay.textContent = trigger;

    if (isConnected && isGoogleConnected) {
      // Unlock Step 3 & Workspace
      if (step3Card) step3Card.style.opacity = '1';
      if (step3Badge) {
        step3Badge.textContent = 'In-chat mention';
        step3Badge.className = 'text-[11px] text-app-secondary font-mono';
      }
      botTagInput.disabled = false;
      botTagInput.className = 'bg-transparent border-none text-white font-mono text-xs focus:outline-none w-full px-1 tracking-tight';
      btnSaveHandle.disabled = false;
      if (btnSaveHandle.textContent !== 'Saved') {
        btnSaveHandle.textContent = 'Save';
      }
      btnSaveHandle.className = 'text-xs font-mono px-2.5 py-1 bg-white hover:bg-neutral-200 text-black font-semibold rounded transition-all cursor-pointer';

      if (stepBtn3) {
        stepBtn3.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-white text-black font-semibold shadow-sm';
      }

      // Unlock Launch Workspace Button & Top Tab
      btnLaunchWorkspace.className = 'w-full py-3 px-6 rounded-lg bg-white hover:bg-neutral-200 text-black text-xs font-mono font-semibold uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.99] cursor-pointer';
      btnLaunchWorkspace.innerHTML = '<span>Launch Desktop Workspace</span><i class="fa-solid fa-arrow-right text-[11px]"></i>';

      tabWorkspace.className = 'px-2.5 py-0.5 rounded text-[11px] font-medium text-app-secondary hover:text-white transition-all flex items-center gap-1.5 cursor-pointer';
      tabWorkspace.removeAttribute('title');
      if (tabWorkspaceIcon) tabWorkspaceIcon.textContent = 'terminal';
    } else {
      // Lock Step 3 & Workspace
      if (step3Card) step3Card.style.opacity = '0.45';
      if (step3Badge) {
        step3Badge.textContent = !isConnected ? '🔒 Complete Steps 1 & 2 first' : '🔒 Complete Step 2 first';
        step3Badge.className = 'text-[11px] text-app-dim font-mono';
      }
      botTagInput.disabled = true;
      botTagInput.className = 'bg-transparent border-none text-app-dim font-mono text-xs focus:outline-none w-full px-1 tracking-tight cursor-not-allowed';
      btnSaveHandle.disabled = true;
      btnSaveHandle.textContent = 'Locked';
      btnSaveHandle.className = 'text-xs font-mono px-2.5 py-1 bg-app-subtle text-app-dim border border-app-border rounded transition-all cursor-not-allowed';

      if (stepBtn3) {
        stepBtn3.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-app-dim font-medium';
      }

      const lockMsg = !isConnected
        ? 'Complete Steps 1 & 2 to Unlock Workspace'
        : 'Complete Step 2 (Google Auth) to Unlock Workspace';
      btnLaunchWorkspace.className = 'w-full py-3 px-6 rounded-lg bg-app-subtle text-app-dim border border-app-border text-xs font-mono font-semibold uppercase tracking-wider flex items-center justify-center gap-2 transition-all opacity-50 cursor-not-allowed';
      btnLaunchWorkspace.innerHTML = `<span class="material-symbols-outlined text-[14px]">lock</span><span>${lockMsg}</span>`;

      tabWorkspace.className = 'px-2.5 py-0.5 rounded text-[11px] font-medium text-app-dim opacity-50 cursor-not-allowed transition-all flex items-center gap-1.5';
      tabWorkspace.setAttribute('title', lockMsg);
      if (tabWorkspaceIcon) tabWorkspaceIcon.textContent = 'lock';
    }

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
    pairingPhoneInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        btnRequestPairingCode.click();
      }
    });

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
        appendLog('info', `📡 Requesting WhatsApp pairing code for ${phone}...`);
        const res = await api?.requestPairingCode(phone);
        if (res?.success && res?.code) {
          const rawCode = String(res.code).replace(/[^a-zA-Z0-9]/g, '');
          const formatted = rawCode.length === 8 ? `${rawCode.slice(0, 4)}-${rawCode.slice(4)}` : res.code;
          pairingCodeDigits.textContent = formatted;
          pairingCodeDisplay.classList.remove('hidden');
          appendLog('info', `🔑 Pairing Code: ${formatted}. On WhatsApp: Settings -> Linked Devices -> Link with phone number -> Enter this code.`);
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

  // Google Login Click (Gated behind Step 1)
  btnGoogleLogin.addEventListener('click', async () => {
    if (!isConnected) {
      appendLog('warn', '⚠️ Complete Step 1 (Link WhatsApp) first before connecting your Google Account.');
      if (stepBtn1) {
        stepBtn1.classList.add('animate-pulse');
        setTimeout(() => stepBtn1.classList.remove('animate-pulse'), 1500);
      }
      return;
    }
    btnGoogleLogin.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Opening...';
    const res = await api?.startGoogleLogin();
    if (res?.success) {
      appendLog('info', `✅ Google OAuth (PKCE) verified: ${res.email}`);
      syncStatus();
    } else {
      appendLog('error', `Google login failed: ${res?.error || 'Unknown error'}`);
      btnGoogleLogin.textContent = isGoogleConnected ? 'Connected ✓' : 'Sign In';
    }
  });

  // Handle Save (Gated behind Step 1 & Step 2)
  btnSaveHandle.addEventListener('click', async () => {
    if (!isConnected || !isGoogleConnected) {
      appendLog('warn', '⚠️ Complete Step 1 & Step 2 first before configuring your trigger handle.');
      return;
    }
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

  // Periodic status check every 3s to guarantee QR and connection updates
  setInterval(() => {
    if (!isConnected) {
      syncStatus();
    }
  }, 3000);
});
