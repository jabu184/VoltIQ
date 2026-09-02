import { Platform } from 'react-native';
import { BatterySnapshot } from './db';

const CLOUD_BACKEND_URL = 'http://145.241.192.121:3001';

function getDefaultServerUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    const origin = window.location.origin;
    if (origin && origin !== 'null' && !origin.includes('localhost') && !origin.includes('127.0.0.1')) {
      return origin;
    }
  }
  return CLOUD_BACKEND_URL;
}

const DEFAULT_SERVER_URL = getDefaultServerUrl();

let activeServerUrl = DEFAULT_SERVER_URL;

export function getServerUrl(): string {
  return activeServerUrl;
}

export function setServerUrl(url: string): void {
  activeServerUrl = url.replace(/\/+$/, '');
}

export interface ServerHealth {
  status: string;
  version: string;
  uptimeSeconds: number;
  isConfigured: boolean;
  snapshotCount: number;
}

export interface ServerVehicleResponse {
  vehicle: {
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
    is_locked?: boolean;
    data_updated_at?: number;
    last_polled_at?: number;
    updated_at?: number;
  };
  latestSnapshot: BatterySnapshot | null;
  isFleetConfigured: boolean;
  isAccountLinked: boolean;
}

export async function checkServerHealth(): Promise<ServerHealth | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${activeServerUrl}/api/health`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchServerVehicle(): Promise<ServerVehicleResponse | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${activeServerUrl}/api/vehicle`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchServerSnapshots(limit: number = 5000, vin?: string): Promise<BatterySnapshot[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const url = vin
      ? `${activeServerUrl}/api/snapshots?limit=${limit}&vin=${encodeURIComponent(vin)}`
      : `${activeServerUrl}/api/snapshots?limit=${limit}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return [];
    const data = await res.json();
    return data.snapshots || [];
  } catch {
    return [];
  }
}

export async function updateServerSnapshot(id: number, updates: Partial<BatterySnapshot>): Promise<boolean> {
  try {
    const res = await fetch(`${activeServerUrl}/api/snapshots/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ id, ...updates }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteServerSnapshot(id: number): Promise<boolean> {
  try {
    const res = await fetch(`${activeServerUrl}/api/snapshots/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ id }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function triggerServerSync(): Promise<{ success: boolean; message: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${activeServerUrl}/api/sync`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, message: err.error || `Server responded with ${res.status}` };
    }
    const data = await res.json();
    return {
      success: true,
      message: data.message || `Telemetry synced! Vehicle is ${data.state || 'active'}.`,
    };
  } catch {
    return { success: false, message: 'Could not connect to backend server.' };
  }
}

export async function clearServerDatabase(vin?: string): Promise<boolean> {
  try {
    const res = await fetch(`${activeServerUrl}/api/db/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ vin }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function disconnectServerTeslaAccount(): Promise<boolean> {
  try {
    const res = await fetch(`${activeServerUrl}/api/auth/disconnect`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    return res.ok;
  } catch {
    return false;
  }
}
