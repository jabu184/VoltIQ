export interface VehicleModelProfile {
  id: string;
  name: string;
  nominalCapacityKwh: number;
  whPerMile: number;
}

export const TESLA_PROFILES: VehicleModelProfile[] = [
  {
    id: 'm3_rwd_lfp',
    name: 'Model 3 RWD / Highland (62.5 kWh CATL LFP)',
    nominalCapacityKwh: 62.5,
    whPerMile: 221.9,
  },
  {
    id: 'm3_sr_legacy',
    name: 'Model 3 Standard Range Plus (Legacy 54 kWh)',
    nominalCapacityKwh: 54.0,
    whPerMile: 225,
  },
  {
    id: 'm3_lr',
    name: 'Model 3 Long Range (Dual Motor 75 kWh)',
    nominalCapacityKwh: 75.0,
    whPerMile: 240,
  },
  {
    id: 'm3_highland_lr',
    name: 'Model 3 Highland Long Range (78 kWh)',
    nominalCapacityKwh: 78.1,
    whPerMile: 235,
  },
  {
    id: 'my_rwd',
    name: 'Model Y RWD (60 kWh LFP)',
    nominalCapacityKwh: 60.0,
    whPerMile: 250,
  },
  {
    id: 'my_lr',
    name: 'Model Y Long Range (75 kWh)',
    nominalCapacityKwh: 75.0,
    whPerMile: 265,
  },
  {
    id: 'ms_lr',
    name: 'Model S Long Range / Plaid (100 kWh)',
    nominalCapacityKwh: 100.0,
    whPerMile: 290,
  },
  {
    id: 'mx_lr',
    name: 'Model X Long Range / Plaid (100 kWh)',
    nominalCapacityKwh: 100.0,
    whPerMile: 320,
  },
];

export interface BatteryHealthMetrics {
  nominalCapacityKwh: number;
  calculatedCapacityKwh: number;
  degradationPct: number;
  batteryHealthPct: number;
  healthGrade: 'A+' | 'A' | 'B' | 'C' | 'D';
  cellBalanceDeviationMv: number;
  cellBalanceStatus: 'Optimal' | 'Good' | 'Moderate' | 'Attention Needed';
  acRatioPct: number;
  dcRatioPct: number;
  chargeCycles: number;
  totalEnergyUsedKwh: number;
}

/**
 * Calculates real usable battery capacity (kWh) and degradation %
 * Formula: Capacity = (rated_range * Wh_per_mile / 1000) / (battery_level_pct / 100)
 */
export function calculateBatteryCapacity(
  ratedRangeMiles: number,
  batteryLevelPct: number,
  profile: VehicleModelProfile
): { calculatedCapacityKwh: number; degradationPct: number } {
  if (batteryLevelPct <= 0) {
    return { calculatedCapacityKwh: profile.nominalCapacityKwh, degradationPct: 0 };
  }

  const fraction = batteryLevelPct / 100;
  const currentEnergyRemainingKwh = (ratedRangeMiles * profile.whPerMile) / 1000;
  let fullCapacityKwh = currentEnergyRemainingKwh / fraction;

  // Bound within realistic physical limits
  fullCapacityKwh = Math.min(fullCapacityKwh, profile.nominalCapacityKwh * 1.05);
  fullCapacityKwh = Math.max(fullCapacityKwh, profile.nominalCapacityKwh * 0.4);

  const degradationPct = Math.max(
    0,
    ((profile.nominalCapacityKwh - fullCapacityKwh) / profile.nominalCapacityKwh) * 100
  );

  return {
    calculatedCapacityKwh: Math.round(fullCapacityKwh * 100) / 100,
    degradationPct: Math.round(degradationPct * 100) / 100,
  };
}

/**
 * Computes battery health summary metrics based on snapshots and model profile
 */
export function evaluateBatteryHealth(
  snapshots: { is_fast_charging?: number; degradation_pct?: number; calculated_capacity_kwh?: number; rated_range_miles?: number; battery_level_pct?: number }[],
  profile: VehicleModelProfile,
  latestLiveReading?: { ratedRangeMiles: number; batteryLevelPct: number }
): BatteryHealthMetrics {
  let calculatedCapacity = profile.nominalCapacityKwh;
  let degradationPct = 0;

  if (latestLiveReading && latestLiveReading.batteryLevelPct > 0) {
    const calc = calculateBatteryCapacity(latestLiveReading.ratedRangeMiles, latestLiveReading.batteryLevelPct, profile);
    calculatedCapacity = calc.calculatedCapacityKwh;
    degradationPct = calc.degradationPct;
  } else if (snapshots.length > 0) {
    const latest = snapshots[snapshots.length - 1];
    if (latest.rated_range_miles && latest.battery_level_pct) {
      const calc = calculateBatteryCapacity(latest.rated_range_miles, latest.battery_level_pct, profile);
      calculatedCapacity = calc.calculatedCapacityKwh;
      degradationPct = calc.degradationPct;
    } else {
      calculatedCapacity = latest.calculated_capacity_kwh || profile.nominalCapacityKwh;
      degradationPct = latest.degradation_pct || 0;
    }
  }

  const healthPct = Math.max(0, Math.min(100, 100 - degradationPct));

  // Determine Grade
  let healthGrade: 'A+' | 'A' | 'B' | 'C' | 'D' = 'A+';
  if (healthPct >= 95) healthGrade = 'A+';
  else if (healthPct >= 90) healthGrade = 'A';
  else if (healthPct >= 85) healthGrade = 'B';
  else if (healthPct >= 80) healthGrade = 'C';
  else healthGrade = 'D';

  const simulatedDeviation = Math.round((4.0 + (degradationPct * 0.45)) * 10) / 10;
  let cellBalanceStatus: 'Optimal' | 'Good' | 'Moderate' | 'Attention Needed' = 'Optimal';
  if (simulatedDeviation <= 8) cellBalanceStatus = 'Optimal';
  else if (simulatedDeviation <= 15) cellBalanceStatus = 'Good';
  else if (simulatedDeviation <= 25) cellBalanceStatus = 'Moderate';
  else cellBalanceStatus = 'Attention Needed';

  let fastCount = 0;
  let slowCount = 0;
  for (const s of snapshots) {
    if (s.is_fast_charging) fastCount++;
    else slowCount++;
  }
  const totalCharges = fastCount + slowCount;
  const dcRatioPct = totalCharges > 0 ? Math.round((fastCount / totalCharges) * 100) : 0;
  const acRatioPct = totalCharges > 0 ? 100 - dcRatioPct : 100;

  const latestOdo = (latestLiveReading as any)?.odometerMiles || (snapshots.length > 0 ? (snapshots[snapshots.length - 1] as any).odometer_miles || 0 : 0);
  const totalEnergyUsedKwh = latestOdo > 0 ? Math.round((latestOdo * (profile.whPerMile * 1.08)) / 1000) : 0;
  const chargeCycles = totalEnergyUsedKwh > 0 ? Math.round((totalEnergyUsedKwh / profile.nominalCapacityKwh) * 10) / 10 : 0;

  return {
    nominalCapacityKwh: profile.nominalCapacityKwh,
    calculatedCapacityKwh: calculatedCapacity,
    degradationPct,
    batteryHealthPct: Math.round(healthPct * 10) / 10,
    healthGrade,
    cellBalanceDeviationMv: simulatedDeviation,
    cellBalanceStatus,
    acRatioPct,
    dcRatioPct,
    chargeCycles,
    totalEnergyUsedKwh,
  };
}
