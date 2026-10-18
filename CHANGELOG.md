# Changelog

All notable changes to the Weave project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [v2.1.0] - 2026-10-18

### 🛡️ Permissions Hardening, Poll Reliability & UX Polish

#### 1. Group Permissions & Access Control (`src/bot.js`, `electron/renderer/app.js`)
- **Strict Owner-Only Default in Groups**:
  - In group chats, non-owners are strictly blocked by default from executing laptop tasks and commands.
  - Granular access can be granted dynamically by the owner using natural language (`allow <name> from now`) or revoked (`revoke <name> access`).
  - Added permissions inquiry handler (`who has perms?`, `who has permissions?`, `perms`) returning the active project permissions and authorized collaborators.
  - Enhanced Desktop UI to render `👑 Owner (Full Access)` badge and interactive collaborator permission toggles for every bound WhatsApp group.

#### 2. Risky Project Deletion Guard (`src/bot.js`)
- **Personal DM Send-to-Self Isolation**:
  - Project deletions can strictly only be performed by the verified owner in their personal WhatsApp Send-to-Self chat ("Message Yourself").
  - Any deletion attempt in a group is blocked with an advisory prompt pointing the user to their personal chat.
  - Deletions in Send-to-Self require explicit two-step confirmation (`yes` to delete or `cancel` to abort).

#### 3. Poll Reliability & Fallbacks (`src/autopilot/polls.js`, `src/bot.js`, `src/autopilot/router.js`)
- **Null Safety in Vote Resolution**:
  - Fixed `Cannot read properties of null (reading 'message')` when resolving poll votes by wrapping unwrappers in null guards and pushing synthesized message objects to the task queue.
  - Resolved `getPendingPoll is not defined` import error.
  - Refined poll triggering guidelines to only dispatch polls when a genuine choice between 2+ options is needed and cannot be inferred.
  - In router, automatically infer and activate projects if only one candidate project exists or if the project name is explicitly mentioned in the user's prompt.

#### 4. Event Bus & Duplicate Message Protection (`src/bot.js`, `electron/renderer/`)
- **In-Flight Message Deduplication**:
  - Implemented `inFlightMessageIds` lock set and immediate top-level message ID tracking to eliminate race conditions between concurrent Baileys `notify` and `append` upsert events.
  - Made the Live WhatsApp Event Bus terminal selectable and copyable with a dedicated `copy stream` button.
  - Polished desktop layout with smooth scrolling and left-side scrollbar placement.

#### 5. Dynamic Callsign & Admin Triggers (`src/bot.js`)
- **Flexible Dynamic Callsign Support**:
  - Supported `@<callsign> init` / `@<callsign> initialize` and `@agent init` / `@agent initialize`.
  - Added `@<callsign> deinit` / `@<callsign> deinitialize` and `@agent deinit` / `@agent deinitialize` allowing users to return any group back to the silent gate anytime.

---

## [v2.0.0] - 2026-10-18

### ⚡ Fresh Architectural Rebuild & Native Autonomous Operation

#### 1. Native Autonomous Operation & Autopilot Mode Deprecation
- **Removal of Autopilot Mode Toggle**:
  - Deprecated the legacy manual vs. autopilot mode toggle (`@agent autopilot`, `/fullauto`). Weave is now **natively autonomous by design**.
  - Eliminated confusing mode flags; all incoming messages across initialized WhatsApp groups flow directly into the autonomous execution pipeline without requiring manual arming.

#### 2. Clean Slate State Reset (`src/config.js`)
- **Total State Reset (`resetAllState`)**:
  - Reset stale legacy project lists, lingering conversation IDs, cached message buffers (`.processed-msgs.json`, `.sent-msgs.json`), and orphaned bindings.
  - Preserved the configured `masterDir` path (e.g., `~/Documents/Weave Master`) while cleanly resetting all project folders and group bindings.
  - Streamlined data model in `projects.json` to: `masterDir`, `activeProject`, `projects`, `initializedGroups`, `groupBindings`, `pendingPolls`, `conversations`, and `friends`.

