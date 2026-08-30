import { Platform } from 'react-native';
import { BatterySnapshot } from './db';

const CLOUD_TUNNEL_BACKEND = 'http://145.241.192.121:3001';

function getDefaultServerUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  // On local web browser, connect directly to local port 3001
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:3001';
    }
  }
  // On physical iOS/Android devices (Expo Go) or remote web, use the secure cloud tunnel
  return CLOUD_TUNNEL_BACKEND;
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
    const res = await fetch(`${activeServerUrl}/api/health`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchServerVehicle(): Promise<ServerVehicleResponse | null> {
  try {
    const res = await fetch(`${activeServerUrl}/api/vehicle`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchServerSnapshots(limit: number = 5000): Promise<BatterySnapshot[]> {
  try {
    const res = await fetch(`${activeServerUrl}/api/snapshots?limit=${limit}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.snapshots || [];
  } catch {
    return [];
  }
}

export async function triggerServerSync(): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(`${activeServerUrl}/api/sync`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const err = await res.json();
      return { success: false, message: err.message || err.error || 'Server sync failed' };
    }
    return await res.json();
  } catch (err: any) {
    return { success: false, message: err.message || 'Could not connect to server' };
  }
}

export async function getServerAuthUrl(): Promise<string | null> {
  try {
    const res = await fetch(`${activeServerUrl}/api/auth/url`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.authUrl || null;
  } catch {
    return null;
  }
}

export async function clearServerDatabase(): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(`${activeServerUrl}/api/db/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      return { success: false, message: 'Server failed to clear database.' };
    }
    return await res.json();
  } catch (err: any) {
    return { success: false, message: err?.message || 'Could not connect to server.' };
  }
}

export async function disconnectServerTeslaAccount(): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(`${activeServerUrl}/api/auth/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      return { success: false, message: 'Server failed to disconnect Tesla account.' };
    }
    return await res.json();
  } catch (err: any) {
    return { success: false, message: err?.message || 'Could not connect to server.' };
  }
}
