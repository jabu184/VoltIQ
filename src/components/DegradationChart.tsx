import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { BatterySnapshot } from '../services/db';

type MetricMode = 'pct' | 'deg' | 'kwh' | 'max_range' | 'energy';
type AxisMode = 'odometer' | 'time';

interface DegradationChartProps {
  snapshots: BatterySnapshot[];
  isPremium: boolean;
  onUnlockPress: () => void;
}

export const DegradationChart: React.FC<DegradationChartProps> = ({
  snapshots,
  isPremium,
  onUnlockPress,
}) => {
  const [metricMode, setMetricMode] = useState<MetricMode>('pct');
  const [axisMode, setAxisMode] = useState<AxisMode>('time');
  const [selectedPoint, setSelectedPoint] = useState<BatterySnapshot | null>(null);

  if (snapshots.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.chartTitle}>Battery Degradation Curve</Text>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📈</Text>
          <Text style={styles.emptyText}>No Historical Snapshots Logged</Text>
          <Text style={styles.emptySub}>
            Snapshots are automatically recorded after each charge cycle or when you manually sync.
          </Text>
        </View>
      </View>
    );
  }

  const getCycles = (s: BatterySnapshot) => Math.round(((s.odometer_miles * 0.24) / 62.5) * 10) / 10;
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
    yUnit = ' mi';
    const step = (maxY - minY) / 4;
    yLabels = [maxY, minY + step * 3, minY + step * 2, minY + step, minY];
  } else {
    // kWh capacity
    const caps = sorted.map((s) => s.calculated_capacity_kwh);
    const minCap = Math.floor(Math.min(...caps, 60));
    const maxCap = Math.ceil(Math.max(...caps, 78));
    minY = Math.max(0, minCap - 5);
    maxY = maxCap + 5;
    yUnit = ' kWh';
    const step = (maxY - minY) / 4;
    yLabels = [maxY, minY + step * 3, minY + step * 2, minY + step, minY];
  }

  const chartHeight = 190;
  const chartPaddingTop = 16;
  const chartPaddingBottom = 24;
  const chartPaddingLeft = 46;
  const chartPaddingRight = 16;
  const usableH = chartHeight - chartPaddingTop - chartPaddingBottom;

  const getXCoordPercent = (pt: BatterySnapshot) => {
    const val = axisMode === 'odometer' ? pt.odometer_miles : pt.timestamp;
    const fraction = Math.min(1, Math.max(0, (val - minX) / rangeX));
    return fraction * 100;
  };

  const getYCoord = (yVal: number) => {
    const fraction = Math.min(1, Math.max(0, (yVal - minY) / (maxY - minY || 1)));
    return chartPaddingTop + (1 - fraction) * usableH;
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <View style={styles.container}>
      {/* Title & Subtitle */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Battery Telemetry Plot</Text>
          <Text style={styles.subtitle}>
            {snapshots.length} lifetime snapshot{snapshots.length === 1 ? '' : 's'} recorded
          </Text>
        </View>
        <View style={styles.rateBadge}>
          <Text style={styles.rateText}>
            {axisMode === 'odometer' ? 'Odometer Scale' : 'Timeline Scale'}
          </Text>
        </View>
      </View>

      {/* Control Toggles: Metric and X-Axis */}
      <View style={styles.controlsRow}>
        <View style={styles.toggleGroup}>
          <TouchableOpacity
            style={[styles.toggleBtn, metricMode === 'pct' && styles.toggleBtnActive]}
            onPress={() => setMetricMode('pct')}
          >
            <Text style={[styles.toggleText, metricMode === 'pct' && styles.toggleTextActive]}>
              Battery %
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, metricMode === 'deg' && styles.toggleBtnActive]}
            onPress={() => setMetricMode('deg')}
          >
            <Text style={[styles.toggleText, metricMode === 'deg' && styles.toggleTextActive]}>
              Degradation %
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, metricMode === 'kwh' && styles.toggleBtnActive]}
            onPress={() => setMetricMode('kwh')}
          >
            <Text style={[styles.toggleText, metricMode === 'kwh' && styles.toggleTextActive]}>
              Pack kWh
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
          <TouchableOpacity
            style={[styles.toggleBtn, metricMode === 'energy' && styles.toggleBtnActive]}
            onPress={() => setMetricMode('energy')}
          >
            <Text style={[styles.toggleText, metricMode === 'energy' && styles.toggleTextActive]}>
              ⚡ Energy
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.toggleGroup}>
          <TouchableOpacity
            style={[styles.toggleBtn, axisMode === 'time' && styles.toggleBtnActive]}
            onPress={() => setAxisMode('time')}
          >
            <Text style={[styles.toggleText, axisMode === 'time' && styles.toggleTextActive]}>
              📅 Time
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, axisMode === 'odometer' && styles.toggleBtnActive]}
            onPress={() => setAxisMode('odometer')}
          >
            <Text style={[styles.toggleText, axisMode === 'odometer' && styles.toggleTextActive]}>
              🛣️ Mileage
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Selected Point Callout */}
      {selectedPoint && (
        <View style={styles.callout}>
          <Text style={styles.calloutText}>
            📍 {selectedPoint.battery_level_pct}% &bull; {selectedPoint.rated_range_miles} mi (100%: {getMaxRange(selectedPoint)} mi) &bull;{' '}
            <Text style={{ color: '#38bdf8', fontWeight: '800' }}>
              {selectedPoint.calculated_capacity_kwh} kWh
            </Text>{' '}
            ({selectedPoint.degradation_pct}% deg) &bull;{' '}
            {getEnergy(selectedPoint).toLocaleString()} kWh used &bull;{' '}
            {getCycles(selectedPoint)} cycles &bull;{' '}
            {selectedPoint.is_fast_charging ? '⚡ DC Fast' : '🔌 AC'} &bull;{' '}
            {formatDate(selectedPoint.timestamp)}
          </Text>
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

        {/* Scatter Points Container */}
        <View
          style={[
            styles.pointsContainer,
            {
              left: chartPaddingLeft,
              right: chartPaddingRight,
              top: chartPaddingTop,
              bottom: chartPaddingBottom,
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
            const isFast = s.is_fast_charging === 1;
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
                activeOpacity={0.7}
                onPress={() => setSelectedPoint(s)}
                style={[
                  styles.scatterDot,
                  {
                    left: `${leftPct}%`,
                    top: topPx,
                    backgroundColor: isSelected ? '#ffffff' : dotColor,
                    borderColor: isSelected ? '#38bdf8' : isFast ? '#fef08a' : '#0f172a',
                    borderWidth: isSelected ? 3 : isFast ? 1.5 : 1,
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
            {axisMode === 'odometer' ? `${Math.round(minX).toLocaleString()} mi` : formatDate(minX)}
          </Text>
          <Text style={styles.xAxisCenterLabel}>
            {axisMode === 'odometer' ? 'Distance (Odometer)' : 'Timeline (Date)'}
          </Text>
          <Text style={styles.xAxisLabel}>
            {axisMode === 'odometer' ? `${Math.round(maxX).toLocaleString()} mi` : formatDate(maxX)}
          </Text>
        </View>

        {/* Non-Premium Paywall Overlay */}
        {!isPremium && (
          <View style={styles.lockOverlay}>
            <View style={styles.lockContent}>
              <Text style={styles.lockIcon}>🔒</Text>
              <Text style={styles.lockTitle}>Lifetime Multi-Axis Plot Locked</Text>
              <Text style={styles.lockDescription}>
                Unlock all {snapshots.length} telemetry points, interactive point inspection, and
                AutoTrader resale certificates.
              </Text>
              <TouchableOpacity style={styles.unlockBtn} onPress={onUnlockPress}>
                <Text style={styles.unlockBtnText}>Unlock for £2.99</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Legend & Stats */}
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#10b981' }]} />
          <Text style={styles.legendText}>Optimal / High</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#38bdf8' }]} />
          <Text style={styles.legendText}>Normal / Mid</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#fef08a', borderWidth: 1, borderColor: '#ca8a04' }]} />
          <Text style={styles.legendText}>DC Fast Charge</Text>
        </View>
      </View>
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
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
  },
  subtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  rateBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  rateText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#38bdf8',
  },
  controlsRow: {
    flexDirection: 'column',
    gap: 8,
    marginBottom: 12,
  },
  toggleGroup: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 2,
    borderWidth: 1,
    borderColor: '#334155',
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 6,
  },
  toggleBtnActive: {
    backgroundColor: '#38bdf8',
  },
  toggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  toggleTextActive: {
    color: '#0f172a',
    fontWeight: '700',
  },
  callout: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  calloutText: {
    color: '#f8fafc',
    fontSize: 12,
    textAlign: 'center',
  },
  plotArea: {
    height: 190,
    position: 'relative',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1e293b',
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
    fontSize: 10,
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
  },
  scatterDot: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 5,
    marginLeft: -4.5,
    marginTop: -4.5,
  },
  xAxisRow: {
    position: 'absolute',
    bottom: 4,
    left: 46,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  xAxisLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '600',
  },
  xAxisCenterLabel: {
    fontSize: 10,
    color: '#475569',
    fontWeight: '600',
  },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
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
    fontSize: 15,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 4,
  },
  lockDescription: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 12,
  },
  unlockBtn: {
    backgroundColor: '#38bdf8',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  unlockBtnText: {
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 13,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
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
    fontSize: 11,
    color: '#94a3b8',
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 4,
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 16,
    marginVertical: 12,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  emptyText: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  emptySub: {
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },
});
