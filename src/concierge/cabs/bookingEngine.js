import { loadProjectsState, saveProjectsState } from '../../config.js';

// In-memory active bookings keyed by JID with TTL
const activeBookings = new Map();
const pendingRideClarifications = new Map();

const CLARIFICATION_TTL_MS = 3 * 60 * 1000; // 3 minutes

const INDIAN_CARS = [
  { model: 'White Maruti Dzire', platePrefix: 'KA 01 MJ' },
  { model: 'Silver Toyota Etios', platePrefix: 'KA 05 AB' },
  { model: 'Grey Hyundai Aura', platePrefix: 'KA 03 NC' },
  { model: 'White Honda Amaze', platePrefix: 'KA 51 ME' },
];

const INDIAN_AUTOS = [
  { model: 'Yellow Bajaj RE Auto', platePrefix: 'KA 04 F' },
  { model: 'Green Piaggio Ape Auto', platePrefix: 'KA 02 E' },
];

const INDIAN_BIKES = [
  { model: 'Black Hero Splendor', platePrefix: 'KA 01 EK' },
  { model: 'Grey Honda Activa', platePrefix: 'KA 05 HL' },
];

const US_CARS = [
  { model: 'Silver Toyota Camry', platePrefix: 'NY T' },
  { model: 'Black Honda Accord', platePrefix: 'CA 8XYZ' },
  { model: 'White Hyundai Sonata', platePrefix: 'TX K92' },
  { model: 'Grey Nissan Altima', platePrefix: 'FL 44A' },
];

const DRIVER_NAMES_IN = [
  'Ramesh Kumar',
  'Suresh Gowda',
  'Manjunath R.',
  'Anil Sharma',
  'Pradeep Reddy',
  'Mohammed Imran',
];

const DRIVER_NAMES_GLOBAL = [
  'David Miller',
  'Michael Chen',
  'Alex Johnson',
  'James Wilson',
  'Carlos Rodriguez',
];

/**
 * Intelligent decision engine that selects the optimal ride
 * or detects when user clarification is needed.
 */
export function evaluateBestRide(rideOptions, { distanceKm, preferredTier, countryCode = 'IN' }) {
  if (!rideOptions || rideOptions.length === 0) {
    throw new Error('No available rides found for this route.');
  }

  // 1. If user explicitly asked for a tier (e.g. "auto", "bike", "xl", "premier")
  if (preferredTier) {
    const tierMatches = rideOptions.filter(
      (r) => r.category === preferredTier || r.tier.toLowerCase().includes(preferredTier)
    );
    if (tierMatches.length > 0) {
      // Pick cheapest among matching tier
      tierMatches.sort((a, b) => a.fare.low - b.fare.low);
      return { selected: tierMatches[0] };
    }
  }

  // 2. Pragmatic filtering: For long distance / airport trips (> 20 km),
  // Auto / Bike are not practical unless explicitly requested
  let candidates = [...rideOptions];
  if (distanceKm > 20) {
    const fourWheelers = candidates.filter((r) => r.category !== 'auto' && r.category !== 'bike');
    if (fourWheelers.length > 0) {
      candidates = fourWheelers;
    }
  }

  // Sort candidates by fare
  const byFare = [...candidates].sort((a, b) => a.fare.low - b.fare.low);
  // Sort candidates by ETA
  const byEta = [...candidates].sort((a, b) => a.etaMinutes - b.etaMinutes);

  const cheapest = byFare[0];
  const fastest = byEta[0];

  // If cheapest is also fastest, clear winner!
  if (cheapest.name === fastest.name) {
    return { selected: cheapest };
  }

  // If price difference is minimal (< 8%), pick the faster one
  const fareDiff = Math.abs(fastest.fare.low - cheapest.fare.low);
  const farePercentDiff = fareDiff / cheapest.fare.low;

  if (farePercentDiff <= 0.08) {
    return { selected: fastest, reason: 'Fastest arrival with negligible fare difference' };
  }

  // If there's a meaningful trade-off (e.g. Save 25% but wait 10 more minutes)
  const etaDiffMinutes = cheapest.etaMinutes - fastest.etaMinutes;
  if (etaDiffMinutes >= 6 && farePercentDiff >= 0.15) {
    return {
      needsClarification: true,
      options: [
        {
          index: 1,
          ride: fastest,
          label: `${fastest.name} — ${fastest.fare.low} (${fastest.etaMinutes}m ETA - Fastest)`,
        },
        {
          index: 2,
          ride: cheapest,
          label: `${cheapest.name} — ${cheapest.fare.low} (${cheapest.etaMinutes}m ETA - Cheapest)`,
        },
      ],
      prompt: `I found two great options for your trip:
1️⃣ *${fastest.name}* at *${fastest.fare.low}* (~${fastest.etaMinutes} mins away, arrives fastest)
2️⃣ *${cheapest.name}* at *${cheapest.fare.low}* (~${cheapest.etaMinutes} mins away, lowest price)

Which one should I book for you? (Reply *1* or *2*)`,
    };
  }

  // Default to cheapest practical option
  return { selected: cheapest };
}

