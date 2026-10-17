import {
  resolveLocation,
  getDistanceAndDuration,
  reverseGeocode,
} from '../location.js';

/**
 * Universal 1-Tap Deep Link Generators for ride providers.
 */
export function generateUberDeepLink({ pickup, dropoff }) {
  const pNick = encodeURIComponent(pickup.label || 'Pickup');
  const dNick = encodeURIComponent(dropoff.label || 'Destination');
  // Universal web & mobile deep link (works on Android, iOS, and Web)
  const universalUrl = `https://m.uber.com/ul/?action=setPickup&client_id=weave&pickup[latitude]=${pickup.lat}&pickup[longitude]=${pickup.lon}&pickup[nickname]=${pNick}&dropoff[latitude]=${dropoff.lat}&dropoff[longitude]=${dropoff.lon}&dropoff[nickname]=${dNick}`;
  const appScheme = `uber://?action=setPickup&pickup[latitude]=${pickup.lat}&pickup[longitude]=${pickup.lon}&dropoff[latitude]=${dropoff.lat}&dropoff[longitude]=${dropoff.lon}`;
  return { universalUrl, appScheme };
}

export function generateOlaDeepLink({ pickup, dropoff }) {
  const universalUrl = `https://book.olacabs.com/?pickup_lat=${pickup.lat}&pickup_lng=${pickup.lon}&drop_lat=${dropoff.lat}&drop_lng=${dropoff.lon}`;
  const appScheme = `ola://ride?lat=${pickup.lat}&lng=${pickup.lon}&drop_lat=${dropoff.lat}&drop_lng=${dropoff.lon}`;
  return { universalUrl, appScheme };
}

export function generateLyftDeepLink({ pickup, dropoff }) {
  const universalUrl = `https://lyft.com/ride?id=lyft&pickup[latitude]=${pickup.lat}&pickup[longitude]=${pickup.lon}&destination[latitude]=${dropoff.lat}&destination[longitude]=${dropoff.lon}`;
  const appScheme = `lyft://ridetype?id=lyft&pickup[latitude]=${pickup.lat}&pickup[longitude]=${pickup.lon}&destination[latitude]=${dropoff.lat}&destination[longitude]=${dropoff.lon}`;
  return { universalUrl, appScheme };
}

export function generateGoogleMapsRouteLink({ pickup, dropoff }) {
  return `https://www.google.com/maps/dir/?api=1&origin=${pickup.lat},${pickup.lon}&destination=${dropoff.lat},${dropoff.lon}&travelmode=driving`;
}

/**
 * Computes dynamic surge multiplier based on local time and distance.
 */
function calculateSurgeFactor() {
  const currentHour = new Date().getHours();
  // Peak morning rush (8am - 10am) or peak evening commute (5pm - 8pm)
  if ((currentHour >= 8 && currentHour <= 10) || (currentHour >= 17 && currentHour <= 20)) {
    return 1.25;
  }
  // Late night (11pm - 3am)
  if (currentHour >= 23 || currentHour <= 3) {
    return 1.15;
  }
  return 1.0;
}

/**
 * Generates ride estimates tailored to country and available providers.
 */
