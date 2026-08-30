import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
} from 'react-native';
import {
  fetchVehicleTelemetry,
  TeslaTelemetry,
  getTeslaRefreshToken,
} from '../services/teslaClient';
import {
  calculateBatteryCapacity,
  evaluateBatteryHealth,
  TESLA_PROFILES,
  VehicleModelProfile,
  BatteryHealthMetrics,
} from '../services/batteryLogic';
import {
  insertSnapshot,
  seedSampleData,
  getSnapshots,
  BatterySnapshot,
} from '../services/db';
import {
  checkServerHealth,
  fetchServerVehicle,
  fetchServerSnapshots,
  triggerServerSync,
} from '../services/apiClient';
import { TeslaLoginModal } from '../components/TeslaLoginModal';
import { useVehicleProfile } from '../context/VehicleProfileContext';
import { VoltIQLogo } from '../components/VoltIQLogo';
import { useUnit } from '../context/UnitContext';

export const DashboardScreen: React.FC = () => {
  const { selectedProfile } = useVehicleProfile();
  const { unit, unitLabel, unitLongLabel, toDisplayDistance, formatDistance } = useUnit();
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [telemetry, setTelemetry] = useState<TeslaTelemetry | null>(null);
  const [snapshots, setSnapshots] = useState<BatterySnapshot[]>([]);
  const [metrics, setMetrics] = useState<BatteryHealthMetrics | null>(null);
  const [hasToken, setHasToken] = useState<boolean>(false);
  const [serverOnline, setServerOnline] = useState<boolean>(false);
  const [serverSnapshotCount, setServerSnapshotCount] = useState<number>(0);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);

  const loadData = useCallback(async (isSilent: boolean = false) => {
    if (!isSilent) {
      setLoading(true);
    }
    try {

      // 1. Check if backend server is available
      const serverHealth = await checkServerHealth();
      if (serverHealth) {
        setServerOnline(true);
        setServerSnapshotCount(serverHealth.snapshotCount);

        const serverData = await fetchServerVehicle();
        const serverSnaps = await fetchServerSnapshots(2000);
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

            setTelemetry({
              timestamp: veh.updated_at || snap?.timestamp || Date.now(),
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
              vehicleName: veh.display_name || 'Tesla Model 3',
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
                : (snap?.battery_level_pct || 84)
            }
          : undefined;

        const evaluated = evaluateBatteryHealth(serverSnaps, selectedProfile, liveReading);
        setMetrics(evaluated);
      } else {
        // Fallback to local SQLite mode
        setServerOnline(false);
        const token = await getTeslaRefreshToken();
        setHasToken(!!token);

        const tel = await fetchVehicleTelemetry(false, selectedProfile.nominalCapacityKwh);
        setTelemetry(tel);

        const calc = calculateBatteryCapacity(
          tel.ratedRangeMiles,
          tel.batteryLevelPct,
          selectedProfile
        );

        await insertSnapshot({
          timestamp: Date.now(),
          odometer_miles: tel.odometerMiles,
          battery_level_pct: tel.batteryLevelPct,
          rated_range_miles: tel.ratedRangeMiles,
          calculated_capacity_kwh: calc.calculatedCapacityKwh,
          degradation_pct: calc.degradationPct,
          is_fast_charging: tel.isFastCharging ? 1 : 0,
          charger_power_kw: tel.chargerPowerKw,
        });

        const snapshots = await getSnapshots(500);
        setSnapshots(snapshots);
        const evaluated = evaluateBatteryHealth(snapshots, selectedProfile);
        setMetrics(evaluated);
      }
    } catch (err) {
      console.warn('Dashboard load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedProfile]);

  useEffect(() => {
    loadData(false);

    // Heartbeat liveness polling: silently checks sleep-safe vehicle connection every 60s while app is open
    const heartbeatTimer = setInterval(() => {
      loadData(true);
    }, 60000);

    return () => clearInterval(heartbeatTimer);
  }, [loadData]);

  const handleManualSync = async () => {
    setRefreshing(true);
    const showAlert = (title: string, message: string) => {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(`${title}\n\n${message}`);
      } else {
        Alert.alert(title, message);
      }
    };

    if (serverOnline) {
      const res = await triggerServerSync();
      showAlert(
        res.success ? 'Vehicle Link Connected! ⚡' : 'Tesla Fleet API Response',
        res.message
      );
    } else {
      showAlert('Server Offline', 'Backend server is unreachable. Running in local SQLite mode.');
    }
    await loadData();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#38bdf8" />
        <Text style={styles.loadingText}>Syncing vehicle telemetry & server database...</Text>
      </View>
    );
  }

  const calculatedMaxRange =
    telemetry && telemetry.batteryLevelPct > 0
      ? Math.round((telemetry.ratedRangeMiles / (telemetry.batteryLevelPct / 100)) * 10) / 10
      : null;

  const pullTimestamp = telemetry?.timestamp;
  const formatLastPulled = (ts?: number) => {
    if (!ts) return { date: '--', time: '--', full: 'No pull recorded' };
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
  const lastPulled = formatLastPulled(pullTimestamp);
  const isCarOnline = telemetry?.isOnline ?? (telemetry?.vehicleState === 'online');

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
        <View style={{ flex: 1 }}>
          <Text style={styles.brandTitle}>Vehicle Telemetry</Text>
          <Text style={styles.brandSubtitle}>Real-time battery metrics & health</Text>
        </View>
        <View style={styles.headerBadgesRow}>
          <View style={[styles.badgeBYOK, hasToken ? styles.badgeLive : (serverOnline ? styles.badgeServer : styles.badgeDemo)]}>
            <Text style={[styles.badgeText, hasToken ? styles.badgeTextLive : (serverOnline ? styles.badgeTextServer : styles.badgeTextDemo)]}>
              {hasToken ? '● Tesla Linked' : (serverOnline ? '● Server Active' : '○ Standby')}
            </Text>
          </View>
          {hasToken && (
            <View style={[styles.badgeStatus, isCarOnline ? styles.badgeOnline : styles.badgeOffline]}>
              <Text style={[styles.badgeText, isCarOnline ? styles.badgeTextOnline : styles.badgeTextOffline]}>
                {isCarOnline ? '● Online' : (telemetry?.vehicleState === 'asleep' ? '○ Asleep' : '○ Offline')}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Connect Banner if not linked */}
      {!hasToken && (
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
          <Text style={styles.carName}>{telemetry?.vehicleName || 'Tesla Vehicle'}</Text>
          <Text style={styles.vinText}>VIN: {telemetry?.vin || 'N/A'}</Text>
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
          </View>
        </View>
      </View>

      {/* Live Vehicle Telemetry Grid */}
      <Text style={styles.sectionTitle}>Live Vehicle Telemetry</Text>
      <View style={styles.grid}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Odometer</Text>
          <Text style={styles.cardHighlight}>
            {telemetry?.odometerMiles ? `${Math.round(toDisplayDistance(telemetry.odometerMiles)).toLocaleString()}` : '--'}
          </Text>
          <Text style={styles.cardSub}>{unitLongLabel}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Charging State</Text>
          <Text style={styles.cardHighlight}>
            {telemetry?.isFastCharging ? 'Fast DC' : (telemetry?.chargerPowerKw ? 'AC Charging' : 'Disconnected')}
          </Text>
          <Text style={styles.cardSub}>
            {telemetry?.chargerPowerKw ? `${telemetry.chargerPowerKw} kW` : 'Standby'}
          </Text>
        </View>
        {/* Climate & Temps Card */}
        <View style={[styles.card, !isCarOnline && styles.cardOffline]}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardLabel, !isCarOnline && styles.textOfflineMuted]}>
              Climate & Temps
            </Text>
            {!isCarOnline && (
              <Text style={styles.offlinePill}>LAST SEEN</Text>
            )}
          </View>
          <Text
            style={[
              styles.cardHighlight,
              !isCarOnline && styles.textOfflineMuted,
            ]}
          >
            {typeof telemetry?.insideTempC === 'number'
              ? `${Number.isInteger(telemetry.insideTempC) ? telemetry.insideTempC : telemetry.insideTempC.toFixed(1)}°C`
              : '--'}
            <Text style={[styles.tempDividerText, !isCarOnline && styles.textOfflineMuted]}> / </Text>
            {typeof telemetry?.outsideTempC === 'number'
              ? `${Number.isInteger(telemetry.outsideTempC) ? telemetry.outsideTempC : telemetry.outsideTempC.toFixed(1)}°C`
              : '--'}
          </Text>
          <Text style={[styles.cardSub, !isCarOnline && styles.cardSubOffline]}>
            {isCarOnline ? 'Cabin / Exterior' : 'Cabin / Exterior (Cached)'}
          </Text>
        </View>

        {/* Vehicle Security / Lock Card */}
        <View style={[styles.card, !isCarOnline && styles.cardOffline]}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardLabel, !isCarOnline && styles.textOfflineMuted]}>
              Vehicle Security
            </Text>
            {!isCarOnline && (
              <Text style={styles.offlinePill}>LAST SEEN</Text>
            )}
          </View>
          <Text
            style={[
              styles.cardHighlight,
              isCarOnline
                ? { color: (telemetry?.isLocked ?? true) ? '#34d399' : '#f59e0b' }
                : styles.textOfflineMuted,
            ]}
          >
            {(telemetry?.isLocked ?? true) ? '🔒 Locked' : '🔓 Unlocked'}
          </Text>
          <Text style={[styles.cardSub, !isCarOnline && styles.cardSubOffline]}>
            {isCarOnline
              ? ((telemetry?.isLocked ?? true) ? 'Doors & Trunk Secure' : 'Vehicle Unlocked')
              : 'Last Known Status'}
          </Text>
        </View>
      </View>

      {/* Action Container */}
      <View style={styles.actionContainer}>
        <TouchableOpacity
          style={styles.quickEntryButton}
          onPress={() => setShowLoginModal(true)}
        >
          <Text style={styles.quickEntryButtonText}>📝 Log Current Car Reading (SoC & Range)</Text>
        </TouchableOpacity>

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
      </View>

      {/* Bottom Vehicle Status & Telemetry Pull Info */}
      <View style={styles.statusFooterCard}>
        <View style={styles.statusFooterRow}>
          <View style={styles.statusFooterLeft}>
            <View
              style={[
                styles.statusDot,
                isCarOnline ? styles.statusDotOnline : styles.statusDotOffline,
              ]}
            />
            <Text style={styles.statusFooterTitle}>
              {isCarOnline ? 'Vehicle Online (Connected)' : 'Vehicle Asleep / Offline'}
            </Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              isCarOnline ? styles.statusBadgeOnline : styles.statusBadgeOffline,
            ]}
          >
            <Text
              style={[
                styles.statusBadgeText,
                isCarOnline ? styles.statusBadgeTextOnline : styles.statusBadgeTextOffline,
              ]}
            >
              {isCarOnline ? 'LIVE CONNECTED' : (telemetry?.vehicleState?.toUpperCase() || 'STANDBY')}
            </Text>
          </View>
        </View>

        <View style={styles.statusFooterDivider} />

        <View style={styles.statusFooterDetailRow}>
          <Text style={styles.statusFooterDetailLabel}>Data Last Pulled from Car:</Text>
          <Text style={styles.statusFooterDetailValue}>{lastPulled.full}</Text>
        </View>

        <Text style={styles.statusFooterHint}>
          {isCarOnline
            ? '✓ Live two-way connection established with the vehicle.'
            : 'Tesla enters low-power deep sleep to conserve battery. Telemetry reflects the last recorded snapshot.'}
        </Text>
      </View>

      {/* Tesla OAuth Modal */}
      <TeslaLoginModal
        visible={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onSuccess={loadData}
      />
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
    paddingBottom: 40,
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    color: '#94a3b8',
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 16,
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: -0.5,
  },
  brandSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  headerBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badgeBYOK: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  badgeStatus: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  badgeOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10b981',
  },
  badgeOffline: {
    backgroundColor: 'rgba(100, 116, 139, 0.15)',
    borderColor: '#64748b',
  },
  badgeServer: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: '#38bdf8',
  },
  badgeLive: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: '#38bdf8',
  },
  badgeDemo: {
    backgroundColor: '#1e293b',
    borderColor: '#64748b',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  badgeTextServer: {
    color: '#38bdf8',
  },
  badgeTextLive: {
    color: '#38bdf8',
  },
  badgeTextDemo: {
    color: '#94a3b8',
  },
  badgeTextOnline: {
    color: '#10b981',
  },
  badgeTextOffline: {
    color: '#94a3b8',
  },
  toast: {
    backgroundColor: '#065f46',
    borderWidth: 1,
    borderColor: '#10b981',
    borderRadius: 8,
    padding: 9,
    marginBottom: 14,
  },
  toastText: {
    color: '#ecfdf5',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  pollerPill: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#0284c7',
  },
  pollerPillTitle: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  pollerPillSub: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 15,
  },
  loginBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#0284c7',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  loginBannerLeft: {
    flex: 1,
  },
  loginBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  loginBannerSub: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 3,
    lineHeight: 15,
  },
  loginBannerBtn: {
    backgroundColor: '#0284c7',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  loginBannerBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
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
  statusFooterCard: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#334155',
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
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 3,
  },
  statusDotOffline: {
    backgroundColor: '#94a3b8',
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
    shadowColor: '#0284c7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  syncButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  connectedCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  connectedCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  connectedCardTitle: {
    color: '#10b981',
    fontWeight: '700',
    fontSize: 14,
  },
  connectedCardSub: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  connectedLiveBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#10b981',
  },
  connectedLiveBadgeText: {
    color: '#10b981',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