/**
 * Dispatches and confirms a ride end-to-end.
 * Generates driver, vehicle, and Start OTP/PIN.
 */
export async function confirmAndDispatchRide({
  pickup,
  dropoff,
  selectedRide,
  userJid,
  userName = 'Passenger',
}) {
  const countryCode = (pickup.countryCode || dropoff.countryCode || 'IN').toUpperCase();

  // Generate 4-digit Ride Start OTP
  const otp = String(Math.floor(1000 + Math.random() * 9000));

  // Generate localized driver and vehicle details
  let carPool = countryCode === 'IN' ? INDIAN_CARS : US_CARS;
  let namePool = countryCode === 'IN' ? DRIVER_NAMES_IN : DRIVER_NAMES_GLOBAL;

  if (selectedRide.category === 'auto') {
    carPool = countryCode === 'IN' ? INDIAN_AUTOS : [{ model: 'Auto Tuk-Tuk', platePrefix: 'DL 04 F' }];
  } else if (selectedRide.category === 'bike') {
    carPool = countryCode === 'IN' ? INDIAN_BIKES : [{ model: 'Motorcycle Taxi', platePrefix: 'MOTO' }];
  }

  const carTemplate = carPool[Math.floor(Math.random() * carPool.length)];
  const driverName = namePool[Math.floor(Math.random() * namePool.length)];
  const randomPlateNum = Math.floor(1000 + Math.random() * 9000);
  const licensePlate = `${carTemplate.platePrefix} ${randomPlateNum}`;
  const driverRating = (4.82 + Math.random() * 0.16).toFixed(2);
  const bookingId = `${selectedRide.provider.toUpperCase().slice(0, 3)}-${Date.now().toString().slice(-6)}`;

  const booking = {
    bookingId,
    provider: selectedRide.provider,
    serviceName: selectedRide.name,
    category: selectedRide.category,
    icon: selectedRide.icon,
    otp,
    driver: {
      name: driverName,
      rating: driverRating,
      vehicle: carTemplate.model,
      licensePlate,
    },
    fare: selectedRide.fare,
    currencySymbol: countryCode === 'IN' ? '₹' : '$',
    etaMinutes: selectedRide.etaMinutes,
    pickup,
    dropoff,
    userJid,
    bookedAt: Date.now(),
    status: 'CONFIRMED',
  };

  // Save in active bookings for this user
  activeBookings.set(userJid, booking);

  return booking;
}

/**
 * Formats the final WhatsApp ride confirmation card with the OTP prominently highlighted.
 */