#### 3. Deterministic 4-Lane Gemini 2.5 Flash Router (`src/autopilot/router.js`, `src/autopilot/guidelines.js`)
- **Deterministic Low-Temperature Intent Classification**:
  - Replaced ad-hoc keyword heuristics with a single-pass Gemini 2.5 Flash intent classifier operating at low temperature (`temperature: 0.1`) with structured `application/json` schema output (`responseSchema`).
  - Routes incoming messages strictly into one of four deterministic execution lanes:
    1. `laptop_task`: Coding, building, editing, testing, running commands, and deployments dispatched to the Antigravity CLI worker inside the group's active project folder.
    2. `system_command`: Standard workspace operations (`list_projects`, `create_project`, `switch_project`, `current_project`, `unbind_project`) resolved instantly with fixed casual templates.
    3. `chat`: Direct conversational answers generated using the Gen-Z adaptive personality engine without touching disk or launching background processes.
    4. `choice_needed`: Generates interactive WhatsApp polls or emoji reaction fallbacks when decisions, clarifications, or confirmations are needed.

#### 4. Silent Group Initialization Gate (`src/bot.js`, `src/config.js`)
- **Strict Silent Gate Enforcement (`isGroupInitialized`)**:
  - The bot remains completely silent and will never interact in any WhatsApp group until explicitly initialized via `@agent initialize` (or `@weave initialize`).
  - All messages, mentions, and pings received in an uninitialized group are silently dropped, preventing unintended chatter in unrelated chats.
  - Group initialization state is persisted per group in `state.initializedGroups[groupJid]`.
  - Sending `@agent initialize` marks the group initialized and replies with the standard casual `welcome_init` template displaying the master directory, active project, and available projects.

#### 5. Master Directory Projects & Strict Group Isolation (`src/autopilot/workspace.js`, `src/config.js`)
- **Master Directory Scope**:
  - Projects are strictly defined as the directory folders inside `masterDir`.
  - Enforced strict 1:1 binding per group: each WhatsApp group has strictly one active project at a time.
  - Follow-up coding requests automatically stay in the active project.
  - New projects are created only upon explicit request (`create_project`), which immediately locks the group to that project.
  - Project switching is explicit and sandbox-verified against `masterDir`.

#### 6. Single-Voter WhatsApp Polls with Decryption & Reaction Fallback (`src/autopilot/polls.js`)
- **Native WhatsApp Polls**:
  - Dispatches interactive choices using Baileys native poll messages (`sock.sendMessage(jid, { poll: ... })`).
  - Cryptographic vote decryption (`decryptPollVote`) mapping SHA-256 option hashes back to the plaintext option using `messageSecret`.
  - **Single-Voter Security**: Strictly checks that `voterJid === allowedVoterJid` against `state.pendingPolls[pollMsgId]`. Votes from any other group participants are discarded immediately to prevent group vote hijacking.
  - **Emoji Reaction Fallback (`sendReactionFallback`)**: Fallback to emoji circles (`🟢`, `🔵`, `🟡`, `🟣`) if polls fail or are unsupported, intercepted via `reactionMessage` from the authorized sender.

#### 7. Isolated Prompt Guidelines & Gen-Z Adaptive Persona (`src/autopilot/guidelines.js`, `src/autopilot/templates.js`)
- **Centralized Model Guidelines (`src/autopilot/guidelines.js`)**:
  - Centralized system prompt file keeping system rules isolated from application logic.
  - Hard security rules enforced: no raw shell commands outputted, input messages/data treated strictly as data not instructions, sandboxed paths, low temperature structured function calling.
- **Adaptive Gen-Z Tone & Mirroring Persona**:
  - Conversational text (chat, poll questions, clarifications) mirrors sender style (lowercase if lowercase, short if short, emojis if used, Hinglish/Kanglish if used).
  - Natural light developer slang (`ngl`, `tbh`, `fr`, `lowkey`, `rn`, `bet`, `cooked`, `W/L`, `aight`) without corporate jargon ("I'd be happy to assist").
  - Fixed standard casual system command templates in `src/autopilot/templates.js` formatted in this consistent casual voice.