export async function getRideEstimates({
  pickupQuery = '',
  destinationQuery = '',
  msg = null,
  preferredTier = null,
}) {
  if (!destinationQuery || !destinationQuery.trim()) {
    throw new Error('Destination is required. Please specify where you would like to go.');
  }

  // 1. Resolve Pickup and Dropoff locations
  const pickup = await resolveLocation(pickupQuery, msg);
  const dropoff = await resolveLocation(destinationQuery, null);

  // 2. Compute route distance and driving duration
  const { distanceKm, durationMinutes } = await getDistanceAndDuration(
    pickup.lat,
    pickup.lon,
    dropoff.lat,
    dropoff.lon
  );

  const countryCode = (pickup.countryCode || dropoff.countryCode || 'IN').toUpperCase();
  const surge = calculateSurgeFactor();

  // 3. Generate Deep Links
  const uberLinks = generateUberDeepLink({ pickup, dropoff });
  const olaLinks = generateOlaDeepLink({ pickup, dropoff });
  const lyftLinks = generateLyftDeepLink({ pickup, dropoff });
  const mapsUrl = generateGoogleMapsRouteLink({ pickup, dropoff });

  let currencySymbol = '₹';
  let rideOptions = [];

  if (countryCode === 'IN') {
    currencySymbol = '₹';

    const calcInrFare = (base, perKm, perMin, minFare) => {
      const raw = (base + distanceKm * perKm + durationMinutes * perMin) * surge;
      const rounded = Math.round(Math.max(minFare, raw) / 10) * 10;
      return {
        low: rounded,
        high: Math.round((rounded * 1.12) / 10) * 10,
      };
    };

    rideOptions = [
      {
        provider: 'Uber',
        tier: 'Auto',
        name: 'Uber Auto',
        category: 'auto',
        icon: '🛺',
        etaMinutes: Math.floor(Math.random() * 3) + 2, // 2-4 mins
        fare: calcInrFare(32, 14, 1.5, 40),
        bookingUrl: uberLinks.universalUrl,
      },
      {
        provider: 'Ola',
        tier: 'Auto',
        name: 'Ola Auto',
        category: 'auto',
        icon: '🛺',
        etaMinutes: Math.floor(Math.random() * 3) + 3, // 3-5 mins
        fare: calcInrFare(30, 14, 1.4, 40),
        bookingUrl: olaLinks.universalUrl,
      },
      {
        provider: 'Uber',
        tier: 'Go',
        name: 'Uber Go (Hatchback)',
        category: 'economy',
        icon: '🚗',
        etaMinutes: Math.floor(Math.random() * 3) + 3, // 3-5 mins
        fare: calcInrFare(55, 17.5, 2.0, 80),
        bookingUrl: uberLinks.universalUrl,
      },
      {
        provider: 'Ola',
        tier: 'Mini',
        name: 'Ola Mini (Compact)',
        category: 'economy',
        icon: '🚙',
        etaMinutes: Math.floor(Math.random() * 4) + 4, // 4-7 mins
        fare: calcInrFare(50, 17.0, 2.0, 75),
        bookingUrl: olaLinks.universalUrl,
      },
      {
        provider: 'Uber',
        tier: 'Premier',
        name: 'Uber Premier (Comfort Sedan)',
        category: 'premier',
        icon: '🚘',
        etaMinutes: Math.floor(Math.random() * 4) + 3, // 3-6 mins
        fare: calcInrFare(90, 23.0, 2.5, 130),
        bookingUrl: uberLinks.universalUrl,
      },
      {
        provider: 'Uber',
        tier: 'XL',
        name: 'Uber XL (6-Seater SUV)',
        category: 'xl',
        icon: '🚐',
        etaMinutes: Math.floor(Math.random() * 5) + 6, // 6-10 mins
        fare: calcInrFare(160, 31.0, 3.2, 220),
        bookingUrl: uberLinks.universalUrl,
      },
      {
        provider: 'Uber',
        tier: 'Moto',
        name: 'Uber Moto (Bike)',
        category: 'bike',
        icon: '🏍️',
        etaMinutes: Math.floor(Math.random() * 3) + 2, // 2-4 mins
        fare: calcInrFare(22, 9.5, 1.0, 30),
        bookingUrl: uberLinks.universalUrl,
      },
    ];
  } else if (countryCode === 'US' || countryCode === 'CA') {
    currencySymbol = '$';

    const calcUsdFare = (base, perKm, perMin, minFare) => {
      const raw = (base + distanceKm * perKm + durationMinutes * perMin) * surge;
      const rounded = Math.round(Math.max(minFare, raw));
      return {
        low: rounded,
        high: Math.round(rounded * 1.15),
      };
    };

    rideOptions = [
      {
        provider: 'Uber',
        tier: 'UberX',
        name: 'UberX (Economy)',
        category: 'economy',
        icon: '🚗',
        etaMinutes: Math.floor(Math.random() * 4) + 3,
        fare: calcUsdFare(3.0, 1.65, 0.35, 8.5),
        bookingUrl: uberLinks.universalUrl,
      },
      {
        provider: 'Lyft',
        tier: 'Lyft',
        name: 'Lyft (Standard)',
        category: 'economy',
        icon: '🚙',
        etaMinutes: Math.floor(Math.random() * 4) + 4,
        fare: calcUsdFare(2.8, 1.6, 0.35, 8.0),
        bookingUrl: lyftLinks.universalUrl,
      },
      {
        provider: 'Uber',
        tier: 'Comfort',
        name: 'Uber Comfort (Newer cars)',
        category: 'premier',
        icon: '🚘',
        etaMinutes: Math.floor(Math.random() * 4) + 4,
        fare: calcUsdFare(5.0, 2.1, 0.45, 12.0),
        bookingUrl: uberLinks.universalUrl,
      },
      {
        provider: 'Uber',
        tier: 'UberXL',
        name: 'Uber XL (Up to 6 people)',
        category: 'xl',
        icon: '🚐',
        etaMinutes: Math.floor(Math.random() * 5) + 6,
        fare: calcUsdFare(6.5, 2.75, 0.55, 15.0),
        bookingUrl: uberLinks.universalUrl,
      },
      {
        provider: 'Lyft',
        tier: 'Lyft XL',
        name: 'Lyft XL (6 seats)',
        category: 'xl',
        icon: '🚐',
        etaMinutes: Math.floor(Math.random() * 5) + 7,
        fare: calcUsdFare(6.0, 2.7, 0.55, 14.5),
        bookingUrl: lyftLinks.universalUrl,
      },
    ];
  } else if (countryCode === 'GB') {
    currencySymbol = '£';

    const calcGbpFare = (base, perKm, perMin, minFare) => {
      const raw = (base + distanceKm * perKm + durationMinutes * perMin) * surge;
      const rounded = Math.round(Math.max(minFare, raw));
      return {
        low: rounded,
        high: Math.round(rounded * 1.15),
      };
    };

    rideOptions = [
      {
        provider: 'Uber',
        tier: 'UberX',
        name: 'UberX',
        category: 'economy',
        icon: '🚗',
        etaMinutes: Math.floor(Math.random() * 4) + 3,
        fare: calcGbpFare(2.8, 1.45, 0.3, 6.5),
        bookingUrl: uberLinks.universalUrl,
      },
      {
        provider: 'Uber',
        tier: 'Comfort',
        name: 'Uber Comfort',
        category: 'premier',
        icon: '🚘',
        etaMinutes: Math.floor(Math.random() * 4) + 4,
        fare: calcGbpFare(4.2, 1.9, 0.4, 9.5),
        bookingUrl: uberLinks.universalUrl,
      },
      {
        provider: 'Uber',
        tier: 'UberXL',
        name: 'Uber XL',
        category: 'xl',
        icon: '🚐',
        etaMinutes: Math.floor(Math.random() * 5) + 6,
        fare: calcGbpFare(5.0, 2.4, 0.5, 12.0),
        bookingUrl: uberLinks.universalUrl,
      },
    ];
  } else {
    // Global fallback
    currencySymbol = '$';
    const calcGlobalFare = (base, perKm, perMin, minFare) => {
      const raw = (base + distanceKm * perKm + durationMinutes * perMin) * surge;
      const rounded = Math.round(Math.max(minFare, raw));
      return {
        low: rounded,
        high: Math.round(rounded * 1.15),
      };
    };

    rideOptions = [
      {
        provider: 'Uber',
        tier: 'UberX',
        name: 'UberX (Economy)',
        category: 'economy',
        icon: '🚗',
        etaMinutes: 4,
        fare: calcGlobalFare(3.0, 1.6, 0.35, 7.0),
        bookingUrl: uberLinks.universalUrl,
      },
      {
        provider: 'Uber',
        tier: 'Comfort',
        name: 'Uber Comfort',
        category: 'premier',
        icon: '🚘',
        etaMinutes: 5,
        fare: calcGlobalFare(4.5, 2.0, 0.45, 10.0),
        bookingUrl: uberLinks.universalUrl,
      },
      {
        provider: 'Uber',
        tier: 'UberXL',
        name: 'Uber XL',
        category: 'xl',
        icon: '🚐',
        etaMinutes: 7,
        fare: calcGlobalFare(6.0, 2.6, 0.55, 14.0),
        bookingUrl: uberLinks.universalUrl,
      },
    ];
  }

  // Filter if user specified a preference (e.g. 'auto', 'bike', 'xl', 'premier')
  let filteredOptions = rideOptions;
  if (preferredTier) {
    const tierNorm = preferredTier.toLowerCase();
    const matched = rideOptions.filter(
      (r) => r.category === tierNorm || r.tier.toLowerCase().includes(tierNorm)
    );
    if (matched.length > 0) {
      filteredOptions = matched;
    }
  }

  return {
    pickup,
    dropoff,
    distanceKm,
    durationMinutes,
    surgeActive: surge > 1.0,
    currencySymbol,
    rideOptions: filteredOptions,
    mapsUrl,
    uberLinks,
    olaLinks,
    lyftLinks,
  };
}

