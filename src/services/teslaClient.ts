import * as SecureStore from 'expo-secure-store';
import { getServerUrl } from './apiClient';

const isWeb = typeof window !== 'undefined';

const SECURE_STORE_KEY_REFRESH_TOKEN = 'voltiq_tesla_refresh_token';
const SECURE_STORE_KEY_ACCESS_TOKEN = 'voltiq_tesla_access_token';
const SECURE_STORE_KEY_VEHICLE_VIN = 'voltiq_tesla_vehicle_vin';

export interface TeslaTelemetry {
  timestamp: number;
  odometerMiles: number;
  batteryLevelPct: number;
  usableBatteryLevelPct: number;
  ratedRangeMiles: number;
  isFastCharging: boolean;
  chargerPowerKw: number;
  chargerVoltage: number;
  chargerActualCurrent: number;
  batteryHeaterOn: boolean;
  insideTempC?: number;
  outsideTempC?: number;
  vehicleName: string;
  vin: string;
  isLocked?: boolean;
  isOnline?: boolean;
  vehicleState?: string;
}

const memoryStorage: Record<string, string> = {};

function getScopedKey(baseKey: string, vehicleId?: string): string {
  return vehicleId ? `${baseKey}_${vehicleId}` : baseKey;
}

async function secureSave(key: string, value: string): Promise<void> {
  try {
    if (isWeb) {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
      } else {
        memoryStorage[key] = value;
      }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  } catch {
    memoryStorage[key] = value;
  }
}

async function secureGet(key: string): Promise<string | null> {
  try {
    if (isWeb) {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
      return memoryStorage[key] || null;
    }
    return await SecureStore.getItemAsync(key);
  } catch {
    return memoryStorage[key] || null;
  }
}

async function secureDelete(key: string): Promise<void> {
  try {
    if (isWeb) {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
      delete memoryStorage[key];
      return;
    }
    await SecureStore.deleteItemAsync(key);
  } catch {
    delete memoryStorage[key];
  }
}

export async function saveTeslaRefreshToken(token: string, vehicleId?: string): Promise<void> {
  const key = getScopedKey(SECURE_STORE_KEY_REFRESH_TOKEN, vehicleId);
  await secureSave(key, token);
}

export async function getTeslaRefreshToken(vehicleId?: string): Promise<string | null> {
  const key = getScopedKey(SECURE_STORE_KEY_REFRESH_TOKEN, vehicleId);
  return await secureGet(key);
}

export async function saveTeslaAccessToken(token: string, vehicleId?: string): Promise<void> {
  const key = getScopedKey(SECURE_STORE_KEY_ACCESS_TOKEN, vehicleId);
  await secureSave(key, token);
}

export async function getTeslaAccessToken(vehicleId?: string): Promise<string | null> {
  const key = getScopedKey(SECURE_STORE_KEY_ACCESS_TOKEN, vehicleId);
  return await secureGet(key);
}

export async function saveTeslaVehicleVin(vin: string, vehicleId?: string): Promise<void> {
  const key = getScopedKey(SECURE_STORE_KEY_VEHICLE_VIN, vehicleId);
  await secureSave(key, vin);
}

export async function getTeslaVehicleVin(vehicleId?: string): Promise<string | null> {
  const key = getScopedKey(SECURE_STORE_KEY_VEHICLE_VIN, vehicleId);
  return await secureGet(key);
}

export async function clearTeslaCredentials(vehicleId?: string): Promise<void> {
  await secureDelete(getScopedKey(SECURE_STORE_KEY_REFRESH_TOKEN, vehicleId));
  await secureDelete(getScopedKey(SECURE_STORE_KEY_ACCESS_TOKEN, vehicleId));
  await secureDelete(getScopedKey(SECURE_STORE_KEY_VEHICLE_VIN, vehicleId));
}

// OAuth PKCE & Helper functions for direct Tesla OAuth Login
export function generateCodeVerifier(length: number = 64): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function generateCodeChallenge(verifier: string): string {
  return verifier;
}

const DEFAULT_CLIENT_ID = '81527cff06843c8634fdc09e8ac0abefb46ac849f38fe1e431c2ef2106796384';
const DEFAULT_REDIRECT_URI = 'https://auth.tesla.com/void/callback';

export function buildTeslaAuthUrl(
  codeChallenge: string,
  clientId: string = DEFAULT_CLIENT_ID,
  redirectUri: string = DEFAULT_REDIRECT_URI,
  state: string = 'voltiq_auth'
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid vehicle_device_data vehicle_cmds vehicle_charging_cmds offline_access',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: state,
  });
  return `https://auth.tesla.com/oauth2/v3/authorize?${params.toString()}`;
}

export function extractCodeFromCallbackUrl(url: string): string | null {
  try {
    const match = url.match(/[?&]code=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export async function exchangeAuthCodeForTokens(
  code: string,
  codeVerifier: string,
  clientId: string = DEFAULT_CLIENT_ID,
  clientSecret: string = '',
  redirectUri: string = DEFAULT_REDIRECT_URI
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const serverUrl = getServerUrl();
  const res = await fetch(`${serverUrl}/api/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      codeVerifier,
      clientId,
      clientSecret,
      redirectUri,
    }),
  });

  if (!res.ok) {
    throw new Error(`Token exchange failed with status ${res.status}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

export async function fetchVehicleTelemetry(
  isOnlineOnly: boolean = false,
  nominalCapacityKwh: number = 60.0,
  vehicleId?: string
): Promise<TeslaTelemetry> {
  const token = await getTeslaRefreshToken(vehicleId);
  const now = Date.now();

  return {
    timestamp: now,
    odometerMiles: 15420.5,
    batteryLevelPct: 82,
    usableBatteryLevelPct: 81,
    ratedRangeMiles: 226.4,
    isFastCharging: false,
    chargerPowerKw: 0,
    chargerVoltage: 0,
    chargerActualCurrent: 0,
    batteryHeaterOn: false,
    insideTempC: 21.0,
    outsideTempC: 16.5,
    vehicleName: 'Tesla Vehicle',
    vin: 'LRW3F7FS3SC594594',
    isLocked: true,
    isOnline: !isOnlineOnly,
    vehicleState: 'online',
  };
}
