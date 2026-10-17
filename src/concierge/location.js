import { loadProjectsState } from '../config.js';

/**
 * Unwraps ephemeral/disappearing wrappers from a Baileys message.
 */
export function unwrapMessage(msg) {
  if (!msg) return null;
  let m = msg.message || msg;
  if (!m) return null;
  if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
  if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
  if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
  if (m.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;
  return m;
}

/**
 * Extracts a location pin from a message or its quoted message.
 */
export function extractLocationFromMessage(msg) {
  const m = unwrapMessage(msg);
  if (!m) return null;

  const directLoc = m.locationMessage || m.liveLocationMessage;
  if (directLoc && typeof directLoc.degreesLatitude === 'number') {
    return {
      lat: directLoc.degreesLatitude,
      lon: directLoc.degreesLongitude,
      label: directLoc.name || directLoc.address || directLoc.caption || 'Shared WhatsApp Pin',
    };
  }

  const quoted =
    m.extendedTextMessage?.contextInfo?.quotedMessage ||
    m.imageMessage?.contextInfo?.quotedMessage ||
    m.videoMessage?.contextInfo?.quotedMessage ||
    m.documentMessage?.contextInfo?.quotedMessage;

  if (!quoted) return null;
  const q =
    quoted.ephemeralMessage?.message ||
    quoted.viewOnceMessage?.message ||
    quoted.viewOnceMessageV2?.message ||
    quoted;

  const quotedLoc = q.locationMessage || q.liveLocationMessage;
  if (quotedLoc && typeof quotedLoc.degreesLatitude === 'number') {
    return {
      lat: quotedLoc.degreesLatitude,
      lon: quotedLoc.degreesLongitude,
      label: quotedLoc.name || quotedLoc.address || quotedLoc.caption || 'Quoted WhatsApp Pin',
    };
  }
  return null;
}

/**
 * Geocodes an address or place name to coordinates using OpenStreetMap Nominatim.
 */
export async function geocodeAddress(query, { timeoutMs = 8000 } = {}) {
  const clean = (query || '').trim();
  if (!clean) return null;

  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(clean)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Weave-Concierge/1.0 (WhatsApp Antigravity Agent)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`Geocoding failed with status ${res.status}`);
  }

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  const first = data[0];
  const addr = first.address || {};
  const countryCode = (addr.country_code || '').toUpperCase();
  const city = addr.city || addr.town || addr.village || addr.county || addr.state || '';
  const shortLabel = first.display_name.split(',').slice(0, 3).join(',').trim();

  return {
    lat: parseFloat(first.lat),
    lon: parseFloat(first.lon),
    label: shortLabel || clean,
    displayName: first.display_name,
    countryCode,
    city,
  };
}

/**
 * Reverse geocodes coordinates into an address and country code.
 */
export async function reverseGeocode(lat, lon, { timeoutMs = 8000 } = {}) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Weave-Concierge/1.0 (WhatsApp Antigravity Agent)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data.address || {};
    return {
      displayName: data.display_name,
      label: data.display_name?.split(',').slice(0, 3).join(',').trim(),
      countryCode: (addr.country_code || '').toUpperCase(),
      city: addr.city || addr.town || addr.village || addr.county || addr.state || '',
      country: addr.country || '',
    };
  } catch {
    return null;
  }
}

/**
 * Resolves location coordinates with complete multi-tier fallback:
 * 1) Attached / Quoted WhatsApp Pin
 * 2) Explicit lat, lon regex
 * 3) Geocoded place query
 * 4) User's Saved Location in projects.json
 * 5) Automatic IP Geolocation (ipwho.is)
 */
export async function resolveLocation(customQuery = '', msg = null) {
  const q = (customQuery || '').trim();
  const isHereOrCurrent = !q || ['AUTO', 'DEFAULT', 'CURRENT', 'HERE', 'MY LOCATION', 'NONE'].includes(q.toUpperCase());

  // 1. If asking for current location, first check WhatsApp pin in message
  if (msg && isHereOrCurrent) {
    const pin = extractLocationFromMessage(msg);
    if (pin) {
      const rev = await reverseGeocode(pin.lat, pin.lon);
      return {
        lat: pin.lat,
        lon: pin.lon,
        label: pin.label || rev?.label || `${pin.lat.toFixed(4)}, ${pin.lon.toFixed(4)}`,
        countryCode: rev?.countryCode || 'IN',
        city: rev?.city || '',
      };
    }
  }

  // 2. Explicit coordinates format: "12.9716, 77.5946" or "12.9716,77.5946"
  const coordMatch = q.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lon = parseFloat(coordMatch[2]);
    const rev = await reverseGeocode(lat, lon);
    return {
      lat,
      lon,
      label: rev?.label || `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      countryCode: rev?.countryCode || 'IN',
      city: rev?.city || '',
    };
  }

  // 3. Explicit place name geocoding (e.g. "Indiranagar", "Times Square", "Heathrow Airport")
  if (!isHereOrCurrent) {
    try {
      const geo = await geocodeAddress(q);
      if (geo) return geo;
    } catch (err) {
      console.warn(`[Location] Geocoding query "${q}" failed:`, err.message);
    }
  }

  // 4. Saved Location in projects.json
  const state = loadProjectsState();
  if (
    state.savedLocation &&
    typeof state.savedLocation.lat === 'number' &&
    typeof state.savedLocation.lon === 'number'
  ) {
    const rev = await reverseGeocode(state.savedLocation.lat, state.savedLocation.lon);
    return {
      lat: state.savedLocation.lat,
      lon: state.savedLocation.lon,
      label: state.savedLocation.label || rev?.label || 'Saved Location',
      countryCode: rev?.countryCode || 'IN',
      city: rev?.city || '',
    };
  }

  // 5. IP Geolocation Fallback
  try {
    const res = await fetch('https://ipwho.is/', {
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (data && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
      const city = data.city || data.region || '';
      const countryCode = (data.country_code || '').toUpperCase() || 'IN';
      const label = [data.city, data.region, data.country].filter(Boolean).join(', ');
      return {
        lat: data.latitude,
        lon: data.longitude,
        label: label || 'Current Location',
        countryCode,
        city,
      };
    }
  } catch (err) {
    console.warn('[Location] IP Geolocation failed:', err.message);
  }

  throw new Error(
    `Could not determine location for "${q || 'current location'}". Please provide a specific address or share a WhatsApp location pin.`
  );
}

/**
 * Calculates straight-line aerial distance using Haversine formula in km.
 */
export function getHaversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Computes road travel distance (km) and estimated duration (minutes).
 * Uses public OSRM driving route API with fast fallback to calibrated Haversine.
 */
export async function getDistanceAndDuration(lat1, lon1, lat2, lon2) {
  // Aerial distance baseline
  const aerialKm = getHaversineDistanceKm(lat1, lon1, lat2, lon2);

  // Try real road routing via OSRM
  try {
    const url = `http://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const distanceKm = parseFloat((route.distance / 1000).toFixed(1));
        const durationMinutes = Math.max(2, Math.round(route.duration / 60));
        return { distanceKm, durationMinutes };
      }
    }
  } catch {
    // Fall back to Haversine calibration
  }

  // Calibrated urban road routing model:
  // - Road network factor: ~1.28x aerial distance
  // - City traffic speed: ~26-30 km/h average
  const distanceKm = parseFloat((aerialKm * 1.28).toFixed(1));
  const avgSpeedKmh = distanceKm > 25 ? 42 : 26; // higher speed for highway/airport trips
  const durationMinutes = Math.max(3, Math.round((distanceKm / avgSpeedKmh) * 60));

  return { distanceKm, durationMinutes };
}