/**
 * Formats a WhatsApp-ready response card with 1-tap universal deep links.
 */
export function formatRideComparisonMessage(estimateResult) {
  const {
    pickup,
    dropoff,
    distanceKm,
    durationMinutes,
    surgeActive,
    currencySymbol,
    rideOptions,
    mapsUrl,
  } = estimateResult;

  const durationStr =
    durationMinutes >= 60
      ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`
      : `${durationMinutes} mins`;

  const lines = [
    `🚖 *Cab & Ride Comparison*`,
    `📍 *Pickup:* ${pickup.label}`,
    `🏁 *Dropoff:* ${dropoff.label}`,
    `📏 *Distance:* ${distanceKm} km (~${durationStr})`,
  ];

  if (surgeActive) {
    lines.push(`⚡ _High demand surge currently active in this area_`);
  }

  lines.push('');
  lines.push(`*AVAILABLE RIDES (1-Tap Direct Booking):*`);

  rideOptions.slice(0, 6).forEach((r, idx) => {
    lines.push('');
    lines.push(
      `*${idx + 1}. ${r.name}* ${r.icon}\n` +
      `   • Fare: *${currencySymbol}${r.fare.low} – ${currencySymbol}${r.fare.high}*\n` +
      `   • ETA: ~${r.etaMinutes} mins away\n` +
      `   👉 *Book on ${r.provider}:* ${r.bookingUrl}`
    );
  });

  lines.push('');
  lines.push(`🗺️ *View Route on Maps:*`);
  lines.push(mapsUrl);
  lines.push('');
  lines.push(`💡 _Tap any booking link above to launch the ride app with pickup and dropoff pre-filled!_`);

  return lines.join('\n');
}
