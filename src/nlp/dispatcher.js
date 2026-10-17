import fs from 'fs';
import path from 'path';
import { INTENTS } from './intents.js';
import {
  CONFIG,
  loadProjectsState,
  saveProjectsState,
  updateTriggerPrefix,
  isOwner,
} from '../config.js';
import {
  listProjectsForGroup,
  switchGroupProject,
  unbindGroupProject,
  getGroupProjectStatus,
  createProjectUnderMaster,
} from '../autopilot/workspace.js';
import {
  handleCollaboratorRequest,
  executeCollaboratorInvite,
} from '../autopilot/friends.js';
import {
  stopActiveTask,
  getActiveTaskInfo,
  gitCommitAndPush,
  listGitHubCollaborators,
  removeGitHubCollaborator,
} from '../agent.js';
import { captureWebScreenshot, getProjectDeploymentUrl } from '../qa.js';
import { checkAndApplyOtaUpdate, getOtaStatus } from '../ota.js';
import { geminiClient } from '../gemini-client.js';

/**
 * Dispatches a classified intent to its corresponding handler.
 * Returns { handled: true } if completely executed, or
 * returns { isCodingTask: true, ... } if the request is a coding task to be queued.
 */
export async function dispatchIntent({
  intentResult,
  sock,
  jid,
  msg,
  rawBody,
  owner,
  isGroup,
  boundProject,
  state,
  taskQueue = [],
  currentRunningItem = null,
  sendReply,
  reactToMessage,
  sendWhatsAppFile,
}) {
  const { intent, confidence } = intentResult;

  // 1. Task Control (Stop, Status, Context Reset, Append)
  if (intent === INTENTS.TASK_CONTROL) {
    const action = intentResult.taskControl?.action || 'status';

    if (action === 'stop') {
      const active = getActiveTaskInfo();
      const running = currentRunningItem;

      if (active && !owner && isGroup && active.projectAlias !== boundProject) {
        await sendReply(sock, jid, `🔒 You cannot stop a task running for another group.`, msg);
        return { handled: true };
      }

      let stoppedSomething = false;
      if (running) {
        running.cancelled = true;
        stoppedSomething = true;
      }

      const stopped = stopActiveTask();
      if (stopped) stoppedSomething = true;

      // Cancel any queued tasks for this jid
      const qIdx = taskQueue.findIndex((item) => item.jid === jid);
      if (qIdx !== -1) {
        taskQueue.splice(qIdx, 1);
        stoppedSomething = true;
      }

      await reactToMessage(sock, msg, '🛑');
      if (stoppedSomething) {
        await sendReply(sock, jid, `🛑 *Stopped.* The active task was cancelled.`, msg);
      } else {
        await sendReply(sock, jid, `⚪ Nothing is currently running or queued.`, msg);
      }
      return { handled: true };
    }

    if (action === 'status') {
      const active = getActiveTaskInfo();
      if (!active) {
        await sendReply(
          sock,
          jid,
          `🟢 *Weave is Idle*\nProject: \`${boundProject || 'unbound'}\`\nQueue: ${taskQueue.length} task(s)\n\nWhat shall we build next?`,
          msg
        );
      } else {
        await sendReply(
          sock,
          jid,
          `🟡 *Working on \`${active.projectAlias}\`:*\n"${active.taskPrompt}"\n\nQueued: ${taskQueue.length} task(s)`,
          msg
        );
      }
      return { handled: true };
    }

    if (action === 'reset_context') {
      const fresh = loadProjectsState();
      fresh.conversations = fresh.conversations || {};
      if (boundProject) {
        delete fresh.conversations[boundProject];
      }
      delete fresh.conversations[null];
      saveProjectsState(fresh);

      await reactToMessage(sock, msg, '✨');
      await sendReply(
        sock,
        jid,
        `✨ *Session context refreshed!*\nWe're starting with a clean slate for \`${boundProject || 'the active project'}\`.`,
        msg
      );
      return { handled: true };
    }

    if (action === 'append_context') {
      const note = intentResult.taskControl?.contextNote || rawBody;
      return {
        isCodingTask: true,
        taskPrompt: `By the way, additional instruction: ${note}`,
        continueSession: true,
      };
    }
  }

  // 2. Workspace Management (List, Switch/Bind, Unbind, Create, Status)
  if (intent === INTENTS.WORKSPACE_MANAGEMENT) {
    const action = intentResult.workspace?.action || 'list';
    const requestedProject = intentResult.workspace?.projectName?.trim();

    if (action === 'list') {
      try {
        const listInfo = listProjectsForGroup(jid);
        const bullets =
          listInfo.projects.length > 0
            ? listInfo.projects
                .map((p) => `• *${p}*${p === listInfo.boundAlias ? ' _(Active in this chat)_' : ''}`)
                .join('\n')
            : '_No projects found in Master Directory._';

        await sendReply(
          sock,
          jid,
          `📂 *Available Projects:*\n${bullets}\n\n💡 _To work on one, just tell me: "let's switch to <project-name>"_`,
          msg
        );
      } catch (err) {
        // Fallback to state.projects
        const keys = Object.keys(state.projects || {});
        const bullets =
          keys.length > 0
            ? keys
                .map((p) => `• *${p}*${p === boundProject ? ' _(Active)_' : ''}`)
                .join('\n')
            : '_No projects registered yet._';
        await sendReply(
          sock,
          jid,
          `📂 *Registered Projects:*\n${bullets}\n\n💡 _To work on one, tell me: "switch to <name>"_`,
          msg
        );
      }
      return { handled: true };
    }

    if (action === 'status') {
      const st = getGroupProjectStatus(jid);
      await sendReply(
        sock,
        jid,
        st.bound
          ? `📍 *Active Project in this chat:* \`${st.alias}\`\n📁 *Location:* \`${st.path}\``
          : `⚪ No project is currently bound to this chat.\n💡 _Tell me: "switch to <project-name>" to connect one._`,
        msg
      );
      return { handled: true };
    }

    if (action === 'unbind') {
      if (!owner) {
        await sendReply(sock, jid, `🔒 Only the bot owner can disconnect projects from this chat.`, msg);
        return { handled: true };
      }
      const unb = unbindGroupProject(jid);
      await sendReply(
        sock,
        jid,
        `🔓 *Disconnected from \`${unb.previous || 'project'}\`.*\nThis chat is now unbound. Tell me "switch to <project>" anytime to reconnect!`,
        msg
      );
      return { handled: true };
    }

    if (action === 'create' && requestedProject) {
      if (!owner) {
        await sendReply(sock, jid, `🔒 Only the bot owner can create new project directories.`, msg);
        return { handled: true };
      }
      try {
        const res = createProjectUnderMaster(requestedProject, jid);
        await reactToMessage(sock, msg, '📁');
        await sendReply(
          sock,
          jid,
          `📁 *Created & Connected Project: \`${res.alias}\`*\nPath: \`${res.path}\`\nThis chat is now actively working on \`${res.alias}\`.`,
          msg
        );
      } catch (err) {
        await sendReply(sock, jid, `⚠️ Could not create project: ${err.message}`, msg);
      }
      return { handled: true };
    }

    if ((action === 'switch' || action === 'bind') && requestedProject) {
      if (isGroup && !owner) {
        await sendReply(sock, jid, `🔒 Only the bot owner can switch project bindings in group chats.`, msg);
        return { handled: true };
      }
      try {
        const res = switchGroupProject(requestedProject, jid);
        await reactToMessage(sock, msg, '🔄');
        await sendReply(
          sock,
          jid,
          `🔄 *Switched Active Project to: \`${res.alias}\`*\nPath: \`${res.path}\`\nAll coding tasks in this chat will now target this project.`,
          msg
        );
      } catch (err) {
        // Check if project exists in general projects map
        const stateFresh = loadProjectsState();
        let targetAlias = null;
        for (const [alias] of Object.entries(stateFresh.projects || {})) {
          if (alias.toLowerCase() === requestedProject.toLowerCase()) {
            targetAlias = alias;
            break;
          }
        }
        if (targetAlias) {
          if (isGroup) {
            stateFresh.groupBindings = stateFresh.groupBindings || {};
            stateFresh.groupBindings[jid] = targetAlias;
          }
          stateFresh.activeProject = targetAlias;
          saveProjectsState(stateFresh);
          await reactToMessage(sock, msg, '🔄');
          await sendReply(
            sock,
            jid,
            `🔄 *Switched Active Project to: \`${targetAlias}\`*\nAll coding tasks in this chat will now target this project.`,
            msg
          );
        } else {
          await sendReply(
            sock,
            jid,
            `⚠️ Could not find project "${requestedProject}". Ask me "what projects do we have?" to view available ones.`,
            msg
          );
        }
      }
      return { handled: true };
    }
  }

  // 3. Visual QA & Screenshots
  if (intent === INTENTS.VISUAL_QA) {
    const activeProj = isGroup ? state.groupBindings?.[jid] : state.activeProject;
    const projDir = (activeProj && state.projects?.[activeProj]) || CONFIG.defaultProjectDir;
    const isMobile = Boolean(intentResult.visualQa?.isMobile);
    let target = intentResult.visualQa?.targetUrl || '';

    if (!target) {
      target = (await getProjectDeploymentUrl(projDir, activeProj)) || 'http://localhost:3000';
    }

    await reactToMessage(sock, msg, '📸');
    try {
      const { filePath, url, width, height } = await captureWebScreenshot(target, { mobile: isMobile });
      const projectLabel = activeProj ? `\n📁 *Project:* \`${activeProj}\`` : '';
      await sendWhatsAppFile(
        sock,
        jid,
        filePath,
        `📸 *Visual Preview*${projectLabel}\n🌐 *URL:* ${url}\n📐 *Resolution:* ${width}x${height}${isMobile ? ' (Mobile)' : ''}`,
        msg
      );
      await reactToMessage(sock, msg, '✅');
    } catch (err) {
      await reactToMessage(sock, msg, '❌');
      await sendReply(sock, jid, `❌ Could not capture preview: ${err.message}`, msg);
    }
    return { handled: true };
  }

  // 4. Git & GitHub Operations
  if (intent === INTENTS.GIT_GITHUB) {
    const gitAction = intentResult.git?.action || 'push';

    if (gitAction === 'push') {
      if (!boundProject || !state.projects[boundProject]) {
        await sendReply(sock, jid, `⚠️ No project is connected to this chat. Tell me "switch to <project>" first!`, msg);
        return { handled: true };
      }
      const commitMsg = intentResult.git?.commitMessage || 'Update via WhatsApp Agent';
      await reactToMessage(sock, msg, '⏳');
      try {
        const info = gitCommitAndPush(state.projects[boundProject], commitMsg);
        await reactToMessage(sock, msg, '🚀');
        await sendReply(
          sock,
          jid,
          `🚀 Pushed \`${boundProject}\` to \`${info.branch}\` (\`${info.commitHash}\`).`,
          msg
        );
      } catch (err) {
        await reactToMessage(sock, msg, '❌');
        await sendReply(sock, jid, `❌ Git push failed: ${err.message}`, msg);
      }
      return { handled: true };
    }

    if (gitAction === 'autopush_toggle') {
      if (!owner) {
        await sendReply(sock, jid, `🔒 Only the bot owner can toggle auto-push.`, msg);
        return { handled: true };
      }
      if (!boundProject || !state.projects[boundProject]) {
        await sendReply(sock, jid, `⚠️ No project connected to this chat. Connect one first!`, msg);
        return { handled: true };
      }
      const enable = intentResult.git?.enabled !== false;
      const fresh = loadProjectsState();
      fresh.autoPush = fresh.autoPush || {};
      fresh.autoPush[boundProject] = enable;
      saveProjectsState(fresh);

      await sendReply(
        sock,
        jid,
        `🚀 Automatic GitHub push for *${boundProject}* is now *${enable ? 'ON' : 'OFF'}*.`,
        msg
      );
      return { handled: true };
    }

    if (gitAction === 'collab_add' && intentResult.git?.username) {
      if (!owner) {
        await sendReply(sock, jid, `🔒 Only the bot owner can invite repository collaborators.`, msg);
        return { handled: true };
      }
      const req = handleCollaboratorRequest({
        requestedName: intentResult.git.username,
        role: 'write',
        groupJid: jid,
        projectDir: state.projects[boundProject] || CONFIG.defaultProjectDir,
      });

      if (req.status === 'unknown') {
        await sendReply(sock, jid, req.replyPrompt, msg);
        return { handled: true };
      }

      if (req.status === 'known') {
        await reactToMessage(sock, msg, '⏳');
        try {
          const res = await executeCollaboratorInvite({
            username: req.username,
            permission: req.permission,
            projectDir: state.projects[boundProject] || CONFIG.defaultProjectDir,
          });
          await reactToMessage(sock, msg, '🤝');
          await sendReply(
            sock,
            jid,
            res.isAlready
              ? `✅ *@${req.username}* is already a collaborator on \`${res.owner}/${res.repo}\`.`
              : `🤝 Invited *${req.friend.name}* (\`@${req.username}\`) to \`${res.owner}/${res.repo}\` (${res.permission}) — ${res.invitationUrl}`,
            msg
          );
        } catch (err) {
          await sendReply(sock, jid, `❌ Failed to invite @${req.username}: ${err.message}`, msg);
        }
        return { handled: true };
      }
    }

    if (gitAction === 'collab_list') {
      try {
        const info = await listGitHubCollaborators({
          projectDir: state.projects[boundProject] || CONFIG.defaultProjectDir,
        });
        const collabs = info.collaborators.map((c) => `• @${c.username} (${c.permission})`).join('\n') || '_None_';
        await sendReply(sock, jid, `👥 *Collaborators on \`${info.owner}/${info.repo}\`:*\n${collabs}`, msg);
      } catch (err) {
        await sendReply(sock, jid, `⚠️ Could not list collaborators: ${err.message}`, msg);
      }
      return { handled: true };
    }
  }

  // 5. File Operations (Send file)
  if (intent === INTENTS.FILE_OPERATIONS) {
    const rawFileName = intentResult.fileOps?.fileName;
    if (rawFileName) {
      const activeProjDir = state.projects[boundProject] || CONFIG.defaultProjectDir;
      let targetPath = path.resolve(activeProjDir, rawFileName);

      if (!fs.existsSync(targetPath)) {
        targetPath = path.resolve(process.cwd(), rawFileName);
      }

      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
        await reactToMessage(sock, msg, '📎');
        await sendWhatsAppFile(sock, jid, targetPath, `📎 *File:* \`${path.basename(targetPath)}\``, msg);
        return { handled: true };
      } else {
        await sendReply(sock, jid, `⚠️ Could not find file "${rawFileName}" in project.`, msg);
        return { handled: true };
      }
    }
  }

  // 6. Agent Lifecycle (Sleep, Wakeup, Callsign, OTA Update)
  if (intent === INTENTS.AGENT_LIFECYCLE) {
    const lifeAction = intentResult.lifecycle?.action || 'wakeup';

    if (lifeAction === 'sleep') {
      if (!owner) {
        await sendReply(sock, jid, `🔒 Only the bot owner can put Weave to sleep.`, msg);
        return { handled: true };
      }
      const fresh = loadProjectsState();
      fresh.disabledGroups = fresh.disabledGroups || {};
      fresh.disabledGroups[jid] = true;
      saveProjectsState(fresh);

      await reactToMessage(sock, msg, '😴');
      await sendReply(sock, jid, `😴 *Going to sleep in this chat.*\nSay "wake up" anytime to bring me back!`, msg);
      return { handled: true };
    }

    if (lifeAction === 'wakeup') {
      if (!owner) {
        await sendReply(sock, jid, `🔒 Only the bot owner can wake up Weave.`, msg);
        return { handled: true };
      }
      const fresh = loadProjectsState();
      fresh.disabledGroups = fresh.disabledGroups || {};
      delete fresh.disabledGroups[jid];
      saveProjectsState(fresh);

      await reactToMessage(sock, msg, '⚡');
      await sendReply(
        sock,
        jid,
        `⚡ *I'm awake and ready!*\nConnected to \`${boundProject || 'unbound'}\`. What are we building today?`,
        msg
      );
      return { handled: true };
    }

    if (lifeAction === 'callsign_change' && intentResult.lifecycle?.newCallsign) {
      if (!owner) {
        await sendReply(sock, jid, `🔒 Only the bot owner can change the call-sign.`, msg);
        return { handled: true };
      }
      const res = updateTriggerPrefix(intentResult.lifecycle.newCallsign);
      if (!res.success) {
        await sendReply(sock, jid, `⚠️ ${res.error}`, msg);
        return { handled: true };
      }
      await reactToMessage(sock, msg, '✅');
      await sendReply(
        sock,
        jid,
        `✅ *Weave Call-Sign updated to:* \`${res.triggerPrefix}\`\n\nPrompt me anytime using *${res.triggerPrefix} <task>*.`,
        msg
      );
      return { handled: true };
    }

    if (lifeAction === 'ota_update') {
      await reactToMessage(sock, msg, '⏳');
      try {
        const res = await checkAndApplyOtaUpdate({});
        await reactToMessage(sock, msg, '✅');
        if (res.updated) {
          await sendReply(
            sock,
            jid,
            `⚡ *Weave Live Update Applied!*\n• *Version:* \`v${res.version}\`\n• *Files updated:* ${res.filesUpdated}\n• *Status:* Live in-place (no restart needed)`,
            msg
          );
        } else {
          const status = getOtaStatus();
          await sendReply(sock, jid, `✅ *Weave is already up to date* (\`v${status.version}\`).`, msg);
        }
      } catch (err) {
        await sendReply(sock, jid, `⚠️ Update check failed: ${err.message}`, msg);
      }
      return { handled: true };
    }
  }

  // 7. Conversational Q&A (Informational question without file edits)
  if (intent === INTENTS.CONVERSATIONAL_QA) {
    const query = intentResult.conversationalQa?.query || rawBody;
    const directReply = intentResult.conversationalQa?.directReply;

    if (directReply) {
      await sendReply(sock, jid, directReply, msg);
      return { handled: true };
    }

    await reactToMessage(sock, msg, '💡');
    try {
      const prompt = `You are Weave, a friendly and expert developer companion on WhatsApp. Answer the user's question concisely in clear Markdown formatted for WhatsApp (1-2 short paragraphs max):\n\nQuestion: "${query}"`;
      const res = await geminiClient.generateContent(prompt);
      await sendReply(sock, jid, res.text || 'I understand, but have no additional details right now.', msg);
    } catch (err) {
      // If direct generation fails, let it fall through to coding task
      return {
        isCodingTask: true,
        taskPrompt: query,
        continueSession: false,
      };
    }
    return { handled: true };
  }

  // 8. Help / Capabilities Guide (Pure Natural Language UX - Zero Slash Commands!)
  if (intent === INTENTS.HELP_GUIDE) {
    const trig = CONFIG.triggerPrefix;
    const projLabel = boundProject ? `\`${boundProject}\`` : '_None (unbound)_';
    const helpMessage = [
      `👋 *Hi, I'm Weave!* Your natural language WhatsApp coding agent.`,
      `📍 *Current Project:* ${projLabel}`,
      '',
      `Just talk to me like a teammate using *${trig}* followed by plain English:`,
      '',
      `💻 *Code & Features:*`,
      `• *"${trig} add a dark mode toggle to the navbar"*`,
      `• *"${trig} fix the crash when clicking checkout"*`,
      `• *"${trig} make that button rounded and emerald green"*`,
      '',
      `📁 *Projects & Workspaces:*`,
      `• *"${trig} what projects do we have?"*`,
      `• *"${trig} switch this chat to portfolio-website"*`,
      `• *"${trig} start a new project called payment-gateway"*`,
      '',
      `📸 *Visual UI Previews:*`,
      `• *"${trig} show me what the landing page looks like on mobile"*`,
      `• *"${trig} screenshot localhost:3000"*`,
      '',
      `🚀 *Git & GitHub:*`,
      `• *"${trig} push our changes to github with message 'fixed navbar'"*`,
      `• *"${trig} invite @alex to collaborate on this repo"*`,
      '',
      `📎 *Files & Sharing:*`,
      `• *"${trig} send me package.json"*`,
      '',
      `🛑 *Control & Questions:*`,
      `• *"${trig} what are you working on right now?"*`,
      `• *"${trig} stop what you're doing"*`,
      `• *"${trig} how does JWT refresh token rotation work?"*`,
    ].join('\n');

    await sendReply(sock, jid, helpMessage, msg);
    return { handled: true };
  }

  // 9. Clarification Needed
  if (intent === INTENTS.CLARIFICATION_NEEDED && intentResult.clarification) {
    const { question, options } = intentResult.clarification;
    const optionBullets = (options || []).map((o, idx) => `*${idx + 1}.* ${o}`).join('\n');
    await sendReply(
      sock,
      jid,
      `🤔 *${question}*\n\n${optionBullets}\n\n_Reply with 1, 2... or tell me what you'd like to do!_`,
      msg
    );
    return { handled: true };
  }

  // 10. Default: Coding Task
  return {
    isCodingTask: true,
    taskPrompt: intentResult.codingTask?.instructions || rawBody,
    targetProject: intentResult.codingTask?.targetProject || null,
    continueSession: Boolean(intentResult.codingTask?.isContinuation),
  };
}
