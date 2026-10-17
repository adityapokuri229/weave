import { dispatchIntent } from '../../nlp/dispatcher.js';
import { classifyUserIntent } from '../../nlp/classifier.js';

async function testCabDispatch() {
  console.log('🧪 Testing End-to-End Cab Dispatch Pipeline...\n');

  let sentReplies = [];
  let reactions = [];

  const mockSock = {};
  const mockMsg = {
    key: { remoteJid: '1234567890@s.whatsapp.net', fromMe: false },
    pushName: 'Alex',
    message: { conversation: '@weave book a cab from Indiranagar to Kempegowda Airport' },
  };

  const sendReply = async (sock, jid, text, msg) => {
    sentReplies.push({ jid, text });
  };

  const reactToMessage = async (sock, msg, emoji) => {
    reactions.push(emoji);
  };

  const sendWhatsAppFile = async () => {};

  const rawBody = 'book a cab from Indiranagar to Kempegowda Airport';

  // Step 1: Classify
  const intentResult = await classifyUserIntent({
    text: rawBody,
    groupJid: '1234567890@s.whatsapp.net',
    senderName: 'Alex',
  });

  console.log(`Intent Classified: ${intentResult.intent} (Confidence: ${intentResult.confidence})`);
  console.log('Extracted Params:', intentResult.cabBooking);

  if (intentResult.intent !== 'cab_booking') {
    throw new Error(`Expected cab_booking, got ${intentResult.intent}`);
  }

  // Step 2: Dispatch
  const dispatchRes = await dispatchIntent({
    intentResult,
    sock: mockSock,
    jid: '1234567890@s.whatsapp.net',
    msg: mockMsg,
    rawBody,
    owner: true,
    isGroup: false,
    boundProject: null,
    state: {},
    taskQueue: [],
    currentRunningItem: null,
    sendReply,
    reactToMessage,
    sendWhatsAppFile,
  });

  console.log('\nDispatch Result Handled:', dispatchRes.handled);
  console.log('Reactions Added:', reactions);
  console.log('\n--- WhatsApp Card Sent to User ---');
  console.log(sentReplies[0]?.text);
  console.log('----------------------------------\n');

  if (!dispatchRes.handled || sentReplies.length === 0) {
    throw new Error('Cab intent was not handled or no reply was sent');
  }

  console.log('✅ End-to-End Cab Dispatch Test Passed Successfully!');
}

testCabDispatch().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
