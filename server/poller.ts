import { TeslaFleetService, TelemetryReading } from './teslaFleetService';
import { getVehicle, upsertVehicle, insertSnapshot } from './db';

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
   * 3. Logs a snapshot only when SoC changes or charge finishes.
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
      const prevChargingState = existingVehicle?.last_charging_state || 'Disconnected';
      const prevSoc = existingVehicle?.last_soc ?? telemetry.batteryLevelPct;
      const currChargingState = telemetry.chargingState;
      const currSoc = telemetry.batteryLevelPct;

      let shouldLogSnapshot = false;
      let reason = '';

      // Detection Rule 1: A charge session just finished
      // (Car was charging and now switched to Complete, Disconnected, or Stopped)
      const wasCharging = prevChargingState.toLowerCase() === 'charging';
      const isNowFinishedCharging =
        currChargingState.toLowerCase() === 'complete' ||
        currChargingState.toLowerCase() === 'disconnected' ||
        currChargingState.toLowerCase() === 'stopped';

      if (wasCharging && isNowFinishedCharging) {
        shouldLogSnapshot = true;
        reason = 'charge_complete';
        console.log(
          `[SmartPoller] ⚡ Charge Finished! Transitioned from ${prevChargingState} to ${currChargingState}. Logging clean battery health snapshot.`
        );
      }
      // Detection Rule 2: SoC increased significantly while resting (offline charge completed)
      else if (currSoc >= prevSoc + 5 && currChargingState.toLowerCase() !== 'charging') {
        shouldLogSnapshot = true;
        reason = 'soc_increase_charge_detected';
        console.log(
          `[SmartPoller] ⚡ SoC increased from ${prevSoc}% to ${currSoc}%. Post-charge snapshot triggered.`
        );
      }

      // Update vehicle tracking in DB
      upsertVehicle({
        vin: status.vin,
        display_name: status.displayName,
        last_state: 'online',
        last_soc: currSoc,
        last_rated_range: telemetry.ratedRangeMiles,
        last_odometer: telemetry.odometerMiles,
        last_charging_state: currChargingState,
        inside_temp: telemetry.insideTempC,
        outside_temp: telemetry.outsideTempC,
        is_locked: telemetry.isLocked !== undefined ? (telemetry.isLocked ? 1 : 0) : 1,
      });

      if (shouldLogSnapshot) {
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
          trigger_reason: reason,
        });

        return {
          status: 'snapshot_logged',
          message: `Snapshot logged successfully (${reason}).`,
          reading: telemetry,
        };
      }

      console.log(
        `[SmartPoller] Vehicle online (SoC: ${currSoc}%, State: ${currChargingState}). No post-charge event; API queries conserved.`
      );
      return {
        status: 'skipped',
        message: 'No charging event or SoC change. Snapshot skipped to minimize API calls.',
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
