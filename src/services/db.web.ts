export interface BatterySnapshot {
  id?: number;
  vehicle_id?: string;
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

export function isSameVehicleId(snapshotVid?: string, targetVid?: string): boolean {
  if (!targetVid) return true;
  const isDefaultTarget = targetVid === 'veh_default' || targetVid === 'default_car';
  if (isDefaultTarget) {
    return !snapshotVid || snapshotVid === 'veh_default' || snapshotVid === 'default_car';
  }
  return snapshotVid === targetVid;
}

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

export async function insertSnapshot(snapshot: Omit<BatterySnapshot, 'id'>, vehicleId?: string): Promise<number> {
  const vId = vehicleId || snapshot.vehicle_id || 'veh_default';
  const current = getWebSnapshots();
  const newId = current.length > 0 ? Math.max(...current.map((s) => Number(s.id) || 0)) + 1 : 1;
  const newSnap: BatterySnapshot = { ...snapshot, vehicle_id: vId, id: newId };
  current.unshift(newSnap);
  saveWebSnapshots(current);
  return newId;
}

export async function getSnapshots(limit: number = 100, vehicleId?: string): Promise<BatterySnapshot[]> {
  let list = getWebSnapshots();
  if (vehicleId) {
    list = list.filter((s) => isSameVehicleId(s.vehicle_id, vehicleId));
  }
  return list.slice(0, limit);
}

export async function getLatestSnapshot(vehicleId?: string): Promise<BatterySnapshot | null> {
  const list = await getSnapshots(1, vehicleId);
  return list.length > 0 ? list[0] : null;
}

export async function updateSnapshot(id: number, updates: Partial<BatterySnapshot>, vehicleId?: string): Promise<boolean> {
  const list = getWebSnapshots();
  const index = list.findIndex((s) => Number(s.id) === Number(id) && isSameVehicleId(s.vehicle_id, vehicleId));
  if (index === -1) return false;
  list[index] = { ...list[index], ...updates };
  saveWebSnapshots(list);
  return true;
}

export async function deleteSnapshot(id: number, vehicleId?: string): Promise<boolean> {
  const list = getWebSnapshots();
  const filtered = list.filter((s) => !(Number(s.id) === Number(id) && isSameVehicleId(s.vehicle_id, vehicleId)));
  saveWebSnapshots(filtered);
  return filtered.length < list.length;
}

export async function clearSnapshots(vehicleId?: string): Promise<void> {
  if (vehicleId) {
    const remaining = getWebSnapshots().filter((s) => !isSameVehicleId(s.vehicle_id, vehicleId));
    saveWebSnapshots(remaining);
  } else {
    saveWebSnapshots([]);
  }
}

export async function seedSampleData(nominalCapacityKwh: number = 60.0, vehicleId?: string): Promise<void> {
  const vId = vehicleId || 'veh_default';
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const sampleData: BatterySnapshot[] = [];

  for (let i = 180; i >= 0; i -= 10) {
    const timestamp = now - i * dayMs;
    const odometer_miles = 25000 - i * 35;
    const degradation_pct = 3.5 + (180 - i) * 0.012 + (Math.random() * 0.4 - 0.2);
    const nominalFullCapacity = nominalCapacityKwh;
    const calculated_capacity_kwh = nominalFullCapacity * (1 - degradation_pct / 100);
    const battery_level_pct = 75 + Math.round(Math.random() * 20);
    const rated_range_miles = (calculated_capacity_kwh / nominalFullCapacity) * 310 * (battery_level_pct / 100);

    sampleData.push({
      id: 180 - i + 1,
      vehicle_id: vId,
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

  const existing = getWebSnapshots().filter((s) => !isSameVehicleId(s.vehicle_id, vId));
  saveWebSnapshots([...sampleData, ...existing]);
}
