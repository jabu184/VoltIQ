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
  insideTempC: number;
  outsideTempC: number;
  vehicleName: string;
  vin: string;
  isLocked?: boolean;
  isOnline?: boolean;
  vehicleState?: string;
}

// In-memory fallback for web or environments where SecureStore is unavailable
const memoryStorage: Record<string, string> = {};

async function secureSave(key: string, value: string): Promise<void> {
  try {
    if (isWeb) {
      memoryStorage[key] = value;
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
      delete memoryStorage[key];
      return;
    }
    await SecureStore.deleteItemAsync(key);
  } catch {
    delete memoryStorage[key];
  }
}

export async function saveTeslaRefreshToken(token: string, accessToken?: string): Promise<void> {
  const cleanToken = token.trim();
  await secureSave(SECURE_STORE_KEY_REFRESH_TOKEN, cleanToken);

  // Sync token to VoltIQ Backend Server so smart poller and server API are updated
  try {
    const serverUrl = getServerUrl();
    await fetch(`${serverUrl}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: cleanToken,
        accessToken: accessToken || '',
      }),
    });
  } catch (err) {
    console.warn('Failed to sync token to backend server:', err);
  }
}

export async function getTeslaRefreshToken(): Promise<string | null> {
  return await secureGet(SECURE_STORE_KEY_REFRESH_TOKEN);
}

export async function clearTeslaCredentials(): Promise<void> {
  await secureDelete(SECURE_STORE_KEY_REFRESH_TOKEN);
  await secureDelete(SECURE_STORE_KEY_ACCESS_TOKEN);
  await secureDelete(SECURE_STORE_KEY_VEHICLE_VIN);
}

export * from './pkce';
import {
  DEFAULT_TESLA_CLIENT_ID,
  DEFAULT_TESLA_REDIRECT_URI,
} from './pkce';

/**
 * Exchanges the PKCE authorization code for live Tesla access and refresh tokens
 */
export async function exchangeAuthCodeForTokens(
  code: string,
  codeVerifier: string,
  clientId: string = DEFAULT_TESLA_CLIENT_ID,
  redirectUri: string = DEFAULT_TESLA_REDIRECT_URI
): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await fetch('https://auth.tesla.com/oauth2/v3/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tesla token exchange failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  if (data.refresh_token && data.access_token) {
    await saveTeslaRefreshToken(data.refresh_token, data.access_token);
    await secureSave(SECURE_STORE_KEY_ACCESS_TOKEN, data.access_token);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
    };
  }

  throw new Error('Tesla authentication response was missing token fields.');
}

/**
 * Exchanges a Tesla refresh token for a fresh access token
 */
export async function refreshTeslaAccessToken(refreshToken: string): Promise<string> {
  try {
    const response = await fetch('https://auth.tesla.com/oauth2/v3/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: DEFAULT_TESLA_CLIENT_ID,
        refresh_token: refreshToken,
        scope: 'openid email offline_access vehicle_device_data vehicle_cmds',
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.access_token) {
      await secureSave(SECURE_STORE_KEY_ACCESS_TOKEN, data.access_token);
      return data.access_token;
    }
    throw new Error('No access_token returned by auth endpoint');
  } catch (err) {
    console.warn('Tesla auth token refresh warning:', err);
    return 'demo_access_token';
  }
}

/**
 * Fetches real-time telemetry from the vehicle
 * If no live credentials or connection, generates a simulated real-time reading.
 */
export async function fetchVehicleTelemetry(
  isDemoMode: boolean = false,
  nominalCapacityKwh: number = 75.0
): Promise<TeslaTelemetry> {
  const refreshToken = await getTeslaRefreshToken();

  if (!isDemoMode && refreshToken && refreshToken.length > 20) {
    try {
      const accessToken = await refreshTeslaAccessToken(refreshToken);
      const vehicleListRes = await fetch(
        'https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/vehicles',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (vehicleListRes.ok) {
        const vehicles = await vehicleListRes.json();
        const firstCar = vehicles.response?.[0];
        if (firstCar && firstCar.id) {
          const dataRes = await fetch(
            `https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/vehicles/${firstCar.id}/vehicle_data`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            }
          );
          if (dataRes.ok) {
            const carData = await dataRes.json();
            const charge = carData.response.charge_state;
            const state = carData.response.vehicle_state;
            const climate = carData.response.climate_state;

            return {
              timestamp: Date.now(),
              odometerMiles: state.odometer || 0,
              batteryLevelPct: charge.battery_level,
              usableBatteryLevelPct: charge.usable_battery_level || charge.battery_level,
              ratedRangeMiles: charge.battery_range,
              isFastCharging: charge.fast_charger_present || charge.charger_power > 25,
              chargerPowerKw: charge.charger_power || 0,
              chargerVoltage: charge.charger_voltage || 0,
              chargerActualCurrent: charge.charger_actual_current || 0,
              batteryHeaterOn: charge.battery_heater_on || false,
              insideTempC: climate.inside_temp || 20,
              outsideTempC: climate.outside_temp || 15,
              vehicleName: firstCar.display_name || 'Tesla Model 3',
              vin: firstCar.vin || '5YJ3E1EB8LF123456',
              isLocked: state?.locked !== undefined ? state.locked : true,
            };
          }
        }
      }
    } catch (apiError) {
      console.warn('Live Tesla API fetch error, falling back to simulated telemetry:', apiError);
    }
  }

  // Realistic simulated telemetry
  const baseRangeAtFull = (nominalCapacityKwh * 0.954) / 0.24; // ~4.6% degraded
  const currentSoc = 82;
  const currentRange = baseRangeAtFull * (currentSoc / 100);

  return {
    timestamp: Date.now(),
    odometerMiles: 24819.4,
    batteryLevelPct: currentSoc,
    usableBatteryLevelPct: currentSoc - 1,
    ratedRangeMiles: Math.round(currentRange * 10) / 10,
    isFastCharging: false,
    chargerPowerKw: 0,
    chargerVoltage: 0,
    chargerActualCurrent: 0,
    batteryHeaterOn: false,
    insideTempC: 19.5,
    outsideTempC: 16.0,
    vehicleName: 'VoltIQ Model 3',
    vin: '5YJ3E1EB8LF892301',
    isLocked: true,
  };
}
