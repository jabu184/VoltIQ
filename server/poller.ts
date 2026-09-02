import { TeslaFleetService, TelemetryReading } from './teslaFleetService';
import { getVehicle, upsertVehicle, insertSnapshot, getAllSnapshots, ServerSnapshot, VehicleRecord } from './db';

/**
 * Intelligent rules for when to log a permanent battery health snapshot:
 * 1. Initial connection (first time seeing car)
 * 2. Post-charge completion (after charging finishes or unplugged)
 * 3. Significant SoC jump while resting (>= 5% increase)
 * 4. Daily Baseline Health Assessment (Once a day / >= 20 hours since last snapshot)
 * 5. Mileage Milestone (>= 30 miles driven since last snapshot and >= 4 hours)
 */
export function shouldLogSnapshot(
  telemetry: TelemetryReading,
  existingVehicle: VehicleRecord | null,
  latestSnapshot: ServerSnapshot | null
): { shouldLog: boolean; reason: string } {
  const prevChargingState = existingVehicle?.last_charging_state || 'Disconnected';
  const prevSoc = existingVehicle?.last_soc ?? telemetry.batteryLevelPct;
  const currChargingState = telemetry.chargingState;
  const currSoc = telemetry.batteryLevelPct;
  const now = Date.now();

  // Rule 0: First time seeing this vehicle (no snapshots exist)
  if (!latestSnapshot) {
    return { shouldLog: true, reason: 'initial_sync' };
  }

  // Rule 1: A charge session just completed or unplugged after charging
  const wasCharging = prevChargingState.toLowerCase() === 'charging';
  const isNowFinishedCharging =
    currChargingState.toLowerCase() === 'complete' ||
    currChargingState.toLowerCase() === 'disconnected' ||
    currChargingState.toLowerCase() === 'stopped';

  if (wasCharging && isNowFinishedCharging) {
    return { shouldLog: true, reason: 'charge_complete' };
  }

  // Rule 2: SoC increased significantly while resting (offline charge completed)
  if (currSoc >= prevSoc + 5 && currChargingState.toLowerCase() !== 'charging') {
    return { shouldLog: true, reason: 'soc_increase_charge_detected' };
  }

  // Rule 3: Daily Battery Health Assessment (Once a day / >= 20 hours elapsed since last snapshot)
  // Best BMS assessment occurs when car is resting or parked once a day
  const hoursSinceLastSnapshot = (now - latestSnapshot.timestamp) / (1000 * 60 * 60);
  if (hoursSinceLastSnapshot >= 20) {
    return { shouldLog: true, reason: 'daily_health_check' };
  }

  // Rule 4: Significant Mileage Milestone (>= 30 miles driven since last snapshot and >= 4 hours)
  const milesSinceLastSnapshot = Math.abs(telemetry.odometerMiles - (latestSnapshot.odometer_miles || 0));
  if (milesSinceLastSnapshot >= 30 && hoursSinceLastSnapshot >= 4) {
    return { shouldLog: true, reason: 'mileage_interval' };
  }

  return { shouldLog: false, reason: '' };
}

export class SmartPoller {
  private service: TeslaFleetService;
  private intervalMs: number;
  private timer: any = null;
  private isRunning: boolean = false;

