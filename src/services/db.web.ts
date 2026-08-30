export interface BatterySnapshot {
  id?: number;
  timestamp: number;
  odometer_miles: number;
  battery_level_pct: number;
  rated_range_miles: number;
  calculated_capacity_kwh: number;
  degradation_pct: number;
  is_fast_charging: number;
  charger_power_kw: number;
}

const WEB_STORAGE_KEY = 'voltiq_web_battery_snapshots';

function getWebSnapshots(): BatterySnapshot[] {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(WEB_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    }
  } catch {}
  return [];
}

function saveWebSnapshots(snaps: BatterySnapshot[]): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(WEB_STORAGE_KEY, JSON.stringify(snaps));
    }
  } catch {}
}

export async function getDatabase(): Promise<any> {
  return null;
}

export async function initDatabase(): Promise<void> {
  // Web storage ready
}

export async function insertSnapshot(snapshot: Omit<BatterySnapshot, 'id'>): Promise<number> {
  const current = getWebSnapshots();
  const newId = current.length > 0 ? Math.max(...current.map((s) => s.id || 0)) + 1 : 1;
  const newSnap: BatterySnapshot = { ...snapshot, id: newId };
  current.unshift(newSnap);
  saveWebSnapshots(current);
  return newId;
}

export async function getSnapshots(limit: number = 100): Promise<BatterySnapshot[]> {
  return getWebSnapshots().slice(0, limit);
}

export async function getLatestSnapshot(): Promise<BatterySnapshot | null> {
  const list = getWebSnapshots();
  return list.length > 0 ? list[0] : null;
}

export async function clearSnapshots(): Promise<void> {
  saveWebSnapshots([]);
}

export async function seedSampleData(): Promise<void> {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const sampleData: BatterySnapshot[] = [];

  for (let i = 180; i >= 0; i -= 10) {
    const timestamp = now - i * dayMs;
    const odometer_miles = 25000 - i * 35;
    const degradation_pct = 3.5 + (180 - i) * 0.012 + (Math.random() * 0.4 - 0.2);
    const nominalFullCapacity = 75.0;
    const calculated_capacity_kwh = nominalFullCapacity * (1 - degradation_pct / 100);
    const battery_level_pct = 75 + Math.round(Math.random() * 20);
    const rated_range_miles = (calculated_capacity_kwh / nominalFullCapacity) * 310 * (battery_level_pct / 100);

    sampleData.push({
      id: 180 - i + 1,
      timestamp,
      odometer_miles,
      battery_level_pct,
      rated_range_miles: parseFloat(rated_range_miles.toFixed(1)),
      calculated_capacity_kwh: parseFloat(calculated_capacity_kwh.toFixed(2)),
      degradation_pct: parseFloat(degradation_pct.toFixed(2)),
      is_fast_charging: i % 30 === 0 ? 1 : 0,
      charger_power_kw: i % 30 === 0 ? 150 : 7.4,
    });
  }

  saveWebSnapshots(sampleData);
}