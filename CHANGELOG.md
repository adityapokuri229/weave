# Changelog

All notable changes to the Weave repository are documented in this file.

---

## [Unreleased] - 2026-10-17

### 🚀 Major Additions & Features

#### 1. Autonomous Cab & Ride Booking Concierge (`src/concierge/cabs/`, `src/concierge/location.js`)
- **Autonomous End-to-End Ride Dispatch**:
  - Automatically assesses distance, traffic, and vehicle categories (Auto, Bike, Economy, Premier, XL).
  - Selects the optimal economical option, dispatches the booking, and delivers the **4-digit Ride Start OTP / PIN** directly to WhatsApp.
- **Intelligent Trade-off Clarifications**:
  - Detects notable price vs. wait-time trade-offs and prompts the user with concise options (e.g. *Reply 1 for fastest, 2 for lowest fare*).
- **Active Ride Tracking & Zero-Fee Cancellation**:
  - Real-time ride status queries (`@weave where is my cab?`) showing updated driver ETA and repeating the OTP.
  - One-tap cancellation (`@weave cancel cab`) with zero cancellation fees.
- **Multi-Tier Location Engine (`src/concierge/location.js`)**:
  - Automatically resolves pickup coordinates from shared WhatsApp location pins, saved locations (`/setlocation`), or IP geolocation.
  - Geocodes text queries via OpenStreetMap Nominatim and calculates road distances/durations using OSRM routing.
- **Global & Regional Support**:
  - India: Auto (`🛺`), Bike (`🏍️`), Uber Go (`🚗`), Ola Mini (`🚙`), Uber Premier (`🚘`), Uber XL (`🚐`).
  - US/Global: UberX, Lyft Standard, Uber Comfort, Uber Black, Uber XL, Lyft XL.

#### 2. Autopilot Multi-Lane Intent Routing System (`src/autopilot/`)
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
