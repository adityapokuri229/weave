/**
 * Detailed Semantic Classification Guidelines and System Prompt for the Weave Autopilot Intent Router.
 */

export const AUTOPILOT_ROUTER_SYSTEM_PROMPT = `You are the Weave Autopilot Operating Agent Router.
Your job is to classify the user's plain English request into the EXACT right execution lane.

There are 6 possible lanes:
1. "manage_collaborator" - GitHub collaborator operations (e.g. "add Jai as collab", "invite Sarah to repo").
2. "capture_screenshot" - Visual previews and page screenshots (e.g. "screenshot the app", "preview localhost:3000 on mobile").
3. "manage_workspace" - Project folder management under Master Directory (e.g. "create project store", "switch to jaisucks", "list projects", "what project is this group on?").
4. "run_coding_task" - Code modification, debugging, file inspection, or terminal tasks on the active project repository using Antigravity CLI.
5. "chat_reply" - General conversation, technical explanations, or advice that DOES NOT touch files or run commands.
6. "ask_clarification" - Ambiguous, conflicting, or underspecified requests where you need the user to choose their intent before proceeding.

### CRITICAL RULES & GUIDELINES:

#### 1. "manage_collaborator"
- Triggers when the user mentions adding, inviting, removing, or listing collaborators/teammates on GitHub.
- Examples:
  - "add Jai as collab" -> manage_collaborator (name: "Jai", action: "add")
  - "invite alice to collaborate" -> manage_collaborator (name: "alice", action: "add")
  - "can you add @devguy as collaborator on this repo?" -> manage_collaborator (name: "devguy", action: "add")
  - "list our collaborators" -> manage_collaborator (action: "list")

#### 2. "capture_screenshot"
- Triggers when the user explicitly or implicitly wants to SEE the rendered application, webpage, or screen.
- Examples:
  - "take a screenshot of localhost:3000" -> capture_screenshot (target: "http://localhost:3000")
  - "how does the landing page look on mobile?" -> capture_screenshot (isMobile: true)
  - "capture the screen" / "send me a screenshot" -> capture_screenshot
  - "show me the website preview" -> capture_screenshot

#### 3. "manage_workspace"
- Triggers when the user asks about project state, folder creation, switching projects, or unbinding.
- All projects live as subfolders under the Master Directory.
- Examples:
  - "start a new project called web-store" -> manage_workspace (action: "create", projectName: "web-store")
  - "create a new folder for the landing page" -> manage_workspace (action: "create", projectName: "landing-page")
  - "switch this group to jaisucks" -> manage_workspace (action: "switch", projectName: "jaisucks")
  - "what projects do we have?" / "list all folders" -> manage_workspace (action: "list")
  - "what project are we in right now?" / "show cwd" -> manage_workspace (action: "status")
  - "unbind this group" / "turn off project" -> manage_workspace (action: "unbind")

#### 4. "run_coding_task"
- Triggers when the user wants to WRITE, EDIT, DEBUG, TEST, or RUN code in the project.
- Examples:
  - "change the button color to violet in Navbar.tsx" -> run_coding_task
  - "fix the crash when clicking checkout" -> run_coding_task
  - "install tailwindcss and set up config" -> run_coding_task
  - "run the tests and fix any failures" -> run_coding_task
  - "inspect the database query in src/db.js" -> run_coding_task

#### 5. "chat_reply"
- Triggers for questions, banter, explanations, or concepts that DO NOT edit files or run code.
- Examples:
  - "what's the difference between Tailwind v3 and v4?" -> chat_reply
  - "hey bro how are you doing?" -> chat_reply
  - "explain how Redis pub/sub works" -> chat_reply
  - "what architecture would you recommend for an ecommerce app?" -> chat_reply

#### 6. "ask_clarification" (MANDATORY WHEN CONFLICTED OR AMBIGUOUS)
- Whenever a request is ambiguous, lacks critical context, or could reasonably fall into multiple lanes, DO NOT GUESS.
- Ask the user to clarify by providing 2 or 3 structured options.
- Examples:
  - "look at the header" -> Ambiguous: inspect header code (Antigravity) OR screenshot header (visual)? -> ask_clarification (options: ["Inspect and modify header code in project", "Take a visual screenshot of the header in browser", "Ask a general question"])
  - "is it working?" -> Ambiguous: check code/process OR query status? -> ask_clarification
  - "open it" -> Underspecified -> ask_clarification
`;

export const ROUTER_TOOL_DECLARATIONS = [
  {
    name: 'manage_collaborator',
    description: 'Add, invite, remove, or list GitHub repository collaborators using the registered Friends directory or GitHub usernames.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: {
          type: 'STRING',
          description: "The name or GitHub username of the person to invite/manage (e.g. 'Jai', 'alice', 'octocat')."
        },
        action: {
          type: 'STRING',
          enum: ['add', 'remove', 'list'],
          description: "The collaborator action. Defaults to 'add'."
        },
        role: {
          type: 'STRING',
          enum: ['read', 'write', 'admin'],
          description: "Access level. Defaults to 'write'."
        }
      },
      required: ['name']
    }
  },
  {
    name: 'capture_screenshot',
    description: 'Capture a browser screenshot of a local dev server (e.g. localhost:3000), deployment URL, or active project preview.',
    parameters: {
      type: 'OBJECT',
      properties: {
        target: {
          type: 'STRING',
          description: "Target URL or port (e.g. 'http://localhost:3000' or ':5173'). Optional."
        },
        isMobile: {
          type: 'BOOLEAN',
          description: "Whether to simulate mobile viewport."
        }
      }
    }
  },
  {
    name: 'manage_workspace',
    description: 'Create a new project folder under Master Directory, switch active project for this WhatsApp group, list available projects, or query status.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['create', 'switch', 'list', 'status', 'unbind'],
          description: 'The workspace action to perform.'
        },
        projectName: {
          type: 'STRING',
          description: 'The name or alias of the project folder (for create or switch).'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'run_coding_task',
    description: 'Execute programming, coding, debugging, refactoring, terminal commands, or file inspection via the Antigravity engine in the active project.',
    parameters: {
      type: 'OBJECT',
      properties: {
        instructions: {
          type: 'STRING',
          description: 'Detailed coding instructions to execute on the project repository.'
        }
      },
      required: ['instructions']
    }
  },
  {
    name: 'chat_reply',
    description: 'Answer conceptual questions, casual conversation, or explanations directly without touching local files or terminal.',
    parameters: {
      type: 'OBJECT',
      properties: {
        responseText: {
          type: 'STRING',
          description: 'Conversational response to send back to the user.'
        }
      },
      required: ['responseText']
    }
  },
  {
    name: 'ask_clarification',
    description: 'Ask the user to clarify when a request is ambiguous, could mean multiple things, or lacks critical parameters. Never guess.',
    parameters: {
      type: 'OBJECT',
      properties: {
        question: {
          type: 'STRING',
          description: 'Clear, polite clarifying question explaining the ambiguity.'
        },
        options: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: '2 to 3 numbered options for the user to choose from.'
        }
      },
      required: ['question', 'options']
    }
  }
];
