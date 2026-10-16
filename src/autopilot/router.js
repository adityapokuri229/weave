import { GeminiClient } from '../gemini-client.js';
import { AUTOPILOT_ROUTER_SYSTEM_PROMPT } from './guidelines.js';
import { getFriends, loadProjectsState } from '../config.js';
import { listProjectsForGroup, getGroupProjectStatus } from './workspace.js';

let geminiClientInstance = null;

function getGeminiClient() {
  if (!geminiClientInstance) {
    geminiClientInstance = new GeminiClient();
  }
  return geminiClientInstance;
}

/**
 * Routes incoming plain English user messages into the appropriate Autopilot execution lane.
 */
export async function routeAutopilotIntent({ prompt, groupJid, recentHistory = [] }) {
  const gemini = getGeminiClient();
  const state = loadProjectsState();
  const friends = getFriends();
  
  let workspaceContext = {
    masterDir: state.masterDir || '',
    boundProject: state.groupBindings?.[groupJid] || null,
    availableProjects: [],
  };

  try {
    const listInfo = listProjectsForGroup(groupJid);
    workspaceContext.availableProjects = listInfo.projects || [];
  } catch {
    // If masterDir is not set yet, availableProjects remains empty
  }

  const promptPayload = [
    `Current Workspace Context:`,
    `- Master Directory: ${workspaceContext.masterDir ? `"${workspaceContext.masterDir}"` : 'NOT_SET'}`,
    `- Bound Active Project in this WhatsApp group: ${workspaceContext.boundProject ? `"${workspaceContext.boundProject}"` : 'NONE'}`,
    `- Subprojects inside Master Directory: ${JSON.stringify(workspaceContext.availableProjects)}`,
    `- Registered Friends (Name -> GitHub): ${JSON.stringify(friends.map(f => ({ name: f.name, github: f.github })))}`,
    '',
    `Recent Conversation Context:`,
    recentHistory.length > 0
      ? recentHistory.map(m => `[${m.sender}]: ${m.text}`).join('\n')
      : '(No prior messages)',
    '',
    `User Incoming Message:`,
    `"${prompt}"`,
    '',
    `Respond ONLY with a JSON object adhering to this schema:`,
    `{`,
    `  "lane": "manage_collaborator" | "capture_screenshot" | "manage_workspace" | "run_coding_task" | "chat_reply" | "ask_clarification",`,
    `  "confidence": 0.0 to 1.0,`,
    `  "collaborator": { "name": string, "action": "add"|"remove"|"list", "role": "write"|"read"|"admin" },`,
    `  "screenshot": { "target": string, "isMobile": boolean },`,
    `  "workspace": { "action": "create"|"switch"|"list"|"status"|"unbind", "projectName": string },`,
    `  "codingTask": { "instructions": string },`,
    `  "chatReply": { "responseText": string },`,
    `  "clarification": { "question": string, "options": string[] }`,
    `}`
  ].join('\n');

  try {
    const res = await gemini.generateContent(
      promptPayload,
      AUTOPILOT_ROUTER_SYSTEM_PROMPT,
      { responseMimeType: 'application/json' }
    );

    let parsed = null;
    try {
      parsed = JSON.parse(res.text);
    } catch {
      // Fallback: extract json block
      const match = res.text.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      }
    }

    if (!parsed || !parsed.lane) {
      return {
        lane: 'chat_reply',
        chatReply: { responseText: res.text || 'How can I assist you with the project?' },
        confidence: 0.5,
      };
    }

    // Safety checks & Edge cases:
    // If user wants coding task but group has no bound project
    if (parsed.lane === 'run_coding_task' && !workspaceContext.boundProject) {
      if (workspaceContext.availableProjects.length > 0) {
        return {
          lane: 'ask_clarification',
          clarification: {
            question: 'This group does not have an active project bound yet. Which project should I work on?',
            options: workspaceContext.availableProjects.slice(0, 4).map(p => `Use project "${p}"`),
          },
          confidence: 0.9,
        };
      } else {
        return {
          lane: 'ask_clarification',
          clarification: {
            question: 'No projects exist under your Master Directory yet. What should we name your new project?',
            options: ['Create new project "app"', 'List master directory'],
          },
          confidence: 0.9,
        };
      }
    }

    // If confidence is low or conflict detected
    if (typeof parsed.confidence === 'number' && parsed.confidence < 0.70) {
      return {
        lane: 'ask_clarification',
        clarification: {
          question: `I noticed your message could mean multiple actions. How would you like me to proceed?`,
          options: [
            'Interact with project code and files',
            'Take a visual screenshot / preview the website',
            'Ask a general question',
          ],
        },
        confidence: parsed.confidence,
      };
    }

    return parsed;
  } catch (err) {
    console.error('⚠️ Autopilot router failed, falling back to chat:', err.message);
    return {
      lane: 'chat_reply',
      chatReply: { responseText: `I encountered an issue processing that: ${err.message}` },
      confidence: 0.3,
    };
  }
}
