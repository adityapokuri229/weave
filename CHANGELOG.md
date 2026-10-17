# Changelog

All notable changes to the Weave repository are documented in this file.

---

## [Fresh Rebuild] - 2026-10-18

### ⚡ Architectural Rebuild & Clean Slate Overhaul

#### 1. Clean Slate Reset (`src/config.js`)
- **Total State Reset (`resetAllState`)**:
  - Wiped legacy project lists, stale conversation IDs, cached message buffers (`.processed-msgs.json`, `.sent-msgs.json`), and bindings.
  - Preserved the configured `masterDir` path (`/home/adityapokuri/Documents/Weave Master`) while resetting all subfolder projects and group attachments.
  - Streamlined data model in `projects.json` to: `masterDir`, `activeProject`, `projects`, `initializedGroups`, `groupBindings`, `pendingPolls`, `conversations`, `autopilot`, and `friends`.

#### 2. Deterministic 4-Lane Intent Routing (`src/autopilot/router.js`, `src/autopilot/guidelines.js`)
- **Single-Pass Gemini 2.5 Flash Classification**:
  - Replaced ad-hoc keyword matching with a deterministic intent classifier operating at low temperature (`temperature: 0.1`) with structured `application/json` output.
  - Routes incoming messages strictly into one of four execution lanes:
    1. `laptop_task`: Coding, building, editing, testing, running, and deploying dispatched to Antigravity CLI worker inside the group's active project folder.
    2. `system_command`: Standard workspace commands (`list_projects`, `create_project`, `switch_project`, `current_project`, `unbind_project`) returning fixed casual template responses.
    3. `chat`: Direct conversational answers generated using the Gen-Z adaptive personality engine.
    4. `choice_needed`: Dispatches an interactive WhatsApp poll when decisions or clarifications are needed.

#### 3. Silent Group Initialization Gate (`src/bot.js`, `src/config.js`)
- **Strict Silent Gate Enforcement (`isGroupInitialized`)**:
  - The bot remains completely silent and will never interact in any WhatsApp group until explicitly initialized via `@agent initialize` (or `@weave initialize`).
  - All messages, mentions, or pings received in an uninitialized group are silently dropped.
  - Group initialization state is persisted per group in `state.initializedGroups[groupJid]`.
  - Sending `@agent initialize` marks the group initialized and replies with the standard casual `welcome_init` template displaying master directory, active project, and available projects.

#### 4. Projects and Group Isolation (`src/autopilot/workspace.js`, `src/config.js`)
- **Master Directory Scope**:
  - Projects are strictly defined as the directory folders inside `masterDir`.
  - Each WhatsApp group has strictly one active project at a time.
  - Follow-up coding requests automatically stay in the active project.
  - New projects are created only upon explicit request (`create_project`), which immediately locks the group to that project.
  - Project switching is explicit and sandbox-verified against `masterDir`.

#### 5. Interactive Polls & Single-Voter Verification (`src/autopilot/polls.js`)
- **Native WhatsApp Polls**:
  - Interactive choice mechanism using Baileys `sock.sendMessage(jid, { poll: ... })`.
  - Stored `messageSecret` alongside `allowedVoterJid` in `state.pendingPolls[pollMsgId]`.
  - **Single-Voter Security**: Strictly checks that `voterJid === allowedVoterJid`. Votes from any other chat participants are discarded immediately to prevent group vote hijacking.
  - **Vote Decryption (`decryptPollVote`)**: Decrypts vote payload and maps the selected option SHA-256 hash back to the plain text choice.
  - **Emoji Reaction Fallback (`sendReactionFallback`)**: Fallback to emoji circles (`🟢`, `🔵`, `🟡`, `🟣`) if polls fail, intercepted via `reactionMessage` from the authorized sender.