#### 8. Live 2-Column Desktop UI Rebuild (`electron/renderer/index.html`, `app.js`)
- **Clean 2-Column Live Interface**:
  - **Left Column — Master Directory Projects**:
    - Master Directory path configurator with native directory picker.
    - Discovered project folders inside Master Directory with quick "Open" button in OS file explorer.
  - **Right Column — Initialized WhatsApp Groups**:
    - Live list of all initialized groups with active project status badges (`🟢 active` or `⚪ unbound`).
    - Project selector dropdown under each group to switch active projects directly from desktop.
    - Unbind button to detach a project from a group.
    - Clean Slate Reset button in top header to wipe state anytime.
  - **Live WhatsApp Event Bus**: Compact terminal stream underneath groups panel for real-time diagnostic logs.

---

## [v1.2.0] - 2026-10-17

### 🚀 Autonomous Autopilot Alpha, Collaborator Management & Debouncing

#### 1. Multi-Lane Semantic Intent Routing (`src/autopilot/router.js`, `src/autopilot/guidelines.js`)
- **Semantic Classification Router**:
  - Implemented an intent classification engine powered by Gemini (`generateContent` with structured JSON schema) to classify plain English WhatsApp group messages into six distinct execution lanes:
    1. `manage_collaborator`: GitHub collaborator operations (adding, inviting, listing collaborators).
    2. `capture_screenshot`: Visual preview generation and responsive viewport screenshots via Playwright/Puppeteer.
    3. `manage_workspace`: Dynamic project creation, directory discovery, and group project switching.
    4. `run_coding_task`: Core coding, terminal commands, and file edits via the Antigravity CLI agent.
    5. `chat_reply`: Conversational replies and technical explanations without disk mutations or process execution.
    6. `ask_clarification`: Disambiguation lane for underspecified or conflicting user instructions.

#### 2. Friends Directory & Collaborator Management (`src/autopilot/friends.js`)
- **Real-World Name Resolution**:
  - Integrated a local directory mapping real-world names (e.g. "Jai") to GitHub usernames (e.g. "jai-dev").
  - Automated collaborator invite resolution with explicit WhatsApp group confirmations (`/confirm` or natural language affirmative replies).
  - Added interactive Friends & Collaborators management panel in the Electron desktop UI.

#### 3. Message Debouncing & Batching (`src/autopilot/debouncer.js`)
- **Full-Auto Message Debouncer**:
  - Added `FullAutoDebouncer` to coalesce rapid bursts of group messages into a single prompt batch (3.5s window), preventing race conditions and duplicated agent worker processes.

#### 4. Ambiguity Clarification State Machine (`src/autopilot/clarification.js`)
- **Clarification Workflow**:
  - Added pending clarification session handling with numbered options and TTL expiration (5 minutes).
  - Users could respond with simple numbers or short messages to select the desired execution lane.

#### 5. Responsive Website Screenshots
- **Headless Visual Previews**:
  - Integrated Playwright/Puppeteer automation for capturing responsive viewport screenshots of local servers and web applications, sent directly back to WhatsApp chat.

---

## [v1.1.0] - 2026-10-17

### 🛡️ Process Isolation, Sandboxing & UX Fixes

#### 1. Subprocess Isolation & Graceful Tree Termination (`src/agent.js`)
- **Process Group Termination (`terminateProcessTree`)**:
  - Replaced naive `child.kill('SIGTERM')` with deep process tree discovery (`getAllDescendantPids` / `pgrep -P` / `pkill -P`).
  - Implemented a two-stage signal escalation pattern: initial `SIGTERM` with grace period, followed by an aggressive `SIGKILL` escalation to eliminate orphaned Node/CLI processes.

