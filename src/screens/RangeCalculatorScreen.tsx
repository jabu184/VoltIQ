import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Switch,
  RefreshControl,
} from 'react-native';
import { fetchServerVehicle, checkServerHealth } from '../services/apiClient';
import { useFocusEffect } from 'expo-router';
import { useVehicleProfile } from '../context/VehicleProfileContext';
import { useUnit } from '../context/UnitContext';
import { useTariff } from '../context/TariffContext';
import { getSnapshots } from '../services/db';
import { RangeSlider } from '../components/RangeSlider';
import { FooterVersion } from '../components/FooterVersion';
import { HeaderStatusBadges } from '../components/HeaderStatusBadges';

export const RangeCalculatorScreen: React.FC = () => {
  const { activeVehicle, selectedProfile, isManualMode } = useVehicleProfile();
  const { unit, unitLabel, toDisplayDistance, fromInputDistance } = useUnit();
  const {
    homeRate,
    superchargerRate,
    homePowerKw,
    superchargerPowerKw,
    currencySymbol,
    currencySubUnit,
    calcHomeCost,
    calcSuperchargerCost,
    formatCost,
  } = useTariff();

  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [distanceInput, setDistanceInput] = useState<string>(unit === 'km' ? '190' : '120');
  const [addMargin, setAddMargin] = useState<boolean>(true);

  // Latest vehicle stats
  const [currentSoc, setCurrentSoc] = useState<number>(84);
  const [currentRatedRangeMiles, setCurrentRatedRangeMiles] = useState<number>(234.4);
  const [carName, setCarName] = useState<string>('Tesla Model 3');
  const [vin, setVin] = useState<string>('LRW3F7FS3SC594594');

  const loadLatestStats = useCallback(async () => {
    setLoading(true);
    try {
      if (isManualMode) {
        const mTel = activeVehicle.manualTelemetry;
        const realSoc = mTel?.batteryLevelPct || 80;
        const realRange = mTel?.ratedRangeMiles || 220.0;
        setCurrentSoc(realSoc);
        setCurrentRatedRangeMiles(realRange);
        setCarName(activeVehicle.name || selectedProfile.name);
        setVin(activeVehicle.vin || 'MANUAL-STORAGE');
      } else {
        const isOnline = await checkServerHealth();
        if (isOnline) {
          const data = await fetchServerVehicle();
          if (data?.vehicle) {
            const v = data.vehicle;
            const snap = data.latestSnapshot;
            const realSoc = typeof v.last_soc === 'number' && v.last_soc > 0 ? v.last_soc : (snap?.battery_level_pct || 80);
            const realRange = typeof v.last_rated_range === 'number' && v.last_rated_range > 0 ? v.last_rated_range : (snap?.rated_range_miles || 234.4);

            setCurrentSoc(realSoc);
            setCurrentRatedRangeMiles(realRange);
            setCarName(v.display_name || activeVehicle.name || 'Tesla Model 3');
            setVin(v.vin || 'LRW3F7FS3SC594594');
          }
        } else {
          const snaps = await getSnapshots(1, activeVehicle.id);
          if (snaps.length > 0) {
            const s = snaps[0];
            setCurrentSoc(s.battery_level_pct);
            setCurrentRatedRangeMiles(s.rated_range_miles);
          }
        }
      }
    } catch (err) {
      console.warn('Error loading latest vehicle stats:', err);
    } finally {
      setLoading(false);
    }
  }, [activeVehicle, selectedProfile, isManualMode]);

  useFocusEffect(
    useCallback(() => {
      loadLatestStats();
    }, [loadLatestStats])
  );

  useEffect(() => {
    loadLatestStats();
    const timer = setInterval(() => {
      loadLatestStats();
    }, 60000);
    return () => clearInterval(timer);
  }, [loadLatestStats]);

  // When unit changes, update default input sensibly if it was at previous default
  useEffect(() => {
    setDistanceInput((prev) => {
      const num = parseFloat(prev);
      if (unit === 'km' && num === 120) return '190';
      if (unit === 'miles' && num === 190) return '120';
      return prev;
    });
  }, [unit]);

  // Calculations based on latest returned telemetry
  // Effective 100% range in miles = currentRatedRange / (currentSoc / 100)
  const socFraction = Math.max(0.01, currentSoc / 100);
  const fullMaxRangeMiles = currentRatedRangeMiles / socFraction || 279.0;
  const fullMaxRangeDisplay = toDisplayDistance(fullMaxRangeMiles);

  // User input handling (in chosen unit)
  const enteredDistance = parseFloat(distanceInput) || 0;
  const targetMiles = fromInputDistance(enteredDistance);
  const effectiveMiles = addMargin ? targetMiles * 1.1 : targetMiles;

  const displayTarget = Math.round(enteredDistance * 10) / 10;
  const displayMargin = addMargin ? Math.round(enteredDistance * 0.1 * 10) / 10 : 0;
  const displayEffective = addMargin ? Math.round(enteredDistance * 1.1 * 10) / 10 : displayTarget;

  // Percentage required to achieve the miles - STRICTLY 0 DECIMAL PLACES
  const rawPctNeeded = fullMaxRangeMiles > 0 ? (effectiveMiles / fullMaxRangeMiles) * 100 : 0;
  const pctNeeded = Math.round(rawPctNeeded);
  const isOver100 = pctNeeded > 100;

  // Surplus or Deficit compared to current charge - STRICTLY 0 DECIMAL PLACES
  const currentSocInt = Math.round(currentSoc);
  const socDiff = currentSocInt - pctNeeded;
  const hasEnough = socDiff >= 0;

  // Energy needed (kWh)
  const energyKwhNeeded = Math.round((effectiveMiles * (selectedProfile.whPerMile / 1000)) * 10) / 10;

  // Slider scale: 0 to max calculated range for the car (minus 10% if toggled)
  const sliderMax = addMargin
    ? Math.floor(fullMaxRangeDisplay / 1.1)
    : Math.round(fullMaxRangeDisplay);

  const handleToggleMargin = (newMargin: boolean) => {
    setAddMargin(newMargin);
    if (newMargin) {
      const maxAllowed = Math.floor(fullMaxRangeDisplay / 1.1);
      const current = parseFloat(distanceInput) || 0;
      if (current > maxAllowed) {
        setDistanceInput(String(maxAllowed));
      }
    }
  };

  // Pre-departure charging time & cost (using configured kW rates)
  const missingSoc = Math.max(0, pctNeeded - currentSocInt);
  const missingKwh = (missingSoc / 100) * selectedProfile.nominalCapacityKwh;
  const homeAcHours = missingKwh > 0 && homePowerKw > 0 ? Math.round((missingKwh / homePowerKw) * 10) / 10 : 0;
  const effectiveScKw = Math.max(20, superchargerPowerKw * 0.65);
  const superchargerMins = missingKwh > 0 ? Math.ceil((missingKwh / effectiveScKw) * 60) : 0;

  // Total trip energy replenishment time & cost
  const tripHomeHours = energyKwhNeeded > 0 && homePowerKw > 0 ? Math.round((energyKwhNeeded / homePowerKw) * 10) / 10 : 0;
  const tripSuperchargerMins = energyKwhNeeded > 0 ? Math.ceil((energyKwhNeeded / effectiveScKw) * 60) : 0;

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadLatestStats();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor="#38bdf8"
          colors={['#38bdf8', '#10b981']}
          progressBackgroundColor="#1e293b"
        />
      }
    >
      {/* Screen Header */}
      <View style={styles.header}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.screenTitle}>Range Calculator</Text>
          <Text style={styles.screenSubtitle}>
            Required battery %, charge times & costs
          </Text>
        </View>
        <HeaderStatusBadges />
      </View>

      {/* Live Car Stats Context Card */}
      <View style={styles.contextCard}>
        <View style={styles.contextHeaderRow}>
          <Text style={styles.contextCarName}>{carName}</Text>
        </View>
        <View style={styles.contextStatsRow}>
          <View style={styles.contextStat}>
            <Text style={styles.contextStatLabel}>Current Charge</Text>
            <Text style={styles.contextStatValue}>{currentSocInt}%</Text>
          </View>
          <View style={styles.contextStat}>
            <Text style={styles.contextStatLabel}>Rated Range</Text>
            <Text style={styles.contextStatValue}>
              {toDisplayDistance(currentRatedRangeMiles)} {unitLabel}
            </Text>
          </View>
          <View style={styles.contextStat}>
            <Text style={styles.contextStatLabel}>100% Max Range</Text>
            <Text style={[styles.contextStatValue, { color: '#38bdf8' }]}>
              {fullMaxRangeDisplay} {unitLabel}
            </Text>
          </View>
        </View>
      </View>

      {/* Distance Input Section */}
      <View style={styles.card}>
        <Text style={styles.cardSectionLabel}>
          DESIRED TRIP DISTANCE ({unitLabel.toUpperCase()})
        </Text>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.milesInput}
            value={distanceInput}
            onChangeText={setDistanceInput}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor="#64748b"
          />
          <Text style={styles.milesInputUnit}>{unitLabel.toUpperCase()}</Text>
        </View>

        {/* Slideable Scale (0 to Max Range, minus 10% if toggled) */}
        <RangeSlider
          value={parseFloat(distanceInput) || 0}
          min={0}
          max={sliderMax}
          step={1}
          unitLabel={unitLabel}
          onChange={(val) => setDistanceInput(String(val))}
        />

        {/* 10% Margin Toggle */}
        <View style={styles.marginRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.marginTitle}>Add 10% Safety Margin</Text>
            <Text style={styles.marginSubtitle}>
              Scale max capped at {sliderMax} {unitLabel} so total trip stays within 100% battery
            </Text>
          </View>
          <Switch
            value={addMargin}
            onValueChange={handleToggleMargin}
            trackColor={{ false: '#334155', true: '#0284c7' }}
            thumbColor={addMargin ? '#38bdf8' : '#94a3b8'}
          />
        </View>
      </View>

      {/* Main Result Card */}
      <View
        style={[
          styles.resultCard,
          isOver100
            ? styles.resultCardWarning
            : hasEnough
            ? styles.resultCardSuccess
            : styles.resultCardChargeNeeded,
        ]}
      >
        <Text style={styles.resultCardEyebrow}>REQUIRED BATTERY PERCENTAGE</Text>

        <View style={styles.resultMainRow}>
          <Text style={styles.resultPercentage}>
            {enteredDistance > 0 ? `${pctNeeded}%` : '0%'}
          </Text>
          {enteredDistance > 0 && missingSoc > 0 && (
            <Text style={styles.addedPctBadge}>
              (+{missingSoc}%)
            </Text>
          )}
          {isOver100 && (
            <View style={styles.exceedBadge}>
              <Text style={styles.exceedBadgeText}>EXCEEDS 100%</Text>
            </View>
          )}
        </View>

        {/* Status Callout Banner */}
        {enteredDistance > 0 && (
          <View
            style={[
              styles.statusBanner,
              isOver100
                ? styles.statusBannerWarning
                : hasEnough
                ? styles.statusBannerSuccess
                : styles.statusBannerChargeNeeded,
            ]}
          >
            <Text style={styles.statusBannerText}>
              {isOver100
                ? `⚠️ï¸ This trip (${displayEffective} ${unitLabel}) exceeds your vehicle's 100% full range of ${fullMaxRangeDisplay} ${unitLabel}. You will need to stop and Supercharge along the route.`
                : hasEnough
                ? `✓ Ready to Depart! Your current charge (${currentSocInt}%) is plenty for this trip with a +${socDiff}% safety buffer.`
                : `🔌 Charging Recommended: You need ${pctNeeded}%, but currently have ${currentSocInt}%. Please charge +${missingSoc}% before departing.`}
            </Text>
          </View>
        )}

        {/* Trip Breakdown Grid */}
        <View style={styles.breakdownGrid}>
          <View style={styles.breakdownCol}>
            <Text style={styles.breakdownLabel}>Base Target</Text>
            <Text style={styles.breakdownValue}>
              {displayTarget} {unitLabel}
            </Text>
          </View>
          <View style={styles.breakdownCol}>
            <Text style={styles.breakdownLabel}>Safety Margin</Text>
            <Text style={styles.breakdownValue}>
              {addMargin ? `+${displayMargin} ${unitLabel}` : 'None'}
            </Text>
          </View>
          <View style={styles.breakdownCol}>
            <Text style={styles.breakdownLabel}>Total Planned</Text>
            <Text style={[styles.breakdownValue, { color: '#38bdf8' }]}>
              {displayEffective} {unitLabel}
            </Text>
          </View>
          <View style={styles.breakdownCol}>
            <Text style={styles.breakdownLabel}>Energy Needed</Text>
            <Text style={styles.breakdownValue}>{energyKwhNeeded} kWh</Text>
            {missingKwh > 0 && enteredDistance > 0 && (
              <Text style={styles.breakdownAddedKwh}>
                (+{Math.round(missingKwh * 10) / 10} kWh)
              </Text>
            )}
          </View>
        </View>

        {/* Pre-Departure Charging: Two Columns (Time & Cost Side-by-Side) */}
        {!hasEnough && !isOver100 && enteredDistance > 0 && (
          <View style={styles.chargeSection}>
            <Text style={styles.chargeSectionTitle}>
              PRE-DEPARTURE CHARGE: +{missingSoc}% ({Math.round(missingKwh * 10) / 10} kWh)
            </Text>
            <View style={styles.twoColumnRow}>
              {/* Home AC Column */}
              <View style={styles.columnCard}>
                <View style={styles.columnHeader}>
                  <Text style={styles.columnIcon}>🔌</Text>
                  <View>
                    <Text style={styles.columnName}>Home AC</Text>
                    <Text style={styles.columnSub}>{homePowerKw} kW ({homeRate}{currencySubUnit}/kWh)</Text>
                  </View>
                </View>
                <View style={styles.metricBlock}>
                  <Text style={styles.metricLabel}>CHARGING TIME</Text>
                  <Text style={styles.metricTimeValue}>~{homeAcHours} hrs</Text>
                </View>
                <View style={styles.metricBlock}>
                  <Text style={styles.metricLabel}>ESTIMATED COST</Text>
                  <Text style={[styles.metricCostValue, { color: '#34d399' }]}>
                    {formatCost(calcHomeCost(missingKwh))}
                  </Text>
                </View>
              </View>

              {/* Supercharger Column */}
              <View style={styles.columnCard}>
                <View style={styles.columnHeader}>
                  <Text style={styles.columnIcon}>⚡</Text>
                  <View>
                    <Text style={styles.columnName}>Supercharger</Text>
                    <Text style={styles.columnSub}>{superchargerPowerKw} kW ({superchargerRate}{currencySubUnit}/kWh)</Text>
                  </View>
                </View>
                <View style={styles.metricBlock}>
                  <Text style={styles.metricLabel}>CHARGING TIME</Text>
                  <Text style={styles.metricTimeValue}>~{superchargerMins} mins</Text>
                </View>
                <View style={styles.metricBlock}>
                  <Text style={styles.metricLabel}>ESTIMATED COST</Text>
                  <Text style={[styles.metricCostValue, { color: '#38bdf8' }]}>
                    {formatCost(calcSuperchargerCost(missingKwh))}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Total Journey Energy Refill: Two Columns (Time & Cost Side-by-Side) */}
        {enteredDistance > 0 && (
          <View style={styles.chargeSection}>
            <Text style={styles.chargeSectionTitle}>
              THEORETICAL TRIP FILL ({energyKwhNeeded} kWh)
            </Text>
            <View style={styles.twoColumnRow}>
              {/* Home AC Column */}
              <View style={styles.columnCard}>
                <View style={styles.columnHeader}>
                  <Text style={styles.columnIcon}>🔌</Text>
                  <View>
                    <Text style={styles.columnName}>Home AC</Text>
                    <Text style={styles.columnSub}>{homePowerKw} kW ({homeRate}{currencySubUnit}/kWh)</Text>
                  </View>
                </View>
                <View style={styles.metricBlock}>
                  <Text style={styles.metricLabel}>THEORETICAL FILL TIME</Text>
                  <Text style={styles.metricTimeValue}>~{tripHomeHours} hrs</Text>
                </View>
                <View style={styles.metricBlock}>
                  <Text style={styles.metricLabel}>THEORETICAL FILL COST</Text>
                  <Text style={[styles.metricCostValue, { color: '#34d399' }]}>
                    {formatCost(calcHomeCost(energyKwhNeeded))}
                  </Text>
                </View>
              </View>

              {/* Supercharger Column */}
              <View style={styles.columnCard}>
                <View style={styles.columnHeader}>
                  <Text style={styles.columnIcon}>⚡</Text>
                  <View>
                    <Text style={styles.columnName}>Supercharger</Text>
                    <Text style={styles.columnSub}>{superchargerPowerKw} kW ({superchargerRate}{currencySubUnit}/kWh)</Text>
                  </View>
                </View>
                <View style={styles.metricBlock}>
                  <Text style={styles.metricLabel}>THEORETICAL FILL TIME</Text>
                  <Text style={styles.metricTimeValue}>~{tripSuperchargerMins} mins</Text>
                </View>
                <View style={styles.metricBlock}>
                  <Text style={styles.metricLabel}>THEORETICAL FILL COST</Text>
                  <Text style={[styles.metricCostValue, { color: '#38bdf8' }]}>
                    {formatCost(calcSuperchargerCost(energyKwhNeeded))}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}
      </View>

      {/* Version Footer */}
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
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 16,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f8fafc',
  },
  screenSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
  },
  contextCard: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  contextHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  contextCarName: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 14,
  },
  liveTag: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#10b981',
  },
  liveTagText: {
    color: '#10b981',
    fontSize: 10,
    fontWeight: '800',
  },
  contextStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  contextStat: {
    alignItems: 'center',
  },
  contextStatLabel: {
    color: '#94a3b8',
    fontSize: 11,
  },
  contextStatValue: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 2,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardSectionLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#38bdf8',
    marginBottom: 8,
  },
  milesInput: {
    flex: 1,
    fontSize: 32,
    fontWeight: '900',
    color: '#ffffff',
    padding: 0,
  },
  milesInputUnit: {
    color: '#38bdf8',
    fontWeight: '800',
    fontSize: 16,
  },
  marginRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  marginTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
  },
  marginSubtitle: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  resultCard: {
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1.5,
  },
  resultCardSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  resultCardChargeNeeded: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  resultCardWarning: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  resultCardEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 0.5,
  },
  resultMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  resultPercentage: {
    fontSize: 48,
    fontWeight: '900',
    color: '#f8fafc',
    letterSpacing: -1,
  },
  addedPctBadge: {
    fontSize: 26,
    fontWeight: '800',
    color: '#f59e0b',
    marginLeft: 10,
    alignSelf: 'center',
  },
  exceedBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginLeft: 12,
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  exceedBadgeText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: '800',
  },
  statusBanner: {
    borderRadius: 10,
    padding: 12,
    marginVertical: 10,
  },
  statusBannerSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  statusBannerChargeNeeded: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  statusBannerWarning: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  statusBannerText: {
    color: '#f8fafc',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  breakdownGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  breakdownCol: {
    alignItems: 'center',
  },
  breakdownLabel: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '600',
  },
  breakdownValue: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  breakdownAddedKwh: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 1,
  },
  chargeSection: {
    marginTop: 14,
  },
  chargeSectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  twoColumnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  columnCard: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  columnIcon: {
    fontSize: 18,
  },
  columnName: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '800',
  },
  columnSub: {
    color: '#64748b',
    fontSize: 9,
    fontWeight: '600',
    marginTop: 1,
  },
  metricBlock: {
    marginTop: 6,
  },
  metricLabel: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  metricTimeValue: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
  },
  metricCostValue: {
    fontSize: 15,
    fontWeight: '900',
    marginTop: 2,
  },
  refreshBtn: {
    backgroundColor: '#1e293b',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  refreshBtnText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '700',
  },
});
