# Weave — WhatsApp Agent Bridge for Google Antigravity (`agy`)

Bridge your local **Google Antigravity (`agy`) Gemini Coding Agent** directly with WhatsApp. Prompt, review, debug, build websites, inspect screenshots, and schedule meetings from anywhere using WhatsApp group chats or direct messages.

---

## ✨ Features

- 💬 **WhatsApp Natural Language Coding**: Chat with your local Antigravity agent using text or voice notes.
- 🔒 **Project Isolation & Group Binding**: Lock specific WhatsApp groups to dedicated project folders (`/bind <project>`) so team members cannot access other directories.
- 🎙️ **Voice Note Transcription**: Send WhatsApp audio or voice messages — automatically transcribed via Whisper/Groq or local engine.
- 📸 **Visual QA & Screenshots**: Take automated web snapshots with `@agent /screenshot` or phone-sized viewports (`/screenshot mobile`).
- 📎 **Direct File Transfers**: Send local files, downloads, or build artifacts straight to WhatsApp or contacts.
- 📅 **Google Calendar & Email Sync**: Schedule meetings with natural language; the agent prepares and delivers RFC 5545 `.ics` invitations and drafts emails.
- 🤝 **GitHub Integration**: Manage collaborators and auto-push commits directly via chat commands.

---

## 🚀 Quick Start

### 1. Prerequisites

- **Node.js** v18.0.0 or higher
- **Google Antigravity (`agy`) CLI** installed and signed in on your system
- (Optional) **Firefox** installed for headless visual QA screenshots
- (Optional) **Groq API Key** for ultra-fast Whisper speech-to-text transcription

### 2. Download & Install

Clone or download this repository:

```bash
git clone https://github.com/<your-username>/weave.git
cd weave
npm install
```

### 3. Start the Bridge

```bash
npm start
```

On first run, the bridge automatically initializes `.env` from `.env.example`.

A QR code will display directly in your terminal:
1. Open **WhatsApp** on your phone.
2. Tap **Settings** (or three dots) → **Linked Devices** → **Link a Device**.
3. Scan the terminal QR code.

*(Prefer an 8-digit code instead of scanning a QR? Set `PAIRING_PHONE_NUMBER=1234567890` in `.env` and run `npm start`.)*

---

## ⚙️ Configuration (`.env`)

Edit `.env` to configure your environment:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `BOT_TRIGGER` | `@agent` | Prefix keyword to trigger the bot in chats |
| `DEFAULT_PROJECT_DIR` | `./demo-site` | Fallback directory for tasks when no project is specified |
| `AGY_BIN` | `agy` | Path to the Antigravity CLI binary |
| `AGY_MODEL` | *(empty)* | Optional model override (e.g. `gemini-3.8-flash-high`) |
| `ALLOWED_SENDERS` | `*` | Comma-separated phone numbers allowed to trigger tasks (`*` = anyone) |
| `ADMIN_NUMBERS` | *(empty)* | Phone numbers granted owner permissions across devices |
| `ALLOW_FROM_ME` | `true` | Allows triggering the bot from your own linked WhatsApp account |
| `TASK_TIMEOUT_MS` | `600000` | Task execution timeout in milliseconds (default: 10 mins) |
| `PAIRING_PHONE_NUMBER` | *(empty)* | Phone number for pairing code authentication instead of QR |
| `GROQ_API_KEY` | *(empty)* | Optional API key for instant Whisper voice note transcription |
| `SMTP_HOST` | `smtp.gmail.com` | SMTP host for calendar invites and email drafts |
| `SMTP_PORT` | `465` | SMTP port (SSL) |
| `SMTP_USER` | *(empty)* | SMTP login username |
| `SMTP_PASS` | *(empty)* | SMTP app password |
| `OWNER_EMAIL` | *(empty)* | Registered owner email address for calendar invites & drafts |

---

## 📖 Commands

| Command | Description |
| :--- | :--- |
| `@agent <task>` | Execute a task on the active project directory |
| `@agent [alias] <task>` | Run a task targeting a specific project alias |
| `@agent -c <task>` | Continue the previous conversation context |
| `@agent /projects` | List all discovered and registered projects |
| `@agent /project <alias>` | Switch the active project folder |
| `@agent /addproject <alias> <path>` | Register a new project directory |
| `@agent /bind <alias>` | Lock the current WhatsApp group to a specific project *(Owner only)* |
| `@agent /unbind` | Remove the project lock from the current group *(Owner only)* |
| `@agent /screenshot [url]` | Take a headless screenshot preview |
| `@agent /send <file>` | Send a file from your system to the chat |
| `@agent /status` | Check the status of running tasks and queue |
| `@agent /stop` | Cancel the currently running agent task |
| `@agent /help` | Display list of available commands |

---

## 💡 Example WhatsApp Prompts

- `@agent create a modern hero section with Tailwind CSS and an emerald CTA button`
- `@agent [mysite] add dark mode toggle with persistent localStorage`
- `@agent -c make the cards responsive on mobile devices`
- `@agent /screenshot http://localhost:3000`
- **Voice Notes**: Send an audio message tagging `@agent` to prompt hands-free!

---

## 🔒 Security & Privacy

- **Session Isolation**: Baileys session keys, credentials, and state databases are strictly ignored by `.gitignore` and never committed to version control.
- **Group Sandbox**: Group members in bound groups are strictly isolated to their assigned folder and cannot traverse directories or run commands on other host paths.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