#### 6. Isolated Prompt Guidelines & Gen-Z Adaptive Persona (`src/autopilot/guidelines.js`, `src/autopilot/templates.js`)
- **Centralized Model Guidelines (`src/autopilot/guidelines.js`)**:
  - Centralized system prompt file keeping system rules isolated from application logic.
  - Hard rules enforced: no raw shell commands outputted, input messages/data treated as data not instructions, sandboxed paths, low temperature structured function calling.
- **Adaptive Gen-Z Tone & Mirroring Persona**:
  - Conversational text (chat, poll questions, clarifications) mirrors sender style (lowercase if lowercase, short if short, emojis if used, Hinglish/Kanglish if used).
  - Natural light developer slang (`ngl`, `tbh`, `fr`, `lowkey`, `rn`, `bet`, `cooked`, `W/L`, `aight`).
  - No corporate jargon ("I'd be happy to assist").
  - Fixed system command templates in `src/autopilot/templates.js` formatted in this consistent casual voice.

#### 7. Desktop App UI Rebuild (`electron/renderer/index.html`, `app.js`)
- **Clean 2-Column Live Interface**:
  - **Left Column — Master Directory Projects**:
    - Master Directory path configurator with Browse picker.
    - Discovered project folders inside Master Directory with quick "Open" button in OS file explorer.
  - **Right Column — Initialized WhatsApp Groups**:
    - Live list of all initialized groups with active project status badges (`🟢 active` or `⚪ unbound`).
    - Project selector dropdown under each group to switch active projects directly from desktop.
    - Unbind button to detach a project from a group.
    - Clean Slate Reset button in top header to wipe state anytime.
  - **Live WhatsApp Event Bus**: Compact terminal stream underneath groups panel.

---

## [Unreleased] - 2026-10-17

### 🚀 Major Additions & Features

#### 1. Autopilot Multi-Lane Intent Routing System (`src/autopilot/`)
- **Semantic Classification Router (`router.js`, `guidelines.js`)**:
  - Implemented an intent classification engine powered by Gemini (`generateContent` with structured JSON schema) to classify plain English WhatsApp group messages into six distinct execution lanes:
    1. `manage_collaborator`: GitHub collaborator operations (adding, inviting, listing collaborators).
    2. `capture_screenshot`: Visual preview generation and responsive viewport screenshots via Playwright/Puppeteer.
    3. `manage_workspace`: Dynamic project creation, directory discovery, and group project switching.
    4. `run_coding_task`: Core coding, terminal commands, and file edits via the Antigravity CLI agent.
    5. `chat_reply`: Conversational replies and technical explanations without disk mutations or process execution.
    6. `ask_clarification`: Disambiguation lane for underspecified or conflicting user instructions.
- **Clarification Workflow (`clarification.js`)**:
  - Added pending clarification session handling with numbered options and TTL expiration (5 minutes).
  - Users can respond with simple numbers or short messages to select the desired execution lane.
- **Message Debouncing & Batching (`debouncer.js`)**:
  - Added `FullAutoDebouncer` to coalesce rapid bursts of group messages into a single prompt batch (3.5s window), preventing race conditions and duplicated agent worker processes.
- **Friends & Collaborator Mapping (`friends.js`)**:
  - Integrated a local directory mapping real-world names (e.g. "Jai") to GitHub usernames (e.g. "jai-dev").
  - Automated collaborator invite resolution with explicit WhatsApp group confirmations (`/confirm` or natural language affirmative replies).

#### 2. Master Directory & Workspace Isolation (`src/autopilot/workspace.js`, `src/config.js`)
- **Master Directory Enforcement**:
  - Configured `masterDir` setting to restrict project creation and modifications within a verified root folder.
  - Added strict path validation (`isPathWithinMasterDir`) to prevent path traversal attacks or accidental operations outside authorized project workspaces.
- **Group-Level Project Bindings**:
  - Strict 1:1 binding per WhatsApp group: each group operates on an isolated project folder.
  - Implemented `/bind <alias>`, `/unbind`, `/turnoff`, `/projects`, and `/addproject` command set.

