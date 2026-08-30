try {
  process.loadEnvFile();
} catch {}

import * as http from 'node:http';
import * as url from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { getDb, getAllSnapshots, getVehicle, upsertVehicle, saveTokens, insertSnapshot, seedSampleSnapshotsIfEmpty, getSnapshotCount, getTokens, clearAllData, clearTokens } from './db';
import { TeslaFleetService } from './teslaFleetService';
import { SmartPoller } from './poller';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

// Ensure EC public/private key pair exists for Tesla Partner Registration
const KEY_DIR = path.join(process.cwd(), 'server');
const PUB_KEY_PATH = path.join(KEY_DIR, 'public-key.pem');
const PRIV_KEY_PATH = path.join(KEY_DIR, 'private-key.pem');

let publicKeyPem = '';
if (fs.existsSync(PUB_KEY_PATH)) {
  publicKeyPem = fs.readFileSync(PUB_KEY_PATH, 'utf-8');
} else {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  publicKeyPem = publicKey;
  fs.writeFileSync(PUB_KEY_PATH, publicKey);
  fs.writeFileSync(PRIV_KEY_PATH, privateKey);
}

// Initialize DB
getDb();

// Initialize Fleet API service and Smart Poller
const fleetService = new TeslaFleetService();
const poller = new SmartPoller(fleetService, 15); // poll check every 15 min
poller.start();

