import { getTokens, saveTokens, upsertVehicle, insertSnapshot } from './db';

export interface FleetConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  audienceUrl?: string; // Default to North America / Global Fleet API
}

export interface TelemetryReading {
  vin: string;
  timestamp: number;
  odometerMiles: number;
  batteryLevelPct: number;
  ratedRangeMiles: number;
  calculatedCapacityKwh: number;
  degradationPct: number;
  chargingState: string;
  isFastCharging: boolean;
  chargerPowerKw: number;
  vehicleState: string;
  insideTempC?: number;
  outsideTempC?: number;
  isLocked?: boolean;
}

const DEFAULT_AUDIENCE = 'https://fleet-api.prd.na.vn.cloud.tesla.com';

export class TeslaFleetService {
  private config: FleetConfig;

  constructor(config?: Partial<FleetConfig>) {
    this.config = {
      clientId: config?.clientId || process.env.TESLA_CLIENT_ID || '',
      clientSecret: config?.clientSecret || process.env.TESLA_CLIENT_SECRET || '',
      redirectUri: config?.redirectUri || process.env.TESLA_REDIRECT_URI || 'http://localhost:3001/api/auth/callback',
      audienceUrl: config?.audienceUrl || process.env.TESLA_AUDIENCE || DEFAULT_AUDIENCE,
    };
  }

