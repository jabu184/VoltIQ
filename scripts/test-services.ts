import {
  calculateBatteryCapacity,
  evaluateBatteryHealth,
  TESLA_PROFILES,
} from '../src/services/batteryLogic';
import { buildCertificateHtml } from '../src/services/certificateTemplate';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  buildTeslaAuthUrl,
  extractCodeFromCallbackUrl,
} from '../src/services/pkce';

function runTests() {
  console.log('=== Running VoltWise / TrueBattery Logic Verification ===\n');

  // Test 1: Capacity & Degradation Calculation
  const m3LrProfile = TESLA_PROFILES.find((p) => p.id === 'm3_lr')!;
  console.log('Testing Profile:', m3LrProfile.name);

  // Scenario: 80% SoC, 240 miles rated range (240 Wh/mi)
  // Expected: (240 * 240 / 1000) / 0.8 = 57.6 / 0.8 = 72.0 kWh
  // Degradation: (75 - 72) / 75 * 100 = 4.0%
  const result1 = calculateBatteryCapacity(240, 80, m3LrProfile);
  console.log('Test 1 (80% SoC, 240 mi range):', result1);
  if (result1.calculatedCapacityKwh === 72 && result1.degradationPct === 4) {
    console.log('✓ Test 1 Passed: Capacity & Degradation exact match');
  } else {
    console.error('✗ Test 1 Failed: Expected 72 kWh and 4% degradation');
    process.exit(1);
  }

  // Test 2: Health Grade & AC/DC Ratio Evaluation
  const mockSnapshots = [
    { is_fast_charging: 1, degradation_pct: 4.0, calculated_capacity_kwh: 72.0 },
    { is_fast_charging: 0, degradation_pct: 4.1, calculated_capacity_kwh: 71.9 },
    { is_fast_charging: 0, degradation_pct: 4.2, calculated_capacity_kwh: 71.8 },
    { is_fast_charging: 0, degradation_pct: 4.2, calculated_capacity_kwh: 71.8 },
  ];
  const evaluated = evaluateBatteryHealth(mockSnapshots, m3LrProfile);
  console.log('\nTest 2 Evaluated Health:', evaluated);
  if (
    evaluated.healthGrade === 'A+' &&
    evaluated.batteryHealthPct === 95.8 &&
    evaluated.acRatioPct === 75 &&
    evaluated.dcRatioPct === 25
  ) {
    console.log('✓ Test 2 Passed: Health Grade (A+), 95.8% health, 75% AC / 25% DC');
  } else {
    console.error('✗ Test 2 Failed:', evaluated);
    process.exit(1);
  }

  // Test 3: PDF Resale Certificate HTML Generation
  const certHtml = buildCertificateHtml({
    vehicle: {
      timestamp: Date.now(),
      odometerMiles: 24819,
      batteryLevelPct: 82,
      usableBatteryLevelPct: 81,
      ratedRangeMiles: 246,
      isFastCharging: false,
      chargerPowerKw: 0,
      chargerVoltage: 0,
      chargerActualCurrent: 0,
      batteryHeaterOn: false,
      insideTempC: 20,
      outsideTempC: 15,
      vehicleName: 'Tesla Model 3 LR',
      vin: '5YJ3E1EB8LF892301',
    },
    metrics: evaluated,
    profile: m3LrProfile,
    certificateId: 'TB-TEST-CERT-01',
    issueDate: 'August 29, 2026',
  });

  console.log('\nTest 3 Certificate HTML check (length:', certHtml.length, 'bytes)');
  if (
    certHtml.includes('TrueBattery™') &&
    certHtml.includes('5YJ3E1EB8LF892301') &&
    certHtml.includes('TB-TEST-CERT-01') &&
    certHtml.includes('AutoTrader')
  ) {
    console.log('✓ Test 3 Passed: Certificate HTML successfully compiled');
  } else {
    console.error('✗ Test 3 Failed: Certificate HTML missing critical fields');
    process.exit(1);
  }

  // Test 4: PKCE & Tesla OAuth Generator
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const authUrl = buildTeslaAuthUrl(challenge, 'test_state');
  console.log('\nTest 4 PKCE verifier length:', verifier.length, 'challenge length:', challenge.length);
  if (
    verifier.length >= 43 &&
    challenge.length > 20 &&
    authUrl.includes('auth.tesla.com/oauth2/v3/authorize') &&
    authUrl.includes('code_challenge_method=S256')
  ) {
    console.log('✓ Test 4 Passed: PKCE verifier, challenge and auth URL correctly generated');
  } else {
    console.error('✗ Test 4 Failed: Invalid PKCE parameters');
    process.exit(1);
  }

  // Test 5: Callback Code Extractor
  const testCallbackUrl = 'https://auth.tesla.com/void/callback?code=NA_test_auth_code_12345&state=test_state';
  const extractedCode = extractCodeFromCallbackUrl(testCallbackUrl);
  if (extractedCode === 'NA_test_auth_code_12345') {
    console.log('✓ Test 5 Passed: Successfully extracted auth code from callback URL');
  } else {
    console.error('✗ Test 5 Failed: Failed to extract code, got:', extractedCode);
    process.exit(1);
  }

  console.log('\n=============================================');
  console.log('ALL UNIT, PKCE & LOGIC TESTS PASSED! 🎉');
  console.log('=============================================\n');
}

runTests();
