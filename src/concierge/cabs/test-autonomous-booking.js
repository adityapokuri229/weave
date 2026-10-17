import { dispatchIntent } from '../../nlp/dispatcher.js';
import { classifyUserIntent } from '../../nlp/classifier.js';

async function testAutonomousBookingFlow() {
  console.log('🧪 Starting Autonomous Cab Booking & OTP Test...\n');

  const jid = 'passenger_9876543210@s.whatsapp.net';
  let lastReply = '';
  let reactions = [];

  const mockSock = {};
  const mockMsg = {
    key: { remoteJid: jid, fromMe: false },
    pushName: 'Alex',
    message: { conversation: '' },
  };

  const sendReply = async (sock, toJid, text) => {
    lastReply = text;
  };

  const reactToMessage = async (sock, msg, emoji) => {
    reactions.push(emoji);
  };

  const sendWhatsAppFile = async () => {};

  async function simulateUserMessage(text) {
    lastReply = '';
    const intentResult = await classifyUserIntent({
      text,
      groupJid: jid,
      senderName: 'Alex',
    });

    await dispatchIntent({
      intentResult,
      sock: mockSock,
      jid,
      msg: mockMsg,
      rawBody: text,
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

    return lastReply;
  }

  // Scenario 1: User says "book a cab to Airport"
  console.log('Step 1: User asks "book a cab from Indiranagar to Kempegowda Airport"');
  const bookReply = await simulateUserMessage('book a cab from Indiranagar to Kempegowda Airport');
  console.log('\n--- Bot Reply ---');
  console.log(bookReply);
  console.log('-----------------\n');

  if (!bookReply.includes('YOUR RIDE START OTP')) {
    throw new Error('Expected Ride Start OTP in confirmation card!');
  }
  if (!bookReply.includes('License Plate:')) {
    throw new Error('Expected vehicle license plate in confirmation card!');
  }

  // Scenario 2: User queries live status: "where is my cab?"
  console.log('Step 2: User asks "where is my cab?"');
  const statusReply = await simulateUserMessage('where is my cab?');
  console.log('\n--- Bot Reply ---');
  console.log(statusReply);
  console.log('-----------------\n');

  if (!statusReply.includes('Active Ride Status') || !statusReply.includes('Start OTP')) {
    throw new Error('Expected active ride status with OTP!');
  }

  // Scenario 3: User cancels ride: "cancel cab"
  console.log('Step 3: User asks "cancel cab"');
  const cancelReply = await simulateUserMessage('cancel cab');
  console.log('\n--- Bot Reply ---');
  console.log(cancelReply);
  console.log('-----------------\n');

  if (!cancelReply.includes('Ride Cancelled')) {
    throw new Error('Expected cancellation confirmation!');
  }

  // Scenario 4: User asks for auto specifically: "get me an auto to MG Road"
  console.log('Step 4: User asks "get me an auto to MG Road"');
  const autoReply = await simulateUserMessage('get me an auto to MG Road');
  console.log('\n--- Bot Reply ---');
  console.log(autoReply);
  console.log('-----------------\n');

  if (!autoReply.includes('Auto') || !autoReply.includes('YOUR RIDE START OTP')) {
    throw new Error('Expected auto booking confirmation with OTP!');
  }

  // Scenario 5: User answers pending clarification
  console.log('Step 5: Testing pending clarification multi-turn confirmation');
  const { storePendingRideClarification } = await import('./bookingEngine.js');
  storePendingRideClarification(jid, {
    options: [
      {
        index: 1,
        ride: {
          provider: 'Uber',
          name: 'Uber Go',
          category: 'economy',
          icon: '🚗',
          fare: { low: 760, high: 840 },
          etaMinutes: 2,
        },
      },
    ],
    pickup: { label: 'Indiranagar', countryCode: 'IN', lat: 12.97, lon: 77.64 },
    dropoff: { label: 'Kempegowda Airport', countryCode: 'IN', lat: 13.19, lon: 77.70 },
  });

  const replyClarification = await simulateUserMessage('1');
  console.log('\n--- Bot Reply to Option "1" ---');
  console.log(replyClarification);
  console.log('-------------------------------\n');

  if (!replyClarification.includes('YOUR RIDE START OTP') || !replyClarification.includes('Uber Go')) {
    throw new Error('Expected OTP on clarification choice!');
  }

  console.log('✅ Autonomous Cab Booking with OTP & Clarification Verification PASSED!');
}

testAutonomousBookingFlow().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
