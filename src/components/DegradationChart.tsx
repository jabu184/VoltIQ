import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { BatterySnapshot, updateSnapshot, deleteSnapshot } from '../services/db';
import { updateServerSnapshot, deleteServerSnapshot } from '../services/apiClient';
import { calculateBatteryCapacity, VehicleModelProfile, TESLA_PROFILES } from '../services/batteryLogic';

type MetricMode = 'pct' | 'deg' | 'kwh' | 'max_range' | 'energy';
type AxisMode = 'odometer' | 'time';

interface DegradationChartProps {
  snapshots: BatterySnapshot[];
  isPremium: boolean;
  onUnlockPress: () => void;
  onSnapshotUpdated?: () => Promise<void> | void;
  onSnapshotDeleted?: () => Promise<void> | void;
  vehicleProfile?: VehicleModelProfile;
  vehicleId?: string;
  isManualMode?: boolean;
  unitLabel?: string;
  toDisplayDistance?: (miles: number) => number;
  fromInputDistance?: (val: number) => number;
  priceLabel?: string;
}

export const DegradationChart: React.FC<DegradationChartProps> = ({
  snapshots,
  isPremium,
  onUnlockPress,
  onSnapshotUpdated,
  onSnapshotDeleted,
  vehicleProfile,
  vehicleId,
  isManualMode = true,
  unitLabel = 'mi',
  toDisplayDistance = (m) => m,
  fromInputDistance = (v) => v,
  priceLabel = '£2.99',
}) => {
  const [metricMode, setMetricMode] = useState<MetricMode>('pct');
  const [axisMode, setAxisMode] = useState<AxisMode>('time');
  const [selectedPoint, setSelectedPoint] = useState<BatterySnapshot | null>(null);

  // Edit point state
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [editSoc, setEditSoc] = useState<string>('');
  const [editRange, setEditRange] = useState<string>('');
  const [editOdo, setEditOdo] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  const profile = vehicleProfile || TESLA_PROFILES[0];

  const openEditModal = (point: BatterySnapshot) => {
    setEditSoc(point.battery_level_pct.toString());
    setEditRange(toDisplayDistance(point.rated_range_miles).toString());
    setEditOdo(toDisplayDistance(point.odometer_miles).toString());
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedPoint || selectedPoint.id === undefined) return;
    const socNum = parseFloat(editSoc);
    const rangeNum = parseFloat(editRange);
    const odoNum = parseFloat(editOdo);

    if (isNaN(socNum) || socNum < 1 || socNum > 100) {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert('Please enter a valid battery percentage (1 - 100%).');
      }
      return;
    }
    if (isNaN(rangeNum) || rangeNum <= 0) {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert('Please enter a valid rated range.');
      }
      return;
    }
    if (isNaN(odoNum) || odoNum < 0) {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert('Please enter a valid odometer reading.');
      }
      return;
    }

    setSavingEdit(true);
    try {
      const actualRangeMiles = fromInputDistance(rangeNum);
      const actualOdoMiles = fromInputDistance(odoNum);

      const calc = calculateBatteryCapacity(actualRangeMiles, socNum, profile);

      const updates: Partial<BatterySnapshot> = {
        battery_level_pct: socNum,
        rated_range_miles: actualRangeMiles,
        odometer_miles: actualOdoMiles,
        calculated_capacity_kwh: calc.calculatedCapacityKwh,
        degradation_pct: calc.degradationPct,
      };

      if (!isManualMode) {
        await updateServerSnapshot(selectedPoint.id, updates);
      }
      await updateSnapshot(selectedPoint.id, updates, vehicleId);

      setSelectedPoint({ ...selectedPoint, ...updates });
      setShowEditModal(false);
      if (onSnapshotUpdated) {
        await onSnapshotUpdated();
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeletePoint = async () => {
    if (!selectedPoint || selectedPoint.id === undefined) return;

    const doDelete = async () => {
      if (!isManualMode) {
        await deleteServerSnapshot(selectedPoint.id!);
      }
      await deleteSnapshot(selectedPoint.id!, vehicleId);
      setSelectedPoint(null);
      if (onSnapshotDeleted) {
        await onSnapshotDeleted();
      }
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm('Delete this historical data point from your degradation curve?')) {
        await doDelete();
      }
    } else {
      Alert.alert(
        'Delete Data Point',
        'Delete this historical snapshot from your degradation curve?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: doDelete },
        ]
      );
    }
  };

  if (snapshots.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.chartTitle}>Battery Degradation Curve</Text>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📈</Text>
          <Text style={styles.emptyText}>No Historical Snapshots Logged</Text>
          <Text style={styles.emptySub}>
            Snapshots are recorded when you manually log a reading or via 24/7 background sync.
          </Text>
        </View>
      </View>
    );
  }

  const getCycles = (s: BatterySnapshot) => Math.round(((s.odometer_miles * 0.24) / profile.nominalCapacityKwh) * 10) / 10;
  const getEnergy = (s: BatterySnapshot) => Math.round(s.odometer_miles * 0.24);
  const getMaxRange = (s: BatterySnapshot) =>
    s.battery_level_pct > 0 ? Math.round((s.rated_range_miles / (s.battery_level_pct / 100)) * 10) / 10 : 279;

  // Sort according to axis
  const sorted = [...snapshots].sort((a, b) =>
    axisMode === 'odometer' ? a.odometer_miles - b.odometer_miles : a.timestamp - b.timestamp
  );

  // X-Axis range calculation
  let minX = axisMode === 'odometer' ? sorted[0].odometer_miles : sorted[0].timestamp;
  let maxX =
    axisMode === 'odometer'
      ? sorted[sorted.length - 1].odometer_miles
      : sorted[sorted.length - 1].timestamp;

  if (minX === maxX) {
    if (axisMode === 'odometer') {
      minX = Math.max(0, minX - 100);
      maxX = maxX + 100;
    } else {
      minX = minX - 86400000;
      maxX = maxX + 86400000;
    }
  }

  const rangeX = maxX - minX || 1;

  // Y-Axis range calculation depending on metric
  let minY = 0;
  let maxY = 100;
  let yUnit = '%';
  let yLabels: number[] = [];

  if (metricMode === 'pct') {
    minY = 0;
    maxY = 100;
    yUnit = '%';
    yLabels = [100, 75, 50, 25, 0];
  } else if (metricMode === 'deg') {
    const highestDeg = Math.max(...sorted.map((s) => s.degradation_pct), 5.0);
    maxY = Math.max(10.0, Math.ceil(highestDeg * 1.15));
    minY = 0;
    yUnit = '%';
    const step = maxY / 4;
    yLabels = [maxY, step * 3, step * 2, step, 0];
  } else if (metricMode === 'energy') {
    const highestEnergy = Math.max(...sorted.map(getEnergy), 500);
    maxY = Math.ceil(highestEnergy * 1.25);
    minY = 0;
    yUnit = ' kWh';
    const step = maxY / 4;
    yLabels = [maxY, step * 3, step * 2, step, 0];
  } else if (metricMode === 'max_range') {
    const maxRanges = sorted.map(getMaxRange);
    const minR = Math.floor(Math.min(...maxRanges, 250));
    const maxR = Math.ceil(Math.max(...maxRanges, 285));
    minY = Math.max(0, minR - 10);
    maxY = maxR + 10;
    yUnit = ` ${unitLabel}`;
    const step = (maxY - minY) / 4;
    yLabels = [maxY, minY + step * 3, minY + step * 2, minY + step, minY];
  } else {
    // kWh
    const caps = sorted.map((s) => s.calculated_capacity_kwh);
    const minC = Math.floor(Math.min(...caps, profile.nominalCapacityKwh * 0.85));
    const maxC = Math.ceil(Math.max(...caps, profile.nominalCapacityKwh));
    minY = Math.max(0, minC - 5);
    maxY = maxC + 2;
    yUnit = ' kWh';
    const step = (maxY - minY) / 4;
    yLabels = [maxY, minY + step * 3, minY + step * 2, minY + step, minY];
  }

  const rangeY = maxY - minY || 1;

  const chartHeight = 220;
  const chartPaddingTop = 15;
  const chartPaddingBottom = 25;
  const chartPaddingLeft = 45;
  const chartPaddingRight = 15;

  const innerHeight = chartHeight - chartPaddingTop - chartPaddingBottom;

  const getYCoord = (val: number) => {
    const ratio = (val - minY) / rangeY;
    const clamped = Math.min(Math.max(ratio, 0), 1);
    return chartPaddingTop + (1 - clamped) * innerHeight;
  };

  const getXCoordPercent = (s: BatterySnapshot) => {
    const val = axisMode === 'odometer' ? s.odometer_miles : s.timestamp;
    const ratio = (val - minX) / rangeX;
    return Math.min(Math.max(ratio * 100, 0), 100);
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear().toString().slice(-2)}`;
  };

  return (
    <View style={styles.container}>
      {/* Metric Mode Selectors */}
      <View style={styles.headerRow}>
        <Text style={styles.chartTitle}>Degradation Curve</Text>
        <View style={styles.metricToggles}>
          <TouchableOpacity
            style={[styles.toggleBtn, metricMode === 'pct' && styles.toggleBtnActive]}
            onPress={() => setMetricMode('pct')}
          >
            <Text style={[styles.toggleText, metricMode === 'pct' && styles.toggleTextActive]}>
              SoC %
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, metricMode === 'deg' && styles.toggleBtnActive]}
            onPress={() => setMetricMode('deg')}
          >
            <Text style={[styles.toggleText, metricMode === 'deg' && styles.toggleTextActive]}>
              Deg %
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, metricMode === 'kwh' && styles.toggleBtnActive]}
            onPress={() => setMetricMode('kwh')}
          >
            <Text style={[styles.toggleText, metricMode === 'kwh' && styles.toggleTextActive]}>
              Cap (kWh)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, metricMode === 'max_range' && styles.toggleBtnActive]}
            onPress={() => setMetricMode('max_range')}
          >
            <Text style={[styles.toggleText, metricMode === 'max_range' && styles.toggleTextActive]}>
              Max Range
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Axis Mode Selectors */}
      <View style={styles.subHeaderRow}>
        <Text style={styles.countText}>{snapshots.length} Data Points</Text>
        <View style={styles.axisToggles}>
          <TouchableOpacity
            style={[styles.axisBtn, axisMode === 'time' && styles.axisBtnActive]}
            onPress={() => setAxisMode('time')}
          >
            <Text style={[styles.toggleText, axisMode === 'time' && styles.toggleTextActive]}>
              📅 Time
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.axisBtn, axisMode === 'odometer' && styles.axisBtnActive]}
            onPress={() => setAxisMode('odometer')}
          >
            <Text style={[styles.toggleText, axisMode === 'odometer' && styles.toggleTextActive]}>
              🛣️ Mileage
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Selected Point Callout with Edit & Delete actions (Only when Premium) */}
      {isPremium && selectedPoint && (
        <View style={styles.callout}>
          <View style={styles.calloutTopRow}>
            <Text style={styles.calloutText}>
              📍 {selectedPoint.battery_level_pct}% &bull; {Math.round(toDisplayDistance(selectedPoint.rated_range_miles))} {unitLabel} (100%: {Math.round(toDisplayDistance(getMaxRange(selectedPoint)))} {unitLabel}) &bull;{' '}
              <Text style={{ color: '#38bdf8', fontWeight: '800' }}>
                {selectedPoint.calculated_capacity_kwh} kWh
              </Text>{' '}
              ({selectedPoint.degradation_pct}% deg) &bull;{' '}
              {Math.round(toDisplayDistance(selectedPoint.odometer_miles)).toLocaleString()} {unitLabel} &bull;{' '}
              {formatDate(selectedPoint.timestamp)}
            </Text>
            <TouchableOpacity onPress={() => setSelectedPoint(null)} style={styles.calloutCloseBtn}>
              <Text style={styles.calloutCloseText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.calloutActionsRow}>
            <TouchableOpacity
              style={styles.pointActionBtnEdit}
              onPress={() => openEditModal(selectedPoint)}
            >
              <Text style={styles.pointActionBtnEditText}>✏️ Edit Entry</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pointActionBtnDelete}
              onPress={handleDeletePoint}
            >
              <Text style={styles.pointActionBtnDeleteText}>🗑️ Delete Entry</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Plot Canvas */}
      <View style={styles.plotArea}>
        {/* Horizontal Gridlines & Y-Axis Labels */}
        {yLabels.map((val, idx) => {
          const y = getYCoord(val);
          return (
            <View key={idx} style={[styles.gridRow, { top: y }]}>
              <Text style={styles.yAxisLabel}>
                {Math.round(val)}
                {yUnit}
              </Text>
              <View style={styles.gridLine} />
            </View>
          );
        })}

        {/* Scatter Points Container - Always rendered on canvas with full position bounds */}
        <View
          style={[
            styles.pointsContainer,
            {
              left: chartPaddingLeft,
              right: chartPaddingRight,
              top: chartPaddingTop,
              height: innerHeight,
              opacity: isPremium ? 1 : 0.25,
            },
          ]}
        >
          {sorted.map((s, idx) => {
            const leftPct = getXCoordPercent(s);
            let yVal = s.battery_level_pct;
            if (metricMode === 'deg') yVal = s.degradation_pct;
            if (metricMode === 'kwh') yVal = s.calculated_capacity_kwh;
            if (metricMode === 'max_range') yVal = getMaxRange(s);
            if (metricMode === 'energy') yVal = getEnergy(s);

            const topPx = getYCoord(yVal) - chartPaddingTop;
            const isSelected = selectedPoint?.id === s.id;

            const dotColor =
              metricMode === 'pct'
                ? s.battery_level_pct >= 80
                  ? '#10b981'
                  : s.battery_level_pct >= 40
                  ? '#38bdf8'
                  : '#f59e0b'
                : metricMode === 'max_range'
                ? '#38bdf8'
                : s.degradation_pct <= 5.0
                ? '#10b981'
                : s.degradation_pct <= 10.0
                ? '#38bdf8'
                : '#f59e0b';

            return (
              <TouchableOpacity
                key={s.id || idx}
                activeOpacity={isPremium ? 0.7 : 1}
                onPress={() => {
                  if (isPremium) {
                    setSelectedPoint(s);
                  } else {
                    onUnlockPress();
                  }
                }}
                style={[
                  styles.scatterDot,
                  {
                    left: `${leftPct}%`,
                    top: topPx,
                    backgroundColor: isSelected ? '#ffffff' : dotColor,
                    borderColor: isSelected ? '#38bdf8' : '#0f172a',
                    borderWidth: isSelected ? 3 : 1,
                    transform: [{ scale: isSelected ? 1.4 : 1 }],
                  },
                ]}
              />
            );
          })}
        </View>

        {/* X-Axis Footer Labels */}
        <View style={styles.xAxisRow}>
          <Text style={styles.xAxisLabel}>
            {axisMode === 'odometer' ? `${Math.round(toDisplayDistance(minX)).toLocaleString()} ${unitLabel}` : formatDate(minX)}
          </Text>
          <Text style={styles.xAxisCenterLabel}>
            {axisMode === 'odometer' ? `Distance (${unitLabel})` : 'Timeline (Date)'}
          </Text>
          <Text style={styles.xAxisLabel}>
            {axisMode === 'odometer' ? `${Math.round(toDisplayDistance(maxX)).toLocaleString()} ${unitLabel}` : formatDate(maxX)}
          </Text>
        </View>

        {/* Non-Premium Paywall Overlay */}
        {!isPremium && (
          <View style={styles.lockOverlay}>
            <View style={styles.lockContent}>
              <Text style={styles.lockIcon}>🔒</Text>
              <Text style={styles.lockTitle}>Historical Degradation Curve Locked</Text>
              <Text style={styles.lockDescription}>
                Unlock all {snapshots.length} historical degradation points, interactive data point inspection,
                multi-axis trend graphs, and AutoTrader resale certificates with TrueBattery Premium.
              </Text>
              <TouchableOpacity style={styles.unlockBtn} onPress={onUnlockPress}>
                <Text style={styles.unlockBtnText}>Unlock Lifetime Access ({priceLabel})</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Legend & Stats */}
      {isPremium && (
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#10b981' }]} />
            <Text style={styles.legendText}>Optimal / High</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#38bdf8' }]} />
            <Text style={styles.legendText}>Normal / Mid</Text>
          </View>
        </View>
      )}

      {/* Edit Snapshot Modal */}
      <Modal
        visible={showEditModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowEditModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.editModalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>✏️ Edit Snapshot Entry</Text>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setShowEditModal(false)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>State of Charge (%)</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  value={editSoc}
                  onChangeText={setEditSoc}
                  placeholder="80"
                  placeholderTextColor="#64748b"
                />
                <Text style={styles.inputUnit}>%</Text>
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Rated Range ({unitLabel})</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  value={editRange}
                  onChangeText={setEditRange}
                  placeholder="220"
                  placeholderTextColor="#64748b"
                />
                <Text style={styles.inputUnit}>{unitLabel}</Text>
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Odometer ({unitLabel})</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  value={editOdo}
                  onChangeText={setEditOdo}
                  placeholder="15000"
                  placeholderTextColor="#64748b"
                />
                <Text style={styles.inputUnit}>{unitLabel}</Text>
              </View>
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowEditModal(false)}
                disabled={savingEdit}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleSaveEdit}
                disabled={savingEdit}
              >
                <Text style={styles.saveBtnText}>{savingEdit ? 'Saving...' : '💾 Save Changes'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    flexWrap: 'wrap',
    gap: 6,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  metricToggles: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 2,
    borderWidth: 1,
    borderColor: '#334155',
  },
  toggleBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  toggleBtnActive: {
    backgroundColor: '#0284c7',
  },
  toggleText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
  },
  toggleTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  subHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  countText: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  axisToggles: {
    flexDirection: 'row',
    gap: 6,
  },
  axisBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  axisBtnActive: {
    borderColor: '#38bdf8',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
  },
  callout: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  calloutTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  calloutText: {
    fontSize: 12,
    color: '#e2e8f0',
    lineHeight: 18,
    flex: 1,
  },
  calloutCloseBtn: {
    padding: 4,
  },
  calloutCloseText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: 'bold',
  },
  calloutActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  pointActionBtnEdit: {
    flex: 1,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1,
    borderColor: '#38bdf8',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  pointActionBtnEditText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '700',
  },
  pointActionBtnDelete: {
    flex: 1,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  pointActionBtnDeleteText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: '700',
  },
  plotArea: {
    height: 220,
    position: 'relative',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
  },
  gridRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  yAxisLabel: {
    width: 42,
    fontSize: 9,
    color: '#64748b',
    textAlign: 'right',
    paddingRight: 6,
    fontWeight: '600',
  },
  gridLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#1e293b',
  },
  pointsContainer: {
    position: 'absolute',
    left: 45,
    right: 15,
    top: 15,
    bottom: 25,
  },
  scatterDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: -5,
    marginTop: -5,
  },
  xAxisRow: {
    position: 'absolute',
    bottom: 4,
    left: 45,
    right: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  xAxisLabel: {
    fontSize: 9,
    color: '#64748b',
    fontWeight: '600',
  },
  xAxisCenterLabel: {
    fontSize: 9,
    color: '#475569',
    fontWeight: '600',
  },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  lockContent: {
    alignItems: 'center',
    maxWidth: 280,
  },
  lockIcon: {
    fontSize: 28,
    marginBottom: 6,
  },
  lockTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 4,
    textAlign: 'center',
  },
  lockDescription: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 16,
  },
  unlockBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  unlockBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  emptySub: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 4,
    maxWidth: 260,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  editModalContainer: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#1e293b',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  modalCloseBtn: {
    padding: 6,
    backgroundColor: '#0f172a',
    borderRadius: 12,
  },
  modalCloseText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: 'bold',
  },
  fieldGroup: {
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#e2e8f0',
    marginBottom: 6,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    height: 42,
    color: '#ffffff',
    fontSize: 14,
  },
  inputUnit: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
    marginLeft: 6,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#334155',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#cbd5e1',
    fontWeight: '600',
    fontSize: 13,
  },
  saveBtn: {
    flex: 2,
    backgroundColor: '#10b981',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
});
