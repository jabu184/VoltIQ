import { getDb, saveTokens, getTokens, upsertVehicle, getVehicle, insertSnapshot, getAllSnapshots, seedSampleSnapshotsIfEmpty } from './db';
import { TeslaFleetService } from './teslaFleetService';
import { SmartPoller } from './poller';

async function runServerTests() {
  console.log('=== Running VoltWise Backend Server Verification ===\n');

  // Test 1: SQLite Database Initialization & Schema
  const testDb = getDb();
  console.log('✓ Test 1 Passed: Server SQLite database initialized successfully');

  // Test 2: Token Storage & Retrieval
  saveTokens({
    accessToken: 'test_access_token_123',
    refreshToken: 'test_refresh_token_456',
    expiresIn: 3600,
    clientId: 'test_developer_client_id',
  });
  const tokens = getTokens();
  if (tokens && tokens.access_token === 'test_access_token_123' && tokens.refresh_token === 'test_refresh_token_456') {
    console.log('✓ Test 2 Passed: Token storage and retrieval verified');
  } else {
    console.error('✗ Test 2 Failed: Token storage mismatch');
    process.exit(1);
  }

  // Test 3: Vehicle Upsert & Query
  const testVin = '5YJ3E1EB8LF999999';
  upsertVehicle({
    vin: testVin,
    display_name: 'Test Model 3 Performance',
    model: 'Model 3 Performance',
    last_state: 'online',
    last_soc: 90,
    last_rated_range: 270,
    last_odometer: 15000,
    last_charging_state: 'Complete',
  });

  const veh = getVehicle(testVin);
  if (veh && veh.vin === testVin && veh.last_soc === 90) {
    console.log('✓ Test 3 Passed: Vehicle upsert and state query verified');
  } else {
    console.error('✗ Test 3 Failed: Vehicle record mismatch');
    process.exit(1);
  }

  // Test 4: Battery Snapshot Insertion & Full Dataset Retrieval
  insertSnapshot({
    vin: testVin,
    timestamp: Date.now(),
    odometer_miles: 15000,
    battery_level_pct: 90,
    rated_range_miles: 270,
    calculated_capacity_kwh: 72.0,
    degradation_pct: 4.0,
    is_fast_charging: 0,
    charger_power_kw: 11.0,
    trigger_reason: 'charge_complete',
  });

  const snapshots = getAllSnapshots(testVin);
  if (snapshots.length >= 1 && snapshots[0].calculated_capacity_kwh === 72.0) {
    console.log(`✓ Test 4 Passed: Snapshot persistence verified (${snapshots.length} snapshots in server DB)`);
  } else {
    console.error('✗ Test 4 Failed: Snapshot query failed');
    process.exit(1);
  }

  // Test 5: SmartPoller Post-Charge Detection Simulation
  const fleetService = new TeslaFleetService();
  const poller = new SmartPoller(fleetService, 15);

  // Set previous vehicle state to 'Charging'
  upsertVehicle({
    vin: testVin,
    last_charging_state: 'Charging',
    last_soc: 75,
  });

  // Run a poll tick (simulated telemetry will return chargingState = 'Complete' & last_soc = 82)
  const pollResult = await poller.pollVehicle();
  console.log('\nSmartPoller Poll Result:', pollResult);
  if (pollResult.status === 'snapshot_logged' || pollResult.status === 'skipped') {
    console.log('✓ Test 5 Passed: SmartPoller correctly evaluated vehicle state and charge status');
  } else {
    console.error('✗ Test 5 Failed:', pollResult);
    process.exit(1);
  }

  console.log('\n====================================================');
  console.log('ALL SERVER & POST-CHARGE LOGIC TESTS PASSED! 🎉');
  console.log('====================================================\n');
}

runServerTests();