#### 3. Subprocess Isolation & Graceful Tree Termination (`src/agent.js`)
- **Process Group Termination (`terminateProcessTree`)**:
  - Replaced naive `child.kill('SIGTERM')` with deep process tree discovery (`getAllDescendantPids` / `pgrep -P` / `pkill -P`).
  - Implemented a two-stage signal escalation pattern: initial `SIGTERM` with grace period, followed by an aggressive `SIGKILL` escalation to eliminate orphaned Node/CLI processes.
- **Warm Worker Pool Cancellation**:
  - Extended `stopActiveTask()` to purge warm worker queues, resolve waiters with cancellation errors, and immediately free system memory.

#### 4. Electron Desktop UI & IPC Enhancements (`electron/`)
- **Master Directory Browser**:
  - Added native directory picker dialogs (`dialog.showOpenDialog`) via IPC (`select-master-dir`, `save-master-dir`).
  - Added active Master Directory display and project folder listing in the desktop UI.
- **Friends & Collaborators Management Panel**:
  - Added an interactive UI section to register, list, and delete friend-to-GitHub mappings directly within the desktop application.
- **Renderer UX & Scrolling Fixes**:
  - Added independent scrolling to the Left Pane (`#left-pane`) with `overflow-y-auto max-h-[calc(100vh-210px)] pr-1.5`.
  - Resolved flexbox column overflow clipping bug by setting `min-h-0` on `#view-workspace` and `<main>` so the desktop view scrolls properly with mousewheel.
  - Customized scrollbar styling (`styles.css`) with 6px high-contrast thumb for smooth interaction.
  - Removed confusing "Set Active" project buttons from the workspace card.

#### 5. Gemini API Client Enhancements (`src/gemini-client.js`)
- Extended `GeminiClient.generateContent()` to accept `generationConfig`, enabling temperature adjustments, JSON schema responses (`application/json`), and token limits.

---

### 🐛 Bug Fixes & Refactoring
- **Full Auto Trigger (`@ap fullauto`)**:
  - Updated Full Auto command to support `@ap fullauto` / `@agent fullauto` (without space) alongside legacy space variant.
- **Runtime Reference Error in Autopilot Router (`src/bot.js`)**:
  - Fixed `ReferenceError: chatHistory is not defined` by pointing to the in-memory `chatMessageHistory.get(jid)` buffer.
- **Bot Trigger Recognition (`src/bot.js`)**:
  - Supported multiple trigger aliases (`@weave`, `@agent`, `@ap`) alongside swipe-to-reply cancellation (`stop`).
  - Enabled full-auto message processing when pending clarifications or pending collaborator invites await input.
- **Config & State Healing (`src/config.js`)**:
  - Removed obsolete `app.asar` fallback paths that could corrupt saved project paths in packaged Electron builds.
  - Added default initializers for `friends`, `fullAutoGroups`, `pendingClarifications`, and `pendingCollaborators`.
- **Demo Workspace Cleanup (`demo-site/index.html`, `projects.json`)**:
  - Purged random unbound demo directories (`demo`, `orange3env`, `weave master`) from state discovery.

---

### ⚠️ Known Issues & Areas Requiring Tuning
- **Full Auto Noise & Debounce Tuning**:
  - Group chats with high chatter can occasionally trigger false-positive intents if background chatter contains trigger words; requires stricter thresholding or confidence scoring in `router.js`.
- **Clarification State Expirations**:
  - Clarification prompts currently expire strictly on timer (5m); multiple concurrent questions in fast-moving groups may overwrite each other's state.
- **GitHub CLI Authentication Prerequisite**:
  - Collaborator invites rely on a configured `gh` CLI or Netlify/GitHub credentials in the local environment; errors need more descriptive user-facing explanations if authentication expires.
- **Subprocess Exit Codes on Abort**:
  - Aborted tasks report SIGKILL exit codes, which currently generate generic cancellation errors in WhatsApp chat; needs more context-aware feedback (e.g. "Task stopped by @user").