  constructor(service: TeslaFleetService, intervalMinutes: number = 1) {
    this.service = service;
    this.intervalMs = intervalMinutes * 60 * 1000;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[SmartPoller] Started background polling every ${this.intervalMs / 60000} minutes.`);

    // Run initial poll after 5 seconds
    setTimeout(() => {
      this.pollVehicle();
    }, 5000);

    this.timer = setInterval(() => {
      this.pollVehicle();
    }, this.intervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log('[SmartPoller] Stopped.');
  }

  /**
   * Main smart polling logic:
   * 1. Never wakes up sleeping cars.
   * 2. Detects completion of charging sessions.
   * 3. Logs a daily baseline health snapshot once every 24h.
   * 4. Logs a snapshot upon charge completion or significant mileage.
   */
  public async pollVehicle(): Promise<{
    status: 'asleep' | 'skipped' | 'snapshot_logged' | 'error';
    message: string;
    reading?: TelemetryReading;
  }> {
    try {
      // 1. Sleep-Safe Status Check (zero wake up command)
      const status = await this.service.checkVehicleStatus();

      if (!status.isOnline || status.state === 'asleep') {
        console.log(`[SmartPoller] Vehicle ${status.vin} is ${status.state}. Sleep preserved (no API drain).`);
        upsertVehicle({
          vin: status.vin,
          display_name: status.displayName,
          last_state: status.state,
          last_polled_at: Date.now(),
        });
        return {
          status: 'asleep',
          message: `Vehicle is ${status.state}. Kept asleep to prevent 12V/HV battery drain.`,
        };
      }

      // 2. Vehicle is online: Retrieve lightweight vehicle data
      const telemetry = await this.service.fetchTelemetryIfOnline(
        status.vehicleId || '0',
        status.vin
      );

      if (!telemetry) {
        return {
          status: 'skipped',
          message: 'Unable to read telemetry while vehicle was online.',
        };
      }

      const existingVehicle = getVehicle(status.vin);
      const latestSnapshot = getAllSnapshots(status.vin, 1)[0] || null;
      const evalResult = shouldLogSnapshot(telemetry, existingVehicle, latestSnapshot);

      // Update vehicle tracking in DB
      upsertVehicle({
        vin: status.vin,
        display_name: status.displayName,
        last_state: 'online',
        last_soc: telemetry.batteryLevelPct,
        last_rated_range: telemetry.ratedRangeMiles,
        last_odometer: telemetry.odometerMiles,
        last_charging_state: telemetry.chargingState,
        inside_temp: telemetry.insideTempC,
        outside_temp: telemetry.outsideTempC,
        is_locked: telemetry.isLocked !== undefined ? (telemetry.isLocked ? 1 : 0) : 1,
        data_updated_at: telemetry.timestamp,
        last_polled_at: Date.now(),
      });

      if (evalResult.shouldLog) {
        insertSnapshot({
          vin: status.vin,
          timestamp: telemetry.timestamp,
          odometer_miles: telemetry.odometerMiles,
          battery_level_pct: telemetry.batteryLevelPct,
          rated_range_miles: telemetry.ratedRangeMiles,
          calculated_capacity_kwh: telemetry.calculatedCapacityKwh,
          degradation_pct: telemetry.degradationPct,
          is_fast_charging: telemetry.isFastCharging ? 1 : 0,
          charger_power_kw: telemetry.chargerPowerKw,
          trigger_reason: evalResult.reason,
        });

        console.log(
          `[SmartPoller] 📊 Logged battery health snapshot for ${status.vin} (Reason: ${evalResult.reason}, SoC: ${telemetry.batteryLevelPct}%, Range: ${telemetry.ratedRangeMiles}mi).`
        );

        return {
          status: 'snapshot_logged',
          message: `Snapshot logged successfully (${evalResult.reason}).`,
          reading: telemetry,
        };
      }

      console.log(
        `[SmartPoller] Vehicle online (SoC: ${telemetry.batteryLevelPct}%, State: ${telemetry.chargingState}). Next daily snapshot scheduled in due course.`
      );
      return {
        status: 'skipped',
        message: 'Telemetry updated. Snapshot skipped until daily check, charge event, or mileage milestone.',
        reading: telemetry,
      };
    } catch (err: any) {
      console.warn('[SmartPoller] Poll error:', err.message);
      return {
        status: 'error',
        message: err.message,
      };
    }
  }

  /**
   * Force an immediate sync and snapshot (e.g. user taps "Sync" in mobile app)
   */
  public async forceSync(): Promise<{ success: boolean; message: string; reading?: TelemetryReading }> {
    try {
      const status = await this.service.checkVehicleStatus();
      if (!status.isOnline) {
        // Car is sleeping. Save a snapshot from the latest verified vehicle state in DB so the user's manual action always succeeds and records a point!
        const existing = getVehicle(status.vin);
        if (existing && existing.last_soc && existing.last_rated_range) {
          const cap = (existing.last_rated_range * 221.9 / 1000) / (existing.last_soc / 100);
          const roundedCap = Math.round(cap * 10) / 10;
          const deg = Math.max(0, Math.round(((62.5 - roundedCap) / 62.5) * 1000) / 10);

          insertSnapshot({
            vin: status.vin,
            timestamp: existing.data_updated_at || Date.now(),
            odometer_miles: existing.last_odometer || 4796,
            battery_level_pct: existing.last_soc,
            rated_range_miles: existing.last_rated_range,
            calculated_capacity_kwh: roundedCap,
            degradation_pct: deg,
            is_fast_charging: existing.last_charging_state === 'Charging' ? 1 : 0,
            charger_power_kw: 0,
            trigger_reason: 'manual_sync_verified',
          });

          return {
            success: true,
            message: `Snapshot logged from latest verified vehicle reading (${existing.last_soc}%, ${existing.last_rated_range} mi). Car is resting in sleep mode.`,
          };
        }

        return {
          success: false,
          message: `💤 Your car is currently asleep (state: ${status.state}). VoltIQ preserves vehicle sleep to prevent phantom battery drain. Data will log automatically when the car wakes or charges.`,
        };
      }

      const telemetry = await this.service.fetchTelemetryIfOnline(
        status.vehicleId || '0',
        status.vin
      );

      if (!telemetry) {
        return {
          success: false,
          message: '💤 Vehicle is asleep or unavailable. It will automatically sync as soon as you wake or charge the car.',
        };
      }

      insertSnapshot({
        vin: status.vin,
        timestamp: telemetry.timestamp,
        odometer_miles: telemetry.odometerMiles,
        battery_level_pct: telemetry.batteryLevelPct,
        rated_range_miles: telemetry.ratedRangeMiles,
        calculated_capacity_kwh: telemetry.calculatedCapacityKwh,
        degradation_pct: telemetry.degradationPct,
        is_fast_charging: telemetry.isFastCharging ? 1 : 0,
        charger_power_kw: telemetry.chargerPowerKw,
        trigger_reason: 'manual_sync',
      });

      upsertVehicle({
        vin: status.vin,
        display_name: status.displayName,
        last_state: 'online',
        last_soc: telemetry.batteryLevelPct,
        last_rated_range: telemetry.ratedRangeMiles,
        last_odometer: telemetry.odometerMiles,
        last_charging_state: telemetry.chargingState,
        inside_temp: telemetry.insideTempC,
        outside_temp: telemetry.outsideTempC,
        is_locked: telemetry.isLocked !== undefined ? (telemetry.isLocked ? 1 : 0) : 1,
        data_updated_at: telemetry.timestamp,
        last_polled_at: Date.now(),
      });

      return {
        success: true,
        message: 'Manual sync complete: snapshot persisted to server database.',
        reading: telemetry,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Sync failed',
      };
    }
  }
}
