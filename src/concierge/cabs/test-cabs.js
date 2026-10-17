import { getRideEstimates, formatRideComparisonMessage } from './cabService.js';
import { resolveLocation, getDistanceAndDuration } from '../location.js';

async function runTests() {
  console.log('🧪 Starting Cab Service Unit Tests...\n');

  // Test 1: Coordinate resolution & geocoding
  console.log('Test 1: Geocoding location...');
  const loc = await resolveLocation('Indiranagar, Bangalore');
  console.log('  Resolved:', loc.label, `(${loc.lat}, ${loc.lon})`, 'Country:', loc.countryCode);
  if (!loc.lat || !loc.lon) throw new Error('Failed to resolve coordinates');

  // Test 2: Distance & Duration
  console.log('\nTest 2: Distance calculation between Indiranagar and Kempegowda Airport...');
  const airport = await resolveLocation('Kempegowda International Airport');
  const route = await getDistanceAndDuration(loc.lat, loc.lon, airport.lat, airport.lon);
  console.log(`  Distance: ${route.distanceKm} km, Duration: ${route.durationMinutes} mins`);
  if (route.distanceKm < 20 || route.distanceKm > 60) {
    throw new Error(`Unexpected distance: ${route.distanceKm} km`);
  }

  // Test 3: India Ride Estimates & 1-Tap Links
  console.log('\nTest 3: Generating India ride estimates (Uber & Ola)...');
  const estimatesIn = await getRideEstimates({
    pickupQuery: 'Indiranagar, Bangalore',
    destinationQuery: 'Kempegowda International Airport',
  });
  console.log('  Options found:', estimatesIn.rideOptions.length);
  const msgFormatted = formatRideComparisonMessage(estimatesIn);
  console.log('\n--- WhatsApp Card Output ---');
  console.log(msgFormatted);
  console.log('----------------------------\n');

  // Check that Uber and Ola links are present
  if (!msgFormatted.includes('https://m.uber.com/ul/?action=setPickup')) {
    throw new Error('Missing Uber universal deep-link in card');
  }
  if (!msgFormatted.includes('https://book.olacabs.com/')) {
    throw new Error('Missing Ola booking link in card');
  }

  // Test 4: US/International Ride Estimates (New York to JFK)
  console.log('Test 4: Generating US ride estimates (New York to JFK)...');
  const estimatesUs = await getRideEstimates({
    pickupQuery: 'Times Square, New York',
    destinationQuery: 'JFK Airport, New York',
  });
  console.log('  Currency:', estimatesUs.currencySymbol);
  console.log('  Options:', estimatesUs.rideOptions.map((o) => `${o.name}: ${estimatesUs.currencySymbol}${o.fare.low}`).join(', '));
  if (estimatesUs.currencySymbol !== '$') {
    throw new Error(`Expected $ currency, got ${estimatesUs.currencySymbol}`);
  }

  console.log('\n✅ All Cab Service tests passed successfully!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
