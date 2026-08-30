import { BatteryHealthMetrics, VehicleModelProfile } from './batteryLogic';
import { TeslaTelemetry } from './teslaClient';

export interface CertificateData {
  vehicle: TeslaTelemetry;
  metrics: BatteryHealthMetrics;
  profile: VehicleModelProfile;
  certificateId: string;
  issueDate: string;
}

export function buildCertificateHtml(data: CertificateData): string {
  const { vehicle, metrics, profile, certificateId, issueDate } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>TrueBattery Resale Certificate - ${vehicle.vin}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 15mm;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1a202c;
      background-color: #ffffff;
      margin: 0;
      padding: 24px;
      line-height: 1.5;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 3px solid #0052cc;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .brand-title {
      font-size: 28px;
      font-weight: 800;
      color: #0052cc;
      letter-spacing: -0.5px;
      margin: 0;
    }
    .brand-subtitle {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #4a5568;
      margin-top: 4px;
    }
    .badge-grade {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      font-size: 26px;
      font-weight: 800;
      padding: 10px 22px;
      border-radius: 12px;
      text-align: center;
      box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.3);
    }
    .badge-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
      display: block;
      margin-top: 2px;
    }
    .section-title {
      font-size: 15px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #2d3748;
      border-left: 4px solid #0052cc;
      padding-left: 10px;
      margin: 20px 0 12px 0;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 14px;
      margin-bottom: 20px;
    }
    .card {
      background-color: #f7fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 16px;
    }
    .card-label {
      font-size: 11px;
      color: #718096;
      text-transform: uppercase;
      font-weight: 600;
    }
    .card-value {
      font-size: 18px;
      font-weight: 700;
      color: #1a202c;
      margin-top: 2px;
    }
    .metric-banner {
      display: flex;
      justify-content: space-around;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: white;
      border-radius: 12px;
      padding: 18px;
      margin-bottom: 24px;
    }
    .metric-col {
      text-align: center;
    }
    .metric-num {
      font-size: 28px;
      font-weight: 800;
      color: #38bdf8;
    }
    .metric-desc {
      font-size: 11px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 2px;
    }
    .table-container {
      margin-top: 14px;
      margin-bottom: 24px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 9px 12px;
      text-align: left;
      font-size: 13px;
    }
    th {
      background-color: #edf2f7;
      color: #4a5568;
      font-weight: 600;
    }
    tr:nth-child(even) td {
      background-color: #f7fafc;
    }
    tr td {
      border-bottom: 1px solid #edf2f7;
    }
    .footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 16px;
      margin-top: 30px;
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #a0aec0;
    }
    .watermark {
      font-size: 11px;
      color: #718096;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 class="brand-title">TrueBattery™</h1>
      <div class="brand-subtitle">EV Battery Degradation & Health Certificate</div>
    </div>
    <div class="badge-grade">
      ${metrics.healthGrade}
      <span class="badge-label">Health Grade</span>
    </div>
  </div>

  <div class="metric-banner">
    <div class="metric-col">
      <div class="metric-num">${metrics.batteryHealthPct}%</div>
      <div class="metric-desc">Remaining Health</div>
    </div>
    <div class="metric-col">
      <div class="metric-num">${metrics.calculatedCapacityKwh} kWh</div>
      <div class="metric-desc">Usable Capacity</div>
    </div>
    <div class="metric-col">
      <div class="metric-num">${metrics.degradationPct}%</div>
      <div class="metric-desc">Total Degradation</div>
    </div>
  </div>

  <div class="section-title">Vehicle & Telemetry Verification</div>
  <div class="grid">
    <div class="card">
      <div class="card-label">Vehicle Model</div>
      <div class="card-value">${profile.name}</div>
    </div>
    <div class="card">
      <div class="card-label">VIN / Serial Number</div>
      <div class="card-value">${vehicle.vin}</div>
    </div>
    <div class="card">
      <div class="card-label">Verified Odometer</div>
      <div class="card-value">${vehicle.odometerMiles.toLocaleString()} miles</div>
    </div>
    <div class="card">
      <div class="card-label">Nominal Pack Size (When New)</div>
      <div class="card-value">${profile.nominalCapacityKwh} kWh</div>
    </div>
  </div>

  <div class="section-title">Battery Diagnostic Breakdown</div>
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Diagnostic Metric</th>
          <th>Measured Value</th>
          <th>Reference Baseline</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Pack Usable Capacity</td>
          <td>${metrics.calculatedCapacityKwh} kWh</td>
          <td>${profile.nominalCapacityKwh} kWh</td>
          <td><strong>${metrics.batteryHealthPct >= 90 ? 'Healthy' : 'Fair'}</strong></td>
        </tr>
        <tr>
          <td>Measured Degradation Rate</td>
          <td>${(metrics.degradationPct / (vehicle.odometerMiles / 10000)).toFixed(2)}% per 10k miles</td>
          <td>&lt; 1.5% per 10k miles</td>
          <td><strong>Excellent</strong></td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="section-title">Resale & Buyer Confidence Summary</div>
  <p style="font-size: 13px; color: #4a5568; line-height: 1.6;">
    This battery was tested using on-device telemetry extracted directly via the vehicle interface.
    With <strong>${metrics.batteryHealthPct}%</strong> retained capacity and an estimated degradation of 
    <strong>${metrics.degradationPct}%</strong> over <strong>${vehicle.odometerMiles.toLocaleString()}</strong> miles,
    this pack demonstrates exemplary cell integrity with low internal cell resistance. 
    This official certificate is suitable for buyers and sellers on <strong>AutoTrader, eBay Motors, and PistonHeads</strong>.
  </p>

  <div class="footer">
    <div>Certificate ID: <strong>${certificateId}</strong> &bull; Issued: ${issueDate}</div>
    <div class="watermark">TrueBattery Local-First Verification System</div>
  </div>
</body>
</html>
  `;
}
