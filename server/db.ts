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
  data_updated_at?: number;
  last_polled_at?: number;
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

  const dbDir = customPath ? path.dirname(customPath) : (process.env.DATA_DIR || path.join(process.cwd(), 'server'));
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
      data_updated_at INTEGER,
      last_polled_at INTEGER,
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
  `);

  try { db.exec(`ALTER TABLE vehicles ADD COLUMN data_updated_at INTEGER;`); } catch {}
  try { db.exec(`ALTER TABLE vehicles ADD COLUMN last_polled_at INTEGER;`); } catch {}

  dbInstance = db;
  return db;
}

export function insertSnapshot(snapshot: Omit<ServerSnapshot, 'id'>): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO battery_snapshots (
      vin, timestamp, odometer_miles, battery_level_pct, rated_range_miles,
      calculated_capacity_kwh, degradation_pct, is_fast_charging, charger_power_kw, trigger_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    snapshot.vin,
    snapshot.timestamp,
    snapshot.odometer_miles,
    snapshot.battery_level_pct,
    snapshot.rated_range_miles,
    snapshot.calculated_capacity_kwh,
    snapshot.degradation_pct,
    snapshot.is_fast_charging,
    snapshot.charger_power_kw,
    snapshot.trigger_reason || 'charge_complete'
  );
  return Number(result.lastInsertRowid);
}

export function updateSnapshot(id: number, updates: Partial<ServerSnapshot>): boolean {
  const db = getDb();
  const sets: string[] = [];
  const params: any[] = [];
  if (updates.battery_level_pct !== undefined) { sets.push('battery_level_pct = ?'); params.push(updates.battery_level_pct); }
  if (updates.rated_range_miles !== undefined) { sets.push('rated_range_miles = ?'); params.push(updates.rated_range_miles); }
  if (updates.odometer_miles !== undefined) { sets.push('odometer_miles = ?'); params.push(updates.odometer_miles); }
  if (updates.calculated_capacity_kwh !== undefined) { sets.push('calculated_capacity_kwh = ?'); params.push(updates.calculated_capacity_kwh); }
  if (updates.degradation_pct !== undefined) { sets.push('degradation_pct = ?'); params.push(updates.degradation_pct); }

  if (sets.length === 0) return true;
  params.push(id);
  const stmt = db.prepare(`UPDATE battery_snapshots SET ${sets.join(', ')} WHERE id = ?`);
  const result = stmt.run(...params);
  return result.changes > 0;
}

export function deleteSnapshot(id: number): boolean {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM battery_snapshots WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

export function getAllSnapshots(vin?: string, limit: number = 5000): ServerSnapshot[] {
  const db = getDb();
  let query = 'SELECT * FROM battery_snapshots';
  const params: any[] = [];
  if (vin) {
    query += ' WHERE vin = ?';
    params.push(vin);
  }
  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  const stmt = db.prepare(query);
  return stmt.all(...params) as unknown as ServerSnapshot[];
}

export function getSnapshotCount(vin?: string): number {
  const db = getDb();
  let query = 'SELECT COUNT(*) as count FROM battery_snapshots';
  const params: any[] = [];
  if (vin) {
    query += ' WHERE vin = ?';
    params.push(vin);
  }
  const stmt = db.prepare(query);
  const row = stmt.get(...params) as { count: number };
  return row ? row.count : 0;
}

export function getVehicle(vin?: string): VehicleRecord | null {
  const db = getDb();
  let query = 'SELECT * FROM vehicles';
  const params: any[] = [];
  if (vin) {
    query += ' WHERE vin = ?';
    params.push(vin);
  }
  query += ' ORDER BY updated_at DESC LIMIT 1';
  const stmt = db.prepare(query);
  const row = stmt.get(...params);
  return (row as unknown as VehicleRecord) || null;
}

export function upsertVehicle(record: Partial<VehicleRecord> & { vin: string }): void {
  const db = getDb();
  const existing = getVehicle(record.vin);
  const now = Date.now();

  if (existing) {
    const stmt = db.prepare(`
      UPDATE vehicles SET
        display_name = COALESCE(?, display_name),
        model = COALESCE(?, model),
        last_state = COALESCE(?, last_state),
        last_soc = COALESCE(?, last_soc),
        last_rated_range = COALESCE(?, last_rated_range),
        last_odometer = COALESCE(?, last_odometer),
        last_charging_state = COALESCE(?, last_charging_state),
        inside_temp = COALESCE(?, inside_temp),
        outside_temp = COALESCE(?, outside_temp),
        is_locked = COALESCE(?, is_locked),
        data_updated_at = COALESCE(?, data_updated_at),
        last_polled_at = COALESCE(?, last_polled_at),
        updated_at = ?
      WHERE vin = ?
    `);
    stmt.run(
      record.display_name ?? null,
      record.model ?? null,
      record.last_state ?? null,
      record.last_soc ?? null,
      record.last_rated_range ?? null,
      record.last_odometer ?? null,
      record.last_charging_state ?? null,
      record.inside_temp ?? null,
      record.outside_temp ?? null,
      record.is_locked !== undefined ? (record.is_locked ? 1 : 0) : null,
      record.data_updated_at ?? null,
      record.last_polled_at ?? null,
      now,
      record.vin
    );
  } else {
    const stmt = db.prepare(`
      INSERT INTO vehicles (
        vin, display_name, model, last_state, last_soc, last_rated_range,
        last_odometer, last_charging_state, inside_temp, outside_temp, is_locked,
        data_updated_at, last_polled_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.vin,
      record.display_name || 'Tesla Model 3',
      record.model || 'Model 3',
      record.last_state || 'offline',
      record.last_soc || 80,
      record.last_rated_range || 220,
      record.last_odometer || 15000,
      record.last_charging_state || 'Disconnected',
      record.inside_temp || 20,
      record.outside_temp || 15,
      record.is_locked !== undefined ? (record.is_locked ? 1 : 0) : 1,
      record.data_updated_at || now,
      record.last_polled_at || now,
      now
    );
  }
}

