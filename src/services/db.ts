import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

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

const DB_NAME = 'tesla_battery.db';
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

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase | null> {
  if (Platform.OS === 'web') return null;
  if (dbInstance) return dbInstance;
  return initDatabase();
}

export async function initDatabase(): Promise<SQLite.SQLiteDatabase | null> {
  if (Platform.OS === 'web') return null;

  try {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS battery_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id TEXT DEFAULT 'default_car',
        timestamp INTEGER NOT NULL,
        odometer_miles REAL NOT NULL,
        battery_level_pct REAL NOT NULL,
        rated_range_miles REAL NOT NULL,
        calculated_capacity_kwh REAL NOT NULL,
        degradation_pct REAL NOT NULL,
        is_fast_charging INTEGER DEFAULT 0,
        charger_power_kw REAL DEFAULT 0
      );
    `);
    try {
      await db.execAsync("ALTER TABLE battery_snapshots ADD COLUMN vehicle_id TEXT DEFAULT 'default_car'");
    } catch {}
    dbInstance = db;
    return db;
  } catch (err) {
    console.warn('SQLite init error:', err);
    return null;
  }
}

export async function insertSnapshot(snapshot: Omit<BatterySnapshot, 'id'>, vehicleId?: string): Promise<number> {
  const vId = vehicleId || snapshot.vehicle_id || 'default_car';
  if (Platform.OS === 'web') {
    const list = getWebSnapshots();
    const newId = list.length > 0 ? (list[0].id || 0) + 1 : 1;
    const item: BatterySnapshot = { ...snapshot, vehicle_id: vId, id: newId };
    list.unshift(item);
    saveWebSnapshots(list);
    return newId;
  }

  const db = await getDatabase();
  if (!db) return 0;

  const result = await db.runAsync(
    `INSERT INTO battery_snapshots (
      vehicle_id, timestamp, odometer_miles, battery_level_pct, rated_range_miles,
      calculated_capacity_kwh, degradation_pct, is_fast_charging, charger_power_kw
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    vId,
    snapshot.timestamp,
    snapshot.odometer_miles,
    snapshot.battery_level_pct,
    snapshot.rated_range_miles,
    snapshot.calculated_capacity_kwh,
    snapshot.degradation_pct,
    snapshot.is_fast_charging,
    snapshot.charger_power_kw
  );
  return result.lastInsertRowId;
}

export async function getSnapshots(limit: number = 100, vehicleId?: string): Promise<BatterySnapshot[]> {
  if (Platform.OS === 'web') {
    let list = getWebSnapshots();
    if (vehicleId) {
      list = list.filter((s) => s.vehicle_id === vehicleId || (!s.vehicle_id && vehicleId === 'default_car'));
    }
    return list.slice(0, limit);
  }

  const db = await getDatabase();
  if (!db) return [];

  let query = 'SELECT * FROM battery_snapshots';
  const params: any[] = [];
  if (vehicleId) {
    query += ' WHERE vehicle_id = ? OR (vehicle_id IS NULL AND ? = \'default_car\')';
    params.push(vehicleId, vehicleId);
  }
  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  const rows = await db.getAllAsync<BatterySnapshot>(query, ...params);
  return rows;
}

export async function getLatestSnapshot(vehicleId?: string): Promise<BatterySnapshot | null> {
  const list = await getSnapshots(1, vehicleId);
  return list.length > 0 ? list[0] : null;
}

export async function updateSnapshot(id: number, updates: Partial<BatterySnapshot>, vehicleId?: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    const list = getWebSnapshots();
    const index = list.findIndex((s) => s.id === id && (!vehicleId || s.vehicle_id === vehicleId || (!s.vehicle_id && vehicleId === 'default_car')));
    if (index === -1) return false;
    list[index] = { ...list[index], ...updates };
    saveWebSnapshots(list);
    return true;
  }

  const db = await getDatabase();
  if (!db) return false;

  const sets: string[] = [];
  const params: any[] = [];
  if (updates.battery_level_pct !== undefined) { sets.push('battery_level_pct = ?'); params.push(updates.battery_level_pct); }
  if (updates.rated_range_miles !== undefined) { sets.push('rated_range_miles = ?'); params.push(updates.rated_range_miles); }
  if (updates.odometer_miles !== undefined) { sets.push('odometer_miles = ?'); params.push(updates.odometer_miles); }
  if (updates.calculated_capacity_kwh !== undefined) { sets.push('calculated_capacity_kwh = ?'); params.push(updates.calculated_capacity_kwh); }
  if (updates.degradation_pct !== undefined) { sets.push('degradation_pct = ?'); params.push(updates.degradation_pct); }

  if (sets.length === 0) return true;
  let sql = `UPDATE battery_snapshots SET ${sets.join(', ')} WHERE id = ?`;
  params.push(id);
  if (vehicleId) {
    sql += ' AND (vehicle_id = ? OR vehicle_id IS NULL)';
    params.push(vehicleId);
  }

  await db.runAsync(sql, ...params);
  return true;
}

export async function deleteSnapshot(id: number, vehicleId?: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    const list = getWebSnapshots();
    const filtered = list.filter((s) => !(s.id === id && (!vehicleId || s.vehicle_id === vehicleId || (!s.vehicle_id && vehicleId === 'default_car'))));
    saveWebSnapshots(filtered);
    return filtered.length < list.length;
  }

  const db = await getDatabase();
  if (!db) return false;

  let sql = 'DELETE FROM battery_snapshots WHERE id = ?';
  const params: any[] = [id];
  if (vehicleId) {
    sql += ' AND (vehicle_id = ? OR vehicle_id IS NULL)';
    params.push(vehicleId);
  }

  await db.runAsync(sql, ...params);
  return true;
}

export async function clearSnapshots(vehicleId?: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (vehicleId) {
      const remaining = getWebSnapshots().filter((s) => s.vehicle_id && s.vehicle_id !== vehicleId);
      saveWebSnapshots(remaining);
    } else {
      saveWebSnapshots([]);
    }
    return;
  }

  const db = await getDatabase();
  if (!db) return;

  if (vehicleId) {
    await db.runAsync('DELETE FROM battery_snapshots WHERE vehicle_id = ?', vehicleId);
  } else {
    await db.runAsync('DELETE FROM battery_snapshots');
  }
}

export async function seedSampleData(nominalCapacityKwh: number = 60.0, vehicleId?: string): Promise<void> {
  const vId = vehicleId || 'default_car';
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

  if (Platform.OS === 'web') {
    const existing = getWebSnapshots().filter((s) => s.vehicle_id !== vId);
    saveWebSnapshots([...sampleData, ...existing]);
    return;
  }

  const db = await getDatabase();
  if (!db) return;

  await db.runAsync('DELETE FROM battery_snapshots WHERE vehicle_id = ?', vId);
  for (const s of sampleData) {
    await insertSnapshot(s, vId);
  }
}
