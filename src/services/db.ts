import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

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

let dbInstance: SQLite.SQLiteDatabase | null = null;
const WEB_STORAGE_KEY = 'voltiq_web_battery_snapshots';

// Web local storage fallback helpers
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

export async function getDatabase(): Promise<SQLite.SQLiteDatabase | null> {
  if (Platform.OS === 'web') {
    return null;
  }

  if (dbInstance) {
    return dbInstance;
  }

  try {
    const db = await SQLite.openDatabaseAsync('tesla_battery.db');
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS battery_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        odometer_miles REAL NOT NULL,
        battery_level_pct INTEGER NOT NULL,
        rated_range_miles REAL NOT NULL,
        calculated_capacity_kwh REAL NOT NULL,
        degradation_pct REAL NOT NULL,
        is_fast_charging INTEGER DEFAULT 0,
        charger_power_kw REAL DEFAULT 0
      );
    `);
    dbInstance = db;
    return db;
  } catch (err) {
    console.warn('SQLite init error:', err);
    return null;
  }
}

export async function insertSnapshot(snapshot: Omit<BatterySnapshot, 'id'>): Promise<number> {
  if (Platform.OS === 'web') {
    const list = getWebSnapshots();
    const newId = list.length > 0 ? (list[list.length - 1].id || 0) + 1 : 1;
    const item: BatterySnapshot = { ...snapshot, id: newId };
    list.push(item);
    saveWebSnapshots(list);
    return newId;
  }

  const db = await getDatabase();
  if (!db) return 0;

  const result = await db.runAsync(
    `INSERT INTO battery_snapshots (
      timestamp, odometer_miles, battery_level_pct, rated_range_miles,
      calculated_capacity_kwh, degradation_pct, is_fast_charging, charger_power_kw
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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

export async function getSnapshots(limit: number = 100): Promise<BatterySnapshot[]> {
  if (Platform.OS === 'web') {
    const list = getWebSnapshots();
    list.sort((a, b) => a.timestamp - b.timestamp);
    return list.slice(-limit);
  }

  const db = await getDatabase();
  if (!db) return [];

  return await db.getAllAsync<BatterySnapshot>(
    `SELECT * FROM battery_snapshots ORDER BY timestamp ASC LIMIT ?`,
    limit
  );
}

export async function getLatestSnapshot(): Promise<BatterySnapshot | null> {
  if (Platform.OS === 'web') {
    const list = getWebSnapshots();
    return list.length > 0 ? list[list.length - 1] : null;
  }

  const db = await getDatabase();
  if (!db) return null;

  return await db.getFirstAsync<BatterySnapshot>(
    `SELECT * FROM battery_snapshots ORDER BY timestamp DESC LIMIT 1`
  );
}

export async function clearSnapshots(): Promise<void> {
  if (Platform.OS === 'web') {
    saveWebSnapshots([]);
    return;
  }

  const db = await getDatabase();
  if (db) {
    await db.runAsync(`DELETE FROM battery_snapshots`);
  }
}

/**
 * Seeds realistic historical telemetry snapshots for testing and demo purposes
 */
export async function seedSampleData(nominalCapacityKwh: number = 75.0): Promise<void> {
  const existing = await getSnapshots(10);
  if (existing && existing.length > 0) {
    return; // Already populated
  }

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  
  const samples: Omit<BatterySnapshot, 'id'>[] = [];
  const baseOdometer = 18500;

  for (let i = 180; i >= 0; i -= 10) {
    const timestamp = now - i * dayMs;
    const milesAdded = (180 - i) * 35; // ~35 miles per day
    const odo = baseOdometer + milesAdded;
    
    // Gradual realistic degradation curve
    const degradation = 2.0 + ((180 - i) / 180) * 2.8; 
    const currentCap = nominalCapacityKwh * (1 - degradation / 100);
    const soc = 70 + Math.floor(Math.random() * 20); // 70-90%
    const ratedRange = (currentCap * (soc / 100) / 0.24); // ~240 Wh/mi
    const isFast = Math.random() > 0.75 ? 1 : 0;
    const power = isFast ? 120 + Math.random() * 80 : (Math.random() > 0.5 ? 7.4 : 0);

    samples.push({
      timestamp,
      odometer_miles: Math.round(odo * 10) / 10,
      battery_level_pct: soc,
      rated_range_miles: Math.round(ratedRange * 10) / 10,
      calculated_capacity_kwh: Math.round(currentCap * 100) / 100,
      degradation_pct: Math.round(degradation * 100) / 100,
      is_fast_charging: isFast,
      charger_power_kw: Math.round(power * 10) / 10,
    });
  }

  for (const sample of samples) {
    await insertSnapshot(sample);
  }
}
