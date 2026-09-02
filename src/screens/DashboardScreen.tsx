import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import {
  fetchVehicleTelemetry,
  TeslaTelemetry,
  getTeslaRefreshToken,
} from '../services/teslaClient';
import {
  calculateBatteryCapacity,
  evaluateBatteryHealth,
  BatteryHealthMetrics,
} from '../services/batteryLogic';
import {
  insertSnapshot,
  getSnapshots,
  BatterySnapshot,
} from '../services/db';
import {
  fetchServerVehicle,
  fetchServerSnapshots,
  triggerServerSync,
  checkServerHealth,
  getServerUrl,
} from '../services/apiClient';
import { TeslaLoginModal } from '../components/TeslaLoginModal';
import { ManualLogModal } from '../components/ManualLogModal';
import { useVehicleProfile } from '../context/VehicleProfileContext';
import { useUnit } from '../context/UnitContext';
import { usePremium } from '../context/PremiumContext';
import { useFocusEffect } from 'expo-router';
import { FooterVersion } from '../components/FooterVersion';
import { HeaderStatusBadges } from '../components/HeaderStatusBadges';

export const DashboardScreen: React.FC = () => {
  const { activeVehicle, selectedProfile, isManualMode, updateManualTelemetry } = useVehicleProfile();
  const { isPremium } = usePremium();
  const {
    unit,
    unitLabel,
    unitLongLabel,
    toDisplayDistance,
    fromInputDistance,
    formatDistance,
    formatEfficiency,
  } = useUnit();

  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [telemetry, setTelemetry] = useState<TeslaTelemetry | null>(null);
  const [snapshots, setSnapshots] = useState<BatterySnapshot[]>([]);
  const [metrics, setMetrics] = useState<BatteryHealthMetrics | null>(null);
  const [hasToken, setHasToken] = useState<boolean>(false);
  const [serverOnline, setServerOnline] = useState<boolean>(false);
  const [serverSnapshotCount, setServerSnapshotCount] = useState<number>(0);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
  const [showManualModal, setShowManualModal] = useState<boolean>(false);
  const [lastPolledAt, setLastPolledAt] = useState<number | null>(null);

  const loadData = useCallback(async (isSilent: boolean = false) => {
    if (!isSilent) {
      setLoading(true);
    }
    try {
      if (isManualMode) {
        // --- MANUAL MODE (Phone Storage Directly) ---
        setHasToken(false);
        const localSnaps = await getSnapshots(2000, activeVehicle.id);
        setSnapshots(localSnaps);

        const mTel = activeVehicle.manualTelemetry || {
          batteryLevelPct: 80,
          ratedRangeMiles: 220.0,
          odometerMiles: 15000,
          lastUpdated: Date.now(),
        };

        setTelemetry({
          timestamp: mTel.lastUpdated || Date.now(),
          odometerMiles: mTel.odometerMiles,
          batteryLevelPct: mTel.batteryLevelPct,
          usableBatteryLevelPct: mTel.batteryLevelPct - 1,
          ratedRangeMiles: mTel.ratedRangeMiles,
          isFastCharging: false,
          chargerPowerKw: 0,
          chargerVoltage: 0,
          chargerActualCurrent: 0,
          batteryHeaterOn: false,
          insideTempC: undefined,
          outsideTempC: undefined,
          vehicleName: activeVehicle.name || selectedProfile.name,
          vin: activeVehicle.vin || 'MANUAL-STORAGE',
          isLocked: true,
          isOnline: false,
          vehicleState: 'manual',
        });

        const evaluated = evaluateBatteryHealth(localSnaps, selectedProfile, {
          ratedRangeMiles: mTel.ratedRangeMiles,
          batteryLevelPct: mTel.batteryLevelPct,
        });
        setMetrics(evaluated);
      } else {
        // --- PAIRED MODE (Tesla Fleet API & Server Database) ---
        const serverHealth = await checkServerHealth();
        if (serverHealth) {
          setServerOnline(true);
          setServerSnapshotCount(serverHealth.snapshotCount);

          const serverData = await fetchServerVehicle();
          const serverSnaps = await fetchServerSnapshots(2000, activeVehicle.vin || activeVehicle.id);
          setSnapshots(serverSnaps);

          if (serverData) {
            if (serverData.isAccountLinked) {
              setHasToken(true);
            }
            if (serverData.vehicle) {
              const veh = serverData.vehicle;
              const snap = serverData.latestSnapshot || (serverSnaps.length > 0 ? serverSnaps[0] : null);
              const realSoc = typeof veh.last_soc === 'number' && veh.last_soc > 0 ? veh.last_soc : (snap?.battery_level_pct || 80);
              const realRange = typeof veh.last_rated_range === 'number' && veh.last_rated_range > 0 ? veh.last_rated_range : (snap?.rated_range_miles || 234.4);
              const realOdo = typeof veh.last_odometer === 'number' && veh.last_odometer > 0 ? veh.last_odometer : (snap?.odometer_miles || 4771.1);

              const actualDataTimestamp = veh.data_updated_at || snap?.timestamp || veh.updated_at || Date.now();
              if (veh.last_polled_at) {
                setLastPolledAt(veh.last_polled_at);
              }

              setTelemetry({
                timestamp: actualDataTimestamp,
                odometerMiles: realOdo,
                batteryLevelPct: realSoc,
                usableBatteryLevelPct: realSoc - 1,
                ratedRangeMiles: realRange,
                isFastCharging: veh.last_charging_state === 'Charging',
                chargerPowerKw: 0,
                chargerVoltage: 0,
                chargerActualCurrent: 0,
                batteryHeaterOn: false,
                insideTempC: typeof veh.inside_temp === 'number' ? veh.inside_temp : (veh.last_state === 'online' ? 20 : 0),
                outsideTempC: typeof veh.outside_temp === 'number' ? veh.outside_temp : (veh.last_state === 'online' ? 15 : 0),
                vehicleName: veh.display_name || activeVehicle.name || selectedProfile.name,
                vin: veh.vin || 'LRW3F7FS3SC594594',
                isLocked: veh.is_locked !== undefined ? !!veh.is_locked : true,
                isOnline: veh.last_state === 'online',
                vehicleState: veh.last_state || 'offline',
              });
            }
          }

          const snap = serverData?.latestSnapshot || (serverSnaps.length > 0 ? serverSnaps[0] : null);
          const liveReading = serverData?.vehicle
            ? {
                ratedRangeMiles: serverData.vehicle.last_rated_range && serverData.vehicle.last_rated_range !== 240
                  ? serverData.vehicle.last_rated_range
                  : (snap?.rated_range_miles || 234.4),
                batteryLevelPct: serverData.vehicle.last_soc && serverData.vehicle.last_soc !== 80
                  ? serverData.vehicle.last_soc
                  : (snap?.battery_level_pct || 84),
              }
            : undefined;

          const evaluated = evaluateBatteryHealth(serverSnaps, selectedProfile, liveReading);
          setMetrics(evaluated);
        } else {
          // Local fallback when server unreachable
          setServerOnline(false);
          const token = await getTeslaRefreshToken();
          setHasToken(!!token);

          const tel = await fetchVehicleTelemetry(false, selectedProfile.nominalCapacityKwh);
          setTelemetry(tel);

          const localSnaps = await getSnapshots(500, activeVehicle.id);
          setSnapshots(localSnaps);
          const evaluated = evaluateBatteryHealth(localSnaps, selectedProfile);
          setMetrics(evaluated);
        }
      }
    } catch (err) {
      console.warn('Dashboard load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeVehicle, selectedProfile, isManualMode]);

  useFocusEffect(
    useCallback(() => {
      loadData(false);
    }, [loadData])
  );

  useEffect(() => {
    loadData(false);

    if (!isManualMode) {
      const heartbeatTimer = setInterval(() => {
        loadData(true);
      }, 60000);
      return () => clearInterval(heartbeatTimer);
    }
  }, [loadData, isManualMode]);

  const handleManualSync = async () => {
    setRefreshing(true);
    const showAlert = (title: string, message: string) => {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(`${title}\n\n${message}`);
      } else {
        Alert.alert(title, message);
      }
    };

    if (isManualMode) {
      await loadData(false);
      showAlert('Local Data Refreshed', 'Refreshed metrics from local device storage.');
    } else if (serverOnline) {
      const res = await triggerServerSync();
      showAlert(
        res.success ? 'Vehicle Link Connected! ⚡' : 'Tesla Fleet API Response',
        res.message
      );
      await loadData(false);
    } else {
      showAlert('Server Offline', 'Backend server is unreachable. Running in local mode.');
    }
    setRefreshing(false);
  };

  const handleSaveManualReading = async (reading: {
    soc: number;
    ratedRange: number;
    odometer: number;
  }) => {
    // 1. Persist telemetry to active vehicle storage
    await updateManualTelemetry({
      batteryLevelPct: reading.soc,
      ratedRangeMiles: reading.ratedRange,
      odometerMiles: reading.odometer,
    });

    // 2. Compute capacity & degradation
    const calc = calculateBatteryCapacity(
      reading.ratedRange,
      reading.soc,
      selectedProfile
    );

    // 3. Insert snapshot into local storage
    await insertSnapshot(
      {
        timestamp: Date.now(),
        odometer_miles: reading.odometer,
        battery_level_pct: reading.soc,
        rated_range_miles: reading.ratedRange,
        calculated_capacity_kwh: calc.calculatedCapacityKwh,
        degradation_pct: calc.degradationPct,
        is_fast_charging: 0,
        charger_power_kw: 0,
      },
      activeVehicle.id
    );

    // 4. If user has Premium, ALSO back up snapshot to the Server Database!
    if (isPremium) {
      try {
        const serverUrl = getServerUrl();
        await fetch(`${serverUrl}/api/snapshot/manual`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vin: activeVehicle.vin || activeVehicle.id || 'PREMIUM-CLOUD-BACKUP',
            odometer_miles: reading.odometer,
            battery_level_pct: reading.soc,
            rated_range_miles: reading.ratedRange,
            calculated_capacity_kwh: calc.calculatedCapacityKwh,
            degradation_pct: calc.degradationPct,
            is_fast_charging: 0,
            charger_power_kw: 0,
          }),
        });
      } catch (e) {
        // silent fallback
      }
    }

    // 4. Update screen telemetry state immediately with new reading
    setTelemetry({
      timestamp: Date.now(),
      odometerMiles: reading.odometer,
      batteryLevelPct: reading.soc,
      usableBatteryLevelPct: Math.max(0, reading.soc - 1),
      ratedRangeMiles: reading.ratedRange,
      isFastCharging: false,
      chargerPowerKw: 0,
      chargerVoltage: 0,
      chargerActualCurrent: 0,
      batteryHeaterOn: false,
      vehicleName: activeVehicle.name || selectedProfile.name,
      vin: activeVehicle.vin || 'MANUAL-STORAGE',
      isLocked: true,
      isOnline: false,
      vehicleState: 'manual',
    });

    // 5. Reload snapshots and recalculate health metrics immediately
    const localSnaps = await getSnapshots(2000, activeVehicle.id);
    setSnapshots(localSnaps);

    const evaluated = evaluateBatteryHealth(localSnaps, selectedProfile, {
      ratedRangeMiles: reading.ratedRange,
      batteryLevelPct: reading.soc,
    });
    setMetrics(evaluated);
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#38bdf8" />
        <Text style={styles.loadingText}>Syncing vehicle telemetry & server database...</Text>
      </View>
    );
  }

  // Calculate 100% full range
  const calculatedMaxRange =
    telemetry && telemetry.batteryLevelPct > 0
      ? Math.round((telemetry.ratedRangeMiles / (telemetry.batteryLevelPct / 100)) * 10) / 10
      : null;

  // Calculate dynamic realized efficiency from current reading (or fallback to profile rated consumption)
  const currentWhPerMile =
    calculatedMaxRange && calculatedMaxRange > 0 && selectedProfile.nominalCapacityKwh > 0
      ? (selectedProfile.nominalCapacityKwh * 1000) / calculatedMaxRange
      : selectedProfile.whPerMile;

  const pullTimestamp = telemetry?.timestamp;
  const formatTimestamp = (ts?: number | null) => {
    if (!ts) return { date: '--', time: '--', full: 'No record available' };
    const d = new Date(ts);
    const dateStr = d.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const timeStr = d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    return {
      date: dateStr,
      time: timeStr,
      full: `${dateStr} at ${timeStr}`,
    };
  };
  const lastDataPulled = formatTimestamp(pullTimestamp);
  const lastPolledFormatted = formatTimestamp(lastPolledAt);
  const isCarOnline = isManualMode ? false : (telemetry?.isOnline ?? (telemetry?.vehicleState === 'online'));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleManualSync}
          tintColor="#38bdf8"
          colors={['#38bdf8', '#10b981']}
          progressBackgroundColor="#1e293b"
        />
      }
    >
      {/* App Header */}
      <View style={styles.header}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.brandTitle}>Vehicle Telemetry</Text>
          <Text style={styles.brandSubtitle}>Real-time battery metrics & health</Text>
        </View>
        <HeaderStatusBadges isManual={isManualMode} isPaired={hasToken} isOnline={isCarOnline} />
      </View>

      {/* Connect Banner if in paired mode but not linked */}
      {!isManualMode && !hasToken && (
        <TouchableOpacity
          style={styles.loginBanner}
          onPress={() => setShowLoginModal(true)}
        >
          <View style={styles.loginBannerLeft}>
            <Text style={styles.loginBannerTitle}>Connect Vehicle Telemetry</Text>
            <Text style={styles.loginBannerSub}>
              Connect your Tesla account for real-time 24/7 telemetry.
            </Text>
          </View>
          <View style={styles.loginBannerBtn}>
            <Text style={styles.loginBannerBtnText}>Connect ⚡</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Main Battery Gauge Card */}
      <View style={styles.mainCard}>
        <View style={styles.carHeaderRow}>
          <Text style={styles.carName}>{activeVehicle.name || telemetry?.vehicleName || 'Tesla Vehicle'}</Text>
          <Text style={styles.vinText}>
            {isManualMode ? 'MANUAL STORAGE' : `VIN: ${telemetry?.vin || 'N/A'}`}
          </Text>
        </View>

        <View style={styles.socSection}>
          <View style={styles.socCircle}>
            <Text style={styles.socNumber}>{telemetry?.batteryLevelPct ?? '--'}%</Text>
            <Text style={styles.socLabel}>CHARGE</Text>
          </View>
          <View style={styles.socDetails}>
            <View style={styles.socDetailRow}>
              <Text style={styles.detailLabel}>Rated Range</Text>
              <Text style={styles.detailValue}>
                {telemetry?.ratedRangeMiles != null ? formatDistance(telemetry.ratedRangeMiles) : '--'}
              </Text>
            </View>
            <View style={styles.socDetailRow}>
              <Text style={styles.detailLabel}>Calculated Max Range (100%)</Text>
              <Text style={[styles.detailValue, { color: '#38bdf8' }]}>
                {calculatedMaxRange ? formatDistance(calculatedMaxRange) : '--'}
              </Text>
            </View>
            <View style={styles.socDetailRow}>
              <Text style={styles.detailLabel}>Current Efficiency</Text>
              <Text style={[styles.detailValue, { color: '#10b981' }]}>
                {formatEfficiency(currentWhPerMile)}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Live Vehicle Telemetry Grid */}
      <Text style={styles.sectionTitle}>
        {isManualMode ? 'Current Vehicle Stats (Manual)' : 'Live Vehicle Telemetry'}
      </Text>
      <View style={styles.grid}>
        {/* Card 1: Odometer */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Odometer</Text>
          <Text style={styles.cardHighlight}>
            {telemetry?.odometerMiles ? `${Math.round(toDisplayDistance(telemetry.odometerMiles)).toLocaleString()}` : '--'}
          </Text>
          <Text style={styles.cardSub}>{unitLongLabel}</Text>
        </View>

        {/* Card 2: Charging State */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Charging State</Text>
          <Text style={[styles.cardHighlight, isManualMode && styles.textManualMuted]}>
            {isManualMode
              ? 'Not Available In Manual Mode'
              : (telemetry?.isFastCharging
                ? 'Fast DC'
                : (telemetry?.chargerPowerKw ? 'AC Charging' : 'Disconnected'))}
          </Text>
          <Text style={styles.cardSub}>
            {isManualMode
              ? 'Requires Tesla Link'
              : (telemetry?.chargerPowerKw ? `${telemetry.chargerPowerKw} kW` : 'Standby')}
          </Text>
        </View>

        {/* Card 3: Climate & Temps Combined Card */}
        <View style={[styles.card, !isManualMode && !isCarOnline && styles.cardOffline]}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardLabel, (!isCarOnline || isManualMode) && styles.textOfflineMuted]}>
              Climate & Temps
            </Text>
            {!isManualMode && !isCarOnline && (
              <Text style={styles.offlinePill}>LAST SEEN</Text>
            )}
          </View>
          <Text
            style={[
              styles.cardHighlight,
              isManualMode
                ? styles.textManualMuted
                : (!isCarOnline && styles.textOfflineMuted),
            ]}
          >
            {isManualMode ? (
              'Not Available In Manual Mode'
            ) : (
              <>
                {typeof telemetry?.insideTempC === 'number'
                  ? `${Number.isInteger(telemetry.insideTempC) ? telemetry.insideTempC : telemetry.insideTempC.toFixed(1)}°C`
                  : '--'}
                <Text style={[styles.tempDividerText, !isCarOnline && styles.textOfflineMuted]}> / </Text>
                {typeof telemetry?.outsideTempC === 'number'
                  ? `${Number.isInteger(telemetry.outsideTempC) ? telemetry.outsideTempC : telemetry.outsideTempC.toFixed(1)}°C`
                  : '--'}
              </>
            )}
          </Text>
          <Text style={[styles.cardSub, (!isCarOnline || isManualMode) && styles.cardSubOffline]}>
            {isManualMode
              ? 'Requires Tesla Link'
              : (isCarOnline ? 'Cabin / Exterior' : 'Cabin / Exterior (Cached)')}
          </Text>
        </View>

        {/* Card 4: Vehicle Security / Lock Card */}
        <View style={[styles.card, !isManualMode && !isCarOnline && styles.cardOffline]}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardLabel, (!isCarOnline || isManualMode) && styles.textOfflineMuted]}>
              Vehicle Security
            </Text>
            {!isManualMode && !isCarOnline && (
              <Text style={styles.offlinePill}>LAST SEEN</Text>
            )}
          </View>
          <Text
            style={[
              styles.cardHighlight,
              isManualMode
                ? styles.textManualMuted
                : (isCarOnline
                  ? { color: (telemetry?.isLocked ?? true) ? '#34d399' : '#f59e0b' }
                  : styles.textOfflineMuted),
            ]}
          >
            {isManualMode
              ? 'Not Available In Manual Mode'
              : ((telemetry?.isLocked ?? true) ? '🔒 Locked' : '🔓 Unlocked')}
          </Text>
          <Text style={[styles.cardSub, (!isCarOnline || isManualMode) && styles.cardSubOffline]}>
            {isManualMode
              ? 'Requires Tesla Link'
              : (isCarOnline
                ? ((telemetry?.isLocked ?? true) ? 'Doors & Trunk Secure' : 'Vehicle Unlocked')
                : 'Last Known Status')}
          </Text>
        </View>
      </View>

      {/* Action Container */}
      <View style={styles.actionContainer}>
        <TouchableOpacity
          style={styles.quickEntryButton}
          onPress={() => setShowManualModal(true)}
        >
          <Text style={styles.quickEntryButtonText}>📋 Log Current Car Reading (SoC & Range)</Text>
        </TouchableOpacity>

        {!isManualMode && (
          <TouchableOpacity
            style={styles.syncButton}
            onPress={handleManualSync}
            disabled={refreshing}
          >
            {refreshing ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.syncButtonText}>🔄 Sync Telemetry & Log Snapshot</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Bottom Vehicle Status & Telemetry Pull Info */}
      <View style={styles.statusFooterCard}>
        <View style={styles.statusFooterRow}>
          <View style={styles.statusFooterLeft}>
            <View
              style={[
                styles.statusDot,
                isManualMode
                  ? styles.statusDotManual
                  : (isCarOnline ? styles.statusDotOnline : styles.statusDotOffline),
              ]}
            />
            <Text style={styles.statusFooterTitle}>
              {isManualMode
                ? 'Manual Mode (Local Phone Storage)'
                : (isCarOnline ? 'Vehicle Online (Connected)' : 'Vehicle Asleep / Offline')}
            </Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              isManualMode
                ? styles.statusBadgeManual
                : (isCarOnline ? styles.statusBadgeOnline : styles.statusBadgeOffline),
            ]}
          >
            <Text
              style={[
                styles.statusBadgeText,
                isManualMode
                  ? styles.statusBadgeTextManual
                  : (isCarOnline ? styles.statusBadgeTextOnline : styles.statusBadgeTextOffline),
              ]}
            >
              {isManualMode ? 'LOCAL STORAGE' : (isCarOnline ? 'LIVE CONNECTED' : (telemetry?.vehicleState?.toUpperCase() || 'STANDBY'))}
            </Text>
          </View>
        </View>

        <View style={styles.statusFooterDivider} />

        <View style={styles.statusFooterDetailRow}>
          <Text style={styles.statusFooterDetailLabel}>
            {isManualMode ? 'Last Logged Reading:' : 'Data Last Received from Car:'}
          </Text>
          <Text style={styles.statusFooterDetailValue}>{lastDataPulled.full}</Text>
        </View>

        {!isManualMode && !isCarOnline && lastPolledAt ? (
          <View style={[styles.statusFooterDetailRow, { marginTop: 4 }]}>
            <Text style={styles.statusFooterDetailLabel}>Sleep-Safe Poller Check:</Text>
            <Text style={[styles.statusFooterDetailValue, { color: '#64748b' }]}>
              {lastPolledFormatted.time} (Car Sleeping)
            </Text>
          </View>
        ) : null}

        <Text style={styles.statusFooterHint}>
          {isManualMode
            ? '✓ Running entirely on device. All battery calculations and logs are stored on your phone directly.'
            : (isCarOnline
              ? '✓ Live two-way connection established with the vehicle.'
              : 'Tesla is currently resting in low-power deep sleep. Metrics above reflect the last verified telemetry data received from the car.')}
        </Text>
      </View>

      {/* Manual Reading Entry Modal */}
      <ManualLogModal
        visible={showManualModal}
        onClose={() => setShowManualModal(false)}
        onSave={handleSaveManualReading}
        initialSoc={telemetry?.batteryLevelPct ?? 80}
        initialRange={telemetry?.ratedRangeMiles ?? 220}
        initialOdo={telemetry?.odometerMiles ?? 15000}
        unitLabel={unitLabel}
        toDisplayDistance={toDisplayDistance}
        fromInputDistance={fromInputDistance}
      />

      {/* Tesla OAuth Modal */}
      <TeslaLoginModal
        visible={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onSuccess={() => loadData(false)}
      />

      {/* Version footer */}
      <FooterVersion />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  loadingText: {
    marginTop: 12,
    color: '#94a3b8',
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingTop: 8,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: -0.5,
  },
  brandSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 2,
  },
  loginBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  loginBannerLeft: {
    flex: 1,
    marginRight: 10,
  },
  loginBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#38bdf8',
  },
  loginBannerSub: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  loginBannerBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  loginBannerBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  mainCard: {
    backgroundColor: '#1e293b',
    borderRadius: 18,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  carHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 10,
  },
  carName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  vinText: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
  },
  socSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  socCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#0f172a',
    borderWidth: 4,
    borderColor: '#10b981',
    justifyContent: 'center',
    alignItems: 'center',
  },
  socNumber: {
    fontSize: 26,
    fontWeight: '800',
    color: '#ffffff',
  },
  socLabel: {
    fontSize: 9,
    color: '#94a3b8',
    fontWeight: '700',
    letterSpacing: 1,
  },
  socDetails: {
    flex: 1,
    marginLeft: 18,
    gap: 8,
  },
  socDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 12,
    color: '#94a3b8',
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f8fafc',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f1f5f9',
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  card: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardOffline: {
    opacity: 0.65,
    backgroundColor: 'rgba(30, 41, 59, 0.6)',
    borderColor: 'rgba(51, 65, 85, 0.6)',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  offlinePill: {
    fontSize: 8,
    fontWeight: '800',
    color: '#94a3b8',
    backgroundColor: 'rgba(100, 116, 139, 0.25)',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
    letterSpacing: 0.5,
  },
  textOfflineMuted: {
    color: '#64748b',
  },
  textManualMuted: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
    marginVertical: 4,
  },
  cardSubOffline: {
    color: '#64748b',
  },
  cardLabel: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  cardHighlight: {
    fontSize: 20,
    fontWeight: '800',
    color: '#ffffff',
    marginVertical: 4,
  },
  tempDividerText: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },
  cardSub: {
    fontSize: 11,
    color: '#38bdf8',
    fontWeight: '600',
  },
  actionContainer: {
    marginTop: 4,
    gap: 10,
    marginBottom: 16,
  },
  quickEntryButton: {
    backgroundColor: '#10b981',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickEntryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  syncButton: {
    backgroundColor: '#0284c7',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  statusFooterCard: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 16,
  },
  statusFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusFooterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusDotOnline: {
    backgroundColor: '#10b981',
  },
  statusDotOffline: {
    backgroundColor: '#94a3b8',
  },
  statusDotManual: {
    backgroundColor: '#f59e0b',
  },
  statusFooterTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusBadgeOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  statusBadgeOffline: {
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    borderColor: 'rgba(148, 163, 184, 0.3)',
  },
  statusBadgeManual: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: '#f59e0b',
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  statusBadgeTextOnline: {
    color: '#34d399',
  },
  statusBadgeTextOffline: {
    color: '#94a3b8',
  },
  statusBadgeTextManual: {
    color: '#f59e0b',
  },
  statusFooterDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    marginVertical: 10,
  },
  statusFooterDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusFooterDetailLabel: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '500',
  },
  statusFooterDetailValue: {
    fontSize: 12,
    color: '#38bdf8',
    fontWeight: '700',
  },
  statusFooterHint: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 6,
    lineHeight: 15,
  },
});
