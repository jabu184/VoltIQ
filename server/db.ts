import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import * as fs from 'node:fs';

export interface ServerSnapshot {
  id?: number;
  vin: string;
  timestamp: number;
  odometer_miles: number;
  battery_level_pct: number;
  rated_range_miles: number;
  calculated_capacity_kwh: number;
  degradation_pct: number;
  is_fast_charging: number;
  charger_power_kw: number;
  trigger_reason?: string;
}

export interface VehicleRecord {
  vin: string;
  display_name: string;
  model: string;
  last_state: string;
  last_soc: number;
  last_rated_range: number;
  last_odometer: number;
  last_charging_state: string;
  inside_temp?: number;
  outside_temp?: number;
  is_locked?: number | boolean;
  updated_at: number;
}

export interface TokenRecord {
  id?: number;
  client_id?: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  updated_at: number;
}

let dbInstance: DatabaseSync | null = null;

export function getDb(customPath?: string): DatabaseSync {
  if (dbInstance) return dbInstance;

  const dbDir = customPath ? path.dirname(customPath) : path.join(process.cwd(), 'server');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbFilePath = customPath || path.join(dbDir, 'voltiq_server.db');
  const db = new DatabaseSync(dbFilePath);

  // Initialize schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      vin TEXT PRIMARY KEY,
      display_name TEXT,
      model TEXT,
      last_state TEXT,
      last_soc REAL,
      last_rated_range REAL,
      last_odometer REAL,
      last_charging_state TEXT,
      inside_temp REAL,
      outside_temp REAL,
      is_locked INTEGER DEFAULT 1,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS battery_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vin TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      odometer_miles REAL NOT NULL,
      battery_level_pct REAL NOT NULL,
      rated_range_miles REAL NOT NULL,
      calculated_capacity_kwh REAL NOT NULL,
      degradation_pct REAL NOT NULL,
      is_fast_charging INTEGER DEFAULT 0,
      charger_power_kw REAL DEFAULT 0,
      trigger_reason TEXT DEFAULT 'charge_complete'
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_vin ON battery_snapshots(vin);
    CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON battery_snapshots(timestamp);
  `);

  try { db.exec('ALTER TABLE vehicles ADD COLUMN inside_temp REAL'); } catch {}
  try { db.exec('ALTER TABLE vehicles ADD COLUMN outside_temp REAL'); } catch {}
  try { db.exec('ALTER TABLE vehicles ADD COLUMN is_locked INTEGER DEFAULT 1'); } catch {}

  dbInstance = db;
  return dbInstance;
}

export function saveTokens(tokenData: {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  clientId?: string;
}): void {
  const db = getDb();
  const expiresAt = Date.now() + (tokenData.expiresIn || 28800) * 1000;
  const now = Date.now();

  const existing = db.prepare('SELECT id FROM tokens LIMIT 1').get() as { id: number } | undefined;
  if (existing) {
    db.prepare(`
      UPDATE tokens
      SET access_token = ?, refresh_token = ?, expires_at = ?, client_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      tokenData.accessToken,
      tokenData.refreshToken,
      expiresAt,
      tokenData.clientId || null,
      now,
      existing.id
    );
  } else {
    db.prepare(`
      INSERT INTO tokens (client_id, access_token, refresh_token, expires_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      tokenData.clientId || null,
      tokenData.accessToken,
      tokenData.refreshToken,
      expiresAt,
      now
    );
  }
}

export function getTokens(): TokenRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tokens ORDER BY id DESC LIMIT 1').get() as TokenRecord | undefined;
  return row || null;
}

export function upsertVehicle(vehicle: Partial<VehicleRecord> & { vin: string }): void {
  const db = getDb();
  const now = Date.now();

  db.prepare(`
    INSERT INTO vehicles (vin, display_name, model, last_state, last_soc, last_rated_range, last_odometer, last_charging_state, inside_temp, outside_temp, is_locked, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(vin) DO UPDATE SET
      display_name = coalesce(excluded.display_name, vehicles.display_name),
      model = coalesce(excluded.model, vehicles.model),
      last_state = coalesce(excluded.last_state, vehicles.last_state),
      last_soc = coalesce(excluded.last_soc, vehicles.last_soc),
      last_rated_range = coalesce(excluded.last_rated_range, vehicles.last_rated_range),
      last_odometer = coalesce(excluded.last_odometer, vehicles.last_odometer),
      last_charging_state = coalesce(excluded.last_charging_state, vehicles.last_charging_state),
      inside_temp = coalesce(excluded.inside_temp, vehicles.inside_temp),
      outside_temp = coalesce(excluded.outside_temp, vehicles.outside_temp),
      is_locked = coalesce(excluded.is_locked, vehicles.is_locked),
      updated_at = excluded.updated_at
  `).run(
    vehicle.vin,
    vehicle.display_name ?? null,
    vehicle.model ?? null,
    vehicle.last_state ?? null,
    vehicle.last_soc !== undefined ? vehicle.last_soc : null,
    vehicle.last_rated_range !== undefined ? vehicle.last_rated_range : null,
    vehicle.last_odometer !== undefined ? vehicle.last_odometer : null,
    vehicle.last_charging_state ?? null,
    vehicle.inside_temp !== undefined ? vehicle.inside_temp : null,
    vehicle.outside_temp !== undefined ? vehicle.outside_temp : null,
    vehicle.is_locked !== undefined ? (vehicle.is_locked ? 1 : 0) : null,
    now
  );
}

export function getVehicle(vin?: string): VehicleRecord | null {
  const db = getDb();
  let veh: VehicleRecord | null = null;
  if (vin) {
    veh = (db.prepare('SELECT * FROM vehicles WHERE vin = ?').get(vin) as unknown as VehicleRecord) || null;
  } else {
    veh = (db.prepare('SELECT * FROM vehicles ORDER BY updated_at DESC LIMIT 1').get() as unknown as VehicleRecord) || null;
  }

  // If vehicle has 0 odometer or default stats, restore from the latest snapshot in database
  if (veh) {
    const latestSnap = db.prepare('SELECT * FROM battery_snapshots WHERE vin = ? ORDER BY timestamp DESC LIMIT 1').get(veh.vin) as ServerSnapshot | undefined;
    if (latestSnap) {
      if (veh.last_soc === null || veh.last_soc === undefined) {
        veh.last_soc = latestSnap.battery_level_pct;
      }
      if (veh.last_rated_range === null || veh.last_rated_range === undefined) {
        veh.last_rated_range = latestSnap.rated_range_miles;
      }
      if (!veh.last_odometer || veh.last_odometer === 0) {
        veh.last_odometer = latestSnap.odometer_miles;
      }
    }
  }

  return veh;
}

export function insertSnapshot(snapshot: ServerSnapshot): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO battery_snapshots (
      vin, timestamp, odometer_miles, battery_level_pct, rated_range_miles,
      calculated_capacity_kwh, degradation_pct, is_fast_charging, charger_power_kw, trigger_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshot.vin,
    snapshot.timestamp || Date.now(),
    snapshot.odometer_miles,
    snapshot.battery_level_pct,
    snapshot.rated_range_miles,
    snapshot.calculated_capacity_kwh,
    snapshot.degradation_pct,
    snapshot.is_fast_charging ? 1 : 0,
    snapshot.charger_power_kw || 0,
    snapshot.trigger_reason || 'charge_complete'
  );
  return Number(result.lastInsertRowid);
}

export function getAllSnapshots(vin?: string, limit: number = 5000): ServerSnapshot[] {
  const db = getDb();
  if (vin) {
    return db
      .prepare('SELECT * FROM battery_snapshots WHERE vin = ? ORDER BY odometer_miles ASC LIMIT ?')
      .all(vin, limit) as unknown as ServerSnapshot[];
  }
  return db
    .prepare('SELECT * FROM battery_snapshots ORDER BY odometer_miles ASC LIMIT ?')
    .all(limit) as unknown as ServerSnapshot[];
}

export function getSnapshotCount(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM battery_snapshots').get() as { count: number };
  return row?.count || 0;
}

export function seedSampleSnapshotsIfEmpty(vin: string = '5YJ3E1EB8LF892301'): void {
  const count = getSnapshotCount();
  if (count > 0) return;

  const baseOdo = 12000;
  const initialCap = 74.8;
  const nominal = 75.0;

  // Insert 6 months of post-charge snapshots
  for (let i = 0; i < 28; i++) {
    const odo = baseOdo + i * 460 + Math.floor(Math.random() * 40);
    const capacity = Math.max(68, initialCap - i * 0.11 - (Math.random() * 0.15));
    const degradation = Math.round(((nominal - capacity) / nominal) * 1000) / 10;
    const isDc = i % 4 === 0;

    insertSnapshot({
      vin,
      timestamp: Date.now() - (28 - i) * 7 * 24 * 3600 * 1000,
      odometer_miles: odo,
      battery_level_pct: 80 + Math.floor(Math.random() * 15),
      rated_range_miles: Math.round((capacity * 0.8 * 1000) / 240),
      calculated_capacity_kwh: Math.round(capacity * 10) / 10,
      degradation_pct: degradation,
      is_fast_charging: isDc ? 1 : 0,
      charger_power_kw: isDc ? 120 : 7.2,
      trigger_reason: 'charge_complete',
    });
  }

  upsertVehicle({
    vin,
    display_name: 'VoltWise Model 3',
    model: 'Model 3 Long Range',
    last_state: 'online',
    last_soc: 82,
    last_rated_range: 246,
    last_odometer: 24820,
    last_charging_state: 'Complete',
  });
}