function sendJson(res: http.ServerResponse, statusCode: number, data: any): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url || '', true);
  const pathname = parsedUrl.pathname || '';

  try {
    // 0. Tesla Partner Public Key verification endpoint
    if (
      pathname === '/.well-known/appspecific/com.tesla.3p.public-key.pem' ||
      pathname === '/.well-known/appspecific/com.tesla.3p.public-key'
    ) {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(publicKeyPem);
      return;
    }

    // Partner Registration endpoint
    if (pathname === '/api/partner/register' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const domain = body.domain || process.env.TESLA_DOMAIN || 'sweet-gifts-drive.loca.lt';

      const tokenRes = await fetch('https://auth.tesla.com/oauth2/v3/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: process.env.TESLA_CLIENT_ID || '',
          client_secret: process.env.TESLA_CLIENT_SECRET || '',
          scope: 'openid vehicle_device_data',
        }).toString(),
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        return sendJson(res, 400, { error: 'Failed to get partner token', details: tokenData });
      }

      const regRes = await fetch('https://fleet-api.prd.eu.vn.cloud.tesla.com/api/1/partner_accounts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ domain }),
      });
      const regData = await regRes.json();
      return sendJson(res, regRes.status, regData);
    }

    // 1. Health check
    if ((pathname === '/api/health' || pathname === '/health') && req.method === 'GET') {
      return sendJson(res, 200, {
        status: 'ok',
        version: '1.0.0',
        uptimeSeconds: Math.floor(process.uptime()),
        isConfigured: fleetService.isConfigured(),
        snapshotCount: getSnapshotCount(),
      });
    }

    // 2. Tesla Fleet OAuth URL
    if (pathname === '/api/auth/url' && req.method === 'GET') {
      const authUrl = fleetService.generateAuthUrl();
      return sendJson(res, 200, {
        authUrl,
        isConfigured: fleetService.isConfigured(),
      });
    }

    // 3. OAuth Callback handler
    if (pathname === '/api/auth/callback' && req.method === 'GET') {
      const code = parsedUrl.query.code as string;
      if (!code) {
        return sendJson(res, 400, { error: 'Missing authorization code in query parameters.' });
      }

      await fleetService.exchangeCodeForTokens(code);
      // Trigger an immediate initial vehicle sync
      await poller.forceSync();

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; text-align: center; padding: 40px;">
            <h1 style="color: #10b981;">⚡ Tesla Account Connected!</h1>
            <p>Your vehicle is now linked to VoltIQ. You can return to the app.</p>
          </body>
        </html>
      `);
      return;
    }

    // 3b. Save Tesla Token from Mobile App
    if ((pathname === '/api/token' || pathname === '/api/auth/token') && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const refreshToken = body.refreshToken || body.refresh_token || body.token;
      const accessToken = body.accessToken || body.access_token || '';

      if (!refreshToken) {
        return sendJson(res, 400, { error: 'Missing refresh token.' });
      }

      saveTokens({
        accessToken: accessToken,
        refreshToken: refreshToken,
        expiresIn: 28800,
        clientId: process.env.TESLA_CLIENT_ID,
      });

      // Trigger an immediate initial vehicle sync
      const syncResult = await poller.forceSync();

      return sendJson(res, 200, {
        success: true,
        message: 'Token saved and initial vehicle sync triggered.',
        syncResult,
      });
    }

    // 3c. Clear Database Endpoint
    if ((pathname === '/api/db/clear' || pathname === '/api/clear') && req.method === 'POST') {
      clearAllData();
      return sendJson(res, 200, {
        success: true,
        message: 'All vehicle telemetry and historical snapshots cleared.',
      });
    }

    // 3d. Disconnect / Logout Tesla Account Endpoint
    if ((pathname === '/api/auth/disconnect' || pathname === '/api/auth/logout' || pathname === '/api/token/disconnect') && req.method === 'POST') {
      clearTokens();
      return sendJson(res, 200, {
        success: true,
        message: 'Disconnected from Tesla account and tokens cleared from server.',
      });
    }

    // 4. Vehicle status and latest telemetry (with zero-wake live status check)
    if (pathname === '/api/vehicle' && req.method === 'GET') {
      const tokens = getTokens();
      let vehicle = getVehicle();

      // Check real-time sleep-safe connection state against Tesla API
      if (fleetService.isConfigured() && tokens) {
        try {
          const status = await fleetService.checkVehicleStatus();
          if (status.vin) {
            // If vehicle is actively online/awake, automatically pull live telemetry!
            if (status.isOnline && status.state === 'online') {
              const reading = await fleetService.fetchTelemetryIfOnline(
                status.vehicleId || '0',
                status.vin,
                62.5,
                221.9
              );
              if (reading) {
                upsertVehicle({
                  vin: status.vin,
                  display_name: status.displayName,
                  last_state: 'online',
                  last_soc: reading.batteryLevelPct,
                  last_rated_range: reading.ratedRangeMiles,
                  last_odometer: reading.odometerMiles,
                  last_charging_state: reading.chargingState,
                  inside_temp: reading.insideTempC,
                  outside_temp: reading.outsideTempC,
                  is_locked: reading.isLocked !== undefined ? (reading.isLocked ? 1 : 0) : 1,
                  data_updated_at: reading.timestamp,
                  last_polled_at: Date.now(),
                });
              }
            } else {
              upsertVehicle({
                vin: status.vin,
                display_name: status.displayName,
                last_state: status.state,
                last_polled_at: Date.now(),
              });
            }
            vehicle = getVehicle(status.vin);
          }
        } catch (err: any) {
          console.warn('[Server] Sleep-safe vehicle status check error:', err.message);
        }
      }

      const latestSnapshot = getAllSnapshots(undefined, 1)[0];

      return sendJson(res, 200, {
        vehicle: vehicle || null,
        latestSnapshot: latestSnapshot || null,
        isFleetConfigured: fleetService.isConfigured(),
        isAccountLinked: !!tokens?.access_token,
      });
    }

    // 5. Retrieve all historical snapshots (for Scatter Plot & Certificate)
    if (pathname === '/api/snapshots' && req.method === 'GET') {
      const limit = parsedUrl.query.limit ? parseInt(parsedUrl.query.limit as string, 10) : 5000;
      const snapshots = getAllSnapshots(undefined, limit);
      return sendJson(res, 200, {
        count: snapshots.length,
        snapshots,
      });
    }

    // 6. Force immediate sync
    if (pathname === '/api/sync' && req.method === 'POST') {
      const result = await poller.forceSync();
      return sendJson(res, result.success ? 200 : 500, result);
    }

    // 7. Manual snapshot creation from app
    if (pathname === '/api/snapshot/manual' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      if (!body.battery_level_pct || !body.rated_range_miles) {
        return sendJson(res, 400, { error: 'Missing required battery metrics.' });
      }

      const id = insertSnapshot({
        vin: body.vin || '5YJ3E1EB8LF892301',
        timestamp: Date.now(),
        odometer_miles: body.odometer_miles || 25000,
        battery_level_pct: body.battery_level_pct,
        rated_range_miles: body.rated_range_miles,
        calculated_capacity_kwh: body.calculated_capacity_kwh || 71.8,
        degradation_pct: body.degradation_pct || 4.2,
        is_fast_charging: body.is_fast_charging ? 1 : 0,
        charger_power_kw: body.charger_power_kw || 0,
        trigger_reason: 'manual_app_entry',
      });

      return sendJson(res, 201, { success: true, id });
    }

    // 404
    return sendJson(res, 404, { error: 'Endpoint not found' });
  } catch (err: any) {
    console.error('[Server] Request error:', err);
    return sendJson(res, 500, { error: err.message || 'Internal Server Error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n=================================================`);
  console.log(`⚡ VoltIQ Backend Server running on port ${PORT}`);
  console.log(`📡 Endpoints:`);
  console.log(`   - GET  http://localhost:${PORT}/api/health`);
  console.log(`   - GET  http://localhost:${PORT}/api/vehicle`);
  console.log(`   - GET  http://localhost:${PORT}/api/snapshots`);
  console.log(`   - POST http://localhost:${PORT}/api/sync`);
  console.log(`=================================================\n`);
});

export { server, poller, fleetService };