export function saveTokens(tokens: { accessToken: string; refreshToken: string; expiresIn?: number; clientId?: string }): void {
  const db = getDb();
  db.exec('DELETE FROM tokens');
  const now = Date.now();
  const expiresAt = now + (tokens.expiresIn || 28800) * 1000;
  const stmt = db.prepare(`
    INSERT INTO tokens (client_id, access_token, refresh_token, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(tokens.clientId || null, tokens.accessToken, tokens.refreshToken, expiresAt, now);
}

export function getTokens(): TokenRecord | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM tokens ORDER BY id DESC LIMIT 1');
  const row = stmt.get();
  return (row as unknown as TokenRecord) || null;
}

export function clearTokens(): void {
  const db = getDb();
  db.exec('DELETE FROM tokens');
}

export function clearAllData(vin?: string): void {
  const db = getDb();
  if (vin && vin !== 'undefined' && vin !== 'null') {
    const isDefault = vin === 'veh_default' || vin === 'default_car';
    if (isDefault) {
      db.exec("DELETE FROM battery_snapshots WHERE vin = 'veh_default' OR vin = 'default_car' OR vin IS NULL");
    } else {
      const stmt1 = db.prepare('DELETE FROM battery_snapshots WHERE vin = ?');
      stmt1.run(vin);
      const stmt2 = db.prepare('DELETE FROM vehicles WHERE vin = ?');
      stmt2.run(vin);
    }
  } else {
    db.exec('DELETE FROM battery_snapshots');
    db.exec('DELETE FROM vehicles');
  }
}

export function seedSampleSnapshotsIfEmpty(vin: string = '5YJ3E1EB8LF892301', nominalCapacityKwh: number = 75.0): void {
  const count = getSnapshotCount(vin);
  if (count > 0) return;

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  for (let i = 180; i >= 0; i -= 10) {
    const timestamp = now - i * dayMs;
    const odometer_miles = 25000 - i * 35;
    const degradation_pct = 3.5 + (180 - i) * 0.012 + (Math.random() * 0.4 - 0.2);
    const calculated_capacity_kwh = nominalCapacityKwh * (1 - degradation_pct / 100);
    const battery_level_pct = 75 + Math.round(Math.random() * 20);
    const rated_range_miles = (calculated_capacity_kwh / nominalCapacityKwh) * 310 * (battery_level_pct / 100);

    insertSnapshot({
      vin,
      timestamp,
      odometer_miles,
      battery_level_pct,
      rated_range_miles: parseFloat(rated_range_miles.toFixed(1)),
      calculated_capacity_kwh: parseFloat(calculated_capacity_kwh.toFixed(2)),
      degradation_pct: parseFloat(degradation_pct.toFixed(2)),
      is_fast_charging: i % 30 === 0 ? 1 : 0,
      charger_power_kw: i % 30 === 0 ? 150 : 7.4,
      trigger_reason: 'scheduled_seed',
    });
  }
}