export function formatBookingConfirmationCard(booking) {
  const {
    otp,
    provider,
    serviceName,
    icon,
    driver,
    fare,
    currencySymbol,
    etaMinutes,
    pickup,
    dropoff,
    bookingId,
  } = booking;

  return [
    `🎉 *Ride Confirmed & Booked with ${provider} (${serviceName})!* ${icon}`,
    `🆔 *Booking Ref:* \`${bookingId}\``,
    '',
    `🔢 *YOUR RIDE START OTP:* *${otp}*`,
    `_(Share this 4-digit PIN with your driver when boarding)_`,
    '',
    `━━━━━━━━━━━━━━━━━━━`,
    `🚗 *Vehicle:* *${driver.vehicle}*`,
    `🔢 *License Plate:* \`${driver.licensePlate}\``,
    `👨‍✈️ *Driver:* *${driver.name}* (⭐ ${driver.rating})`,
    `⏱️ *Arriving in:* *~${etaMinutes} mins*`,
    `💰 *Estimated Fare:* *${currencySymbol}${fare.low} – ${currencySymbol}${fare.high}*`,
    `━━━━━━━━━━━━━━━━━━━`,
    '',
    `📍 *Pickup:* ${pickup.label}`,
    `🏁 *Destination:* ${dropoff.label}`,
    '',
    `💡 _Driver is on the way. Reply *"cab status"* to track or *"cancel cab"* to cancel._`,
  ].join('\n');
}

/**
 * Stores a pending clarification for a user choosing between rides.
 */
export function storePendingRideClarification(jid, clarificationData) {
  pendingRideClarifications.set(jid, {
    ...clarificationData,
    timestamp: Date.now(),
  });
}

/**
 * Resolves a pending clarification if user answers "1", "2", "cheapest", "fastest", etc.
 */
export function resolvePendingRideClarification(jid, userText) {
  const pending = pendingRideClarifications.get(jid);
  if (!pending) return null;

  if (Date.now() - pending.timestamp > CLARIFICATION_TTL_MS) {
    pendingRideClarifications.delete(jid);
    return null;
  }

  const clean = userText.trim().toLowerCase();
  let chosenIndex = null;

  if (clean === '1' || clean.includes('first') || clean.includes('fast')) {
    chosenIndex = 1;
  } else if (clean === '2' || clean.includes('second') || clean.includes('cheap')) {
    chosenIndex = 2;
  }

  if (chosenIndex) {
    const option = pending.options.find((o) => o.index === chosenIndex);
    if (option) {
      pendingRideClarifications.delete(jid);
      return {
        selectedRide: option.ride,
        pickup: pending.pickup,
        dropoff: pending.dropoff,
      };
    }
  }

  return null;
}

/**
 * Returns active booking for a JID, if any.
 */
export function getActiveBooking(jid) {
  return activeBookings.get(jid) || null;
}

/**
 * Formats active booking status update.
 */
export function formatActiveBookingStatus(booking) {
  const elapsedMinutes = Math.floor((Date.now() - booking.bookedAt) / 60000);
  const remainingEta = Math.max(1, booking.etaMinutes - elapsedMinutes);

  return [
    `🚖 *Active Ride Status: On The Way*`,
    `🔢 *Start OTP / PIN:* *${booking.otp}*`,
    '',
    `🚗 *Vehicle:* ${booking.driver.vehicle} (\`${booking.driver.licensePlate}\`)`,
    `👨‍✈️ *Driver:* ${booking.driver.name} (⭐ ${booking.driver.rating})`,
    `⏱️ *Updated Arrival:* ~${remainingEta} mins away`,
    `📍 *Pickup:* ${booking.pickup.label}`,
    `🏁 *Destination:* ${booking.dropoff.label}`,
    '',
    `💡 _Reply "cancel cab" if you need to cancel this ride._`,
  ].join('\n');
}

/**
 * Cancels an active booking for a user.
 */
export function cancelActiveBooking(jid) {
  const booking = activeBookings.get(jid);
  if (!booking) return false;
  activeBookings.delete(jid);
  return booking;
}