  public updateConfig(newConfig: Partial<FleetConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public isConfigured(): boolean {
    return !!(this.config.clientId && this.config.clientSecret);
  }

  public getAudienceUrl(): string {
    const tokens = getTokens();
    if (tokens?.refresh_token?.startsWith('EU_')) {
      return 'https://fleet-api.prd.eu.vn.cloud.tesla.com';
    }
    if (tokens?.refresh_token?.startsWith('CN_')) {
      return 'https://fleet-api.prd.cn.vn.cloud.tesla.cn';
    }
    return process.env.TESLA_AUDIENCE || this.config.audienceUrl || 'https://fleet-api.prd.eu.vn.cloud.tesla.com';
  }

  /**
   * Builds the official Tesla Fleet OAuth URL
   */
  public generateAuthUrl(state: string = 'voltiq_fleet_auth'): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: 'openid offline_access vehicle_device_data vehicle_cmds',
      state,
    });
    return `https://auth.tesla.com/oauth2/v3/authorize?${params.toString()}`;
  }

  /**
   * Exchanges an authorization code for live Fleet access and refresh tokens
   */
  public async exchangeCodeForTokens(code: string): Promise<{ accessToken: string; refreshToken: string }> {
    const response = await fetch('https://auth.tesla.com/oauth2/v3/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
      }).toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Tesla token exchange failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    saveTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      clientId: this.config.clientId,
    });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
    };
  }

  /**
   * Refreshes the Fleet access token using the stored refresh token
   */
  public async refreshAccessToken(): Promise<string> {
    const currentTokens = getTokens();
    if (!currentTokens?.refresh_token) {
      throw new Error('No refresh token stored on server.');
    }

    const response = await fetch('https://auth.tesla.com/oauth2/v3/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: currentTokens.refresh_token,
      }).toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Token refresh failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    saveTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      clientId: this.config.clientId,
    });

    return data.access_token;
  }

  /**
   * Retrieves a valid access token, automatically refreshing if close to expiry
   */
  public async getValidAccessToken(): Promise<string> {
    const tokens = getTokens();
    if (!tokens) {
      throw new Error('No Tesla tokens available.');
    }

    // If expires in less than 5 minutes, refresh
    if (Date.now() > tokens.expires_at - 300000) {
      return await this.refreshAccessToken();
    }
    return tokens.access_token;
  }

  /**
   * Sleep-safe vehicle status check
   * Checks vehicle state without sending any wake command.
   */
  public async checkVehicleStatus(): Promise<{
    isOnline: boolean;
    state: string;
    vin: string;
    vehicleId?: string;
    displayName?: string;
  }> {
    if (!this.isConfigured() || !getTokens()) {
      // Return simulated status if not configured
      return {
        isOnline: true,
        state: 'online',
        vin: '5YJ3E1EB8LF892301',
        vehicleId: 'simulated_vehicle_1',
        displayName: 'VoltWise Model 3',
      };
    }

    const accessToken = await this.getValidAccessToken();
    const response = await fetch(`${this.getAudienceUrl()}/api/1/vehicles`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errBody = await response.text();
      let msg = `Tesla Fleet API (${response.status})`;
      try {
        const parsed = JSON.parse(errBody);
        if (parsed.error) msg += `: ${parsed.error}`;
      } catch {
        msg += `: ${errBody}`;
      }
      throw new Error(msg);
    }

    const json = await response.json();
    const car = json.response?.[0];

    if (!car) {
      throw new Error('No vehicles found in your Tesla account.');
    }

    return {
      isOnline: car.state === 'online',
      state: car.state || 'asleep',
      vin: car.vin,
      vehicleId: String(car.id),
      displayName: car.display_name || 'Tesla Model 3',
    };
  }

  /**
   * Fetches full telemetry only if vehicle is online
   */
  public async fetchTelemetryIfOnline(
    vehicleId: string,
    vin: string,
    nominalKwh: number = 75.0,
    whPerMile: number = 240
  ): Promise<TelemetryReading | null> {
    if (!this.isConfigured() || !getTokens()) {
      // Simulated telemetry
      const odo = 24820;
      const soc = 82;
      const nominal = 75.0;
      const usable = (246 * whPerMile / 1000) / (soc / 100);
      const deg = Math.round(((nominal - usable) / nominal) * 1000) / 10;

      return {
        vin,
        timestamp: Date.now(),
        odometerMiles: odo,
        batteryLevelPct: soc,
        ratedRangeMiles: 246,
        calculatedCapacityKwh: Math.round(usable * 10) / 10,
        degradationPct: deg,
        chargingState: 'Complete',
        isFastCharging: false,
        chargerPowerKw: 0,
        vehicleState: 'online',
      };
    }

    const accessToken = await this.getValidAccessToken();
    const response = await fetch(
      `${this.getAudienceUrl()}/api/1/vehicles/${vehicleId}/vehicle_data`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const res = data.response;
    const charge = res.charge_state;
    const state = res.vehicle_state;

    const batteryLevel = charge.battery_level;
    const ratedRange = charge.battery_range;
    const odo = state.odometer || 0;

    const config = res.vehicle_config;
    let effectiveNominal = nominalKwh;
    let effectiveWhPerMile = whPerMile;

    // Auto-detect battery pack from Tesla vehicle_config
    if (config?.car_type === 'model3') {
      if (config.trim_badging === '50' || config.default_charge_to_max) {
        // Model 3 RWD / Highland CATL LFP pack
        effectiveNominal = 62.5;
        effectiveWhPerMile = 221.9;
      } else if (config.trim_badging === '74' || config.trim_badging === 'longrange') {
        effectiveNominal = 78.1;
        effectiveWhPerMile = 235;
      }
    } else if (config?.car_type === 'modely') {
      if (config.default_charge_to_max) {
        effectiveNominal = 60.0;
        effectiveWhPerMile = 250;
      } else {
        effectiveNominal = 75.0;
        effectiveWhPerMile = 265;
      }
    }

    // Calculate real usable battery capacity
    // Usable kWh = (Rated Range * Wh/mi / 1000) / (SoC / 100)
    const socFraction = Math.max(0.01, batteryLevel / 100);
    const usableCapacity = (ratedRange * effectiveWhPerMile) / 1000 / socFraction;
    const roundedCapacity = Math.round(usableCapacity * 10) / 10;
    const degradation = Math.max(0, Math.round(((effectiveNominal - roundedCapacity) / effectiveNominal) * 1000) / 10);

    const isFast = charge.fast_charger_present || charge.charger_power > 25;
    const climate = res.climate_state;
    const insideTemp = typeof climate?.inside_temp === 'number' ? Math.round(climate.inside_temp * 10) / 10 : undefined;
    const outsideTemp = typeof climate?.outside_temp === 'number' ? Math.round(climate.outside_temp * 10) / 10 : undefined;
    const isLocked = state?.locked !== undefined ? state.locked : true;

    const dataTimestamp = charge?.timestamp || state?.timestamp || Date.now();

    return {
      vin: res.vin || vin,
      timestamp: dataTimestamp,
      odometerMiles: odo,
      batteryLevelPct: batteryLevel,
      ratedRangeMiles: Math.round(ratedRange * 10) / 10,
      calculatedCapacityKwh: roundedCapacity,
      degradationPct: degradation,
      chargingState: charge.charging_state || 'Disconnected',
      isFastCharging: isFast,
      chargerPowerKw: charge.charger_power || 0,
      vehicleState: 'online',
      insideTempC: insideTemp,
      outsideTempC: outsideTemp,
      isLocked,
    };
  }
}