#### 2. Warm Antigravity CLI Worker Pool & Instant Cancellation
- **Persistent Warm Worker Pool**:
  - Added persistent stream-json `WarmWorker` pool with system clock synchronization for reduced startup latency.
  - Extended `stopActiveTask()` to purge warm worker queues, resolve waiters with cancellation errors, and immediately free system memory upon user cancellation.

#### 3. Master Directory Path Sandboxing (`src/autopilot/workspace.js`, `src/config.js`)
- **Path Traversal Defense**:
  - Added strict path validation (`isPathWithinMasterDir`) to prevent path traversal attacks or accidental operations outside authorized project workspaces.

#### 4. Desktop Flexbox Scroll & UX Fixes (`electron/renderer/`)
- **Independent Scrolling & Overflow Resolution**:
  - Added independent scrolling to the Left Pane (`#left-pane`) with `overflow-y-auto max-h-[calc(100vh-210px)] pr-1.5`.
  - Resolved flexbox column overflow clipping bug by setting `min-h-0` on `#view-workspace` and `<main>` so the desktop view scrolls properly with mousewheel.
  - Customized scrollbar styling (`styles.css`) with 6px high-contrast thumb for smooth interaction.
  - Removed confusing "Set Active" project buttons from the workspace card.

#### 5. Over-The-Air (OTA) & Session Fixes (`src/ota.js`, `src/bot.js`)
- **Disable OTA via Environment Variable**:
  - Added `DISABLE_OTA=true` environment variable support to disable automatic OTA updates and prevent overwriting local fork modifications.
- **Session Continuity**:
  - Added project conversation session persistence with `/btw` and `/new` commands, fixing reference errors in `/btw` command handlers.

---

## [v1.0.0] - 2026-10-16

### 📦 Initial Weave Core & Desktop App

#### 1. WhatsApp Baileys Integration (`src/bot.js`)
- **Headless WhatsApp Web Multi-Device Bridge**:
  - Multi-device WhatsApp Web connectivity powered by `@whiskeysockets/baileys`.
  - Real-time QR code generation and streaming in both terminal and Electron desktop UI.
  - Interactive 8-digit WhatsApp pairing code alternative for phone-number based pairing without camera scanning.
  - Automatic reconnection handling, credential persistence in `auth_info_baileys`, and auto-clearing stale credentials on 401 `loggedOut`.

#### 2. Google OAuth 2.0 PKCE & Gemini Client (`src/auth.js`, `src/gemini-client.js`)
- **Secure PKCE Authentication**:
  - Google OAuth 2.0 PKCE flow for direct client-side authentication without embedding client secrets.
  - Native Google PKCE sign-in modal in the desktop application.
  - Integrated Gemini API client supporting model execution (`gemini-2.5-flash`), custom `generationConfig`, token limits, and structured JSON generation.

#### 3. Electron Desktop Application with Stitch UI (`electron/`)
- **Minimalist Monochrome Desktop App**:
  - Cross-platform desktop client for Linux (AppImage), macOS (.dmg/.zip), and Windows (.exe/.zip).
  - Stitch monochrome black & white design system across all application screens.
  - Step-by-step onboarding wizard: JS Runtime check -> WhatsApp QR/Pairing code -> Google PKCE authentication -> Workspace.
  - Real-time diagnostic console and status indicator bar.

#### 4. Antigravity CLI Process Execution (`src/agent.js`, `bin/weave.js`)
- **Coding Agent Bridge**:
  - Core execution engine bridging incoming WhatsApp chat commands to local Antigravity CLI processes.
  - Real-time streaming of stdout/stderr logs back to WhatsApp chat and desktop console.
  - CLI launcher binary (`bin/weave.js`) with custom `@weave` call-sign.

#### 5. Live Over-The-Air (OTA) Updates (`src/ota.js`)
- **Automated Update System**:
  - Built-in Over-The-Air update mechanism checking upstream releases and updating runtime assets seamlessly without full application reinstallation.
