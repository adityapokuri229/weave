import crypto from 'crypto';
import { decryptPollVote, jidNormalizedUser } from '@whiskeysockets/baileys';
import { savePendingPoll, getPendingPoll, deletePendingPoll } from '../config.js';

const FALLBACK_EMOJIS = ['🟢', '🔵', '🟡', '🟣', '🟠', '🔴', '⚪', '🟤'];

/**
 * Sends a WhatsApp poll for interactive choices.
 * Falls back to emoji reactions if poll sending fails.
 */
export async function sendChoicePoll(sock, {
  groupJid,
  allowedVoterJid,
  question,
  options = [],
  intent = 'choice_needed',
  originalTask = '',
  context = '',
}) {
  const cleanOptions = options
    .map((o) => String(o).trim())
    .filter(Boolean)
    .slice(0, 12);

  if (cleanOptions.length === 0) {
    throw new Error('sendChoicePoll requires at least one option.');
  }

  const normalizedVoter = jidNormalizedUser(allowedVoterJid);
  const pollCreatorJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;

  try {
    const sent = await sock.sendMessage(groupJid, {
      poll: {
        name: question,
        values: cleanOptions,
        selectableCount: 1,
      },
    });

    const pollMsgId = sent.key?.id;
    const rawSecret = sent.message?.messageContextInfo?.messageSecret;
    const messageSecret = rawSecret ? Buffer.from(rawSecret).toString('base64') : null;

    savePendingPoll(pollMsgId, {
      pollMsgId,
      allowedVoterJid: normalizedVoter,
      pollCreatorJid,
      groupJid,
      question,
      options: cleanOptions,
      intent,
      originalTask,
      context,
      messageSecret,
      isReactionFallback: false,
    });

    console.log(`📊 Sent WhatsApp poll [${pollMsgId}] to ${groupJid} (voter: ${normalizedVoter})`);
    return { success: true, mode: 'poll', messageId: pollMsgId };
  } catch (err) {
    console.warn(`⚠️ Native poll failed (${err.message}). Falling back to reactions.`);
    return sendReactionFallback(sock, {
      groupJid,
      allowedVoterJid: normalizedVoter,
      question,
      options: cleanOptions,
      intent,
      originalTask,
      context,
    });
  }
}

/**
 * Fallback: Sends a message formatted with emoji options and waits for reaction from original sender.
 */
export async function sendReactionFallback(sock, {
  groupJid,
  allowedVoterJid,
  question,
  options = [],
  intent = 'choice_needed',
  originalTask = '',
  context = '',
}) {
  const emojiMap = {};
  const lines = [question, ''];

  options.forEach((opt, idx) => {
    const emoji = FALLBACK_EMOJIS[idx] || `${idx + 1}️⃣`;
    emojiMap[emoji] = opt;
    lines.push(`${emoji} ${opt}`);
  });

  lines.push('');
  lines.push('👉 _React with the emoji of your choice (only original sender can vote)_');

  const textBody = lines.join('\n');
  const sent = await sock.sendMessage(groupJid, { text: textBody });
  const msgId = sent.key?.id;

  savePendingPoll(msgId, {
    pollMsgId: msgId,
    allowedVoterJid: jidNormalizedUser(allowedVoterJid),
    groupJid,
    question,
    options,
    emojiMap,
    intent,
    originalTask,
    context,
    isReactionFallback: true,
  });

  console.log(`📊 Sent reaction fallback [${msgId}] to ${groupJid}`);
  return { success: true, mode: 'reaction', messageId: msgId };
}

/**
 * Handles incoming poll vote updates.
 * Strictly verifies voter is the original sender.
 */
export async function handlePollVote(sock, msg) {
  const pollUpdate = msg.message?.pollUpdateMessage;
  if (!pollUpdate) return null;

  const creationKey = pollUpdate.pollCreationMessageKey;
  const pollMsgId = creationKey?.id;
  if (!pollMsgId) return null;

  const pending = getPendingPoll(pollMsgId);
  if (!pending) return null;

  const rawVoter = msg.key.participant || msg.key.remoteJid;
  const voterJid = jidNormalizedUser(rawVoter);
  const allowedVoter = jidNormalizedUser(pending.allowedVoterJid);

  // SECTION 5: "Only the person who sent the original message can answer. Ignore everyone else's votes."
  if (voterJid !== allowedVoter) {
    console.log(`🔒 Discarded poll vote from unauthorized user: ${voterJid} (allowed: ${allowedVoter})`);
    return null;
  }

  let chosenOption = null;

  try {
    if (pollUpdate.vote?.encPayload && pending.messageSecret) {
      const decrypted = decryptPollVote(
        {
          encPayload: pollUpdate.vote.encPayload,
          encIv: pollUpdate.vote.encIv,
        },
        {
          pollCreatorJid: pending.pollCreatorJid,
          pollMsgId: pending.pollMsgId,
          pollEncKey: Buffer.from(pending.messageSecret, 'base64'),
          voterJid: voterJid,
        }
      );

      const selectedHashBufs = decrypted.selectedOptions || [];
      if (selectedHashBufs.length > 0) {
        const votedHashHex = Buffer.from(selectedHashBufs[0]).toString('hex');
        for (const opt of pending.options) {
          const optHashHex = crypto.createHash('sha256').update(opt).digest('hex');
          if (optHashHex === votedHashHex) {
            chosenOption = opt;
            break;
          }
        }
      }
    }
  } catch (err) {
    console.warn(`⚠️ Failed to decrypt poll vote: ${err.message}`);
  }

  if (chosenOption) {
    deletePendingPoll(pollMsgId);
    return {
      resolved: true,
      chosenOption,
      pending,
      voterJid,
      groupJid: pending.groupJid,
    };
  }

  return null;
}

/**
 * Handles incoming reaction votes (fallback for polls).
 * Strictly verifies voter is the original sender.
 */
export async function handleReactionVote(sock, msg) {
  const reaction = msg.message?.reactionMessage;
  if (!reaction) return null;

  const targetMsgId = reaction.key?.id;
  if (!targetMsgId) return null;

  const pending = getPendingPoll(targetMsgId);
  if (!pending || !pending.isReactionFallback) return null;

  const rawVoter = msg.key.participant || msg.key.remoteJid;
  const voterJid = jidNormalizedUser(rawVoter);
  const allowedVoter = jidNormalizedUser(pending.allowedVoterJid);

  if (voterJid !== allowedVoter) {
    console.log(`🔒 Discarded reaction vote from unauthorized user: ${voterJid} (allowed: ${allowedVoter})`);
    return null;
  }

  const emoji = reaction.text;
  const chosenOption = pending.emojiMap?.[emoji];

  if (chosenOption) {
    deletePendingPoll(targetMsgId);
    return {
      resolved: true,
      chosenOption,
      pending,
      voterJid,
      groupJid: pending.groupJid,
    };
  }

  return null;
}
