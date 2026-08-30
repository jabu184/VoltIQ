import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  Switch,
  RefreshControl,
  Platform,
  Modal,
} from 'react-native';
import {
  getTeslaRefreshToken,
  saveTeslaRefreshToken,
  clearTeslaCredentials,
} from '../services/teslaClient';
import { TESLA_PROFILES, VehicleModelProfile } from '../services/batteryLogic';
import { usePremium } from '../context/PremiumContext';
import { clearSnapshots, seedSampleData, getSnapshots } from '../services/db';
import { TeslaLoginModal } from '../components/TeslaLoginModal';
import { FooterVersion } from '../components/FooterVersion';
import { HeaderStatusBadges } from '../components/HeaderStatusBadges';
import {
  getServerUrl,
  setServerUrl,
  checkServerHealth,
  clearServerDatabase,
  ServerHealth,
  fetchServerVehicle,
  fetchServerSnapshots,
  disconnectServerTeslaAccount,
} from '../services/apiClient';
import { useVehicleProfile, VehicleConfig } from '../context/VehicleProfileContext';
import { useUnit } from '../context/UnitContext';
import { useTariff } from '../context/TariffContext';
import { useFocusEffect } from 'expo-router';

export const SettingsScreen: React.FC = () => {
  const { isPremium, unlockLifetimePremium, restorePurchases, priceLabel } = usePremium();
  const [showPaywall, setShowPaywall] = useState<boolean>(false);
  const {
    unit,
    setUnit,
    efficiencyUnit,
    setEfficiencyUnit,
    efficiencyLabel,
  } = useUnit();
  const {
    currency,
    currencySubUnit,
    setCurrency,
    homeRate,
    superchargerRate,
    setHomeRate,
    setSuperchargerRate,
    homePowerKw,
    superchargerPowerKw,
    setHomePowerKw,
    setSuperchargerPowerKw,
  } = useTariff();

  const [homeRateInput, setHomeRateInput] = useState<string>(String(homeRate));
  const [scRateInput, setScRateInput] = useState<string>(String(superchargerRate));
  const [homeKwInput, setHomeKwInput] = useState<string>(String(homePowerKw));
  const [scKwInput, setScKwInput] = useState<string>(String(superchargerPowerKw));

  useEffect(() => {
    setHomeRateInput(String(homeRate));
  }, [homeRate]);

  useEffect(() => {
    setScRateInput(String(superchargerRate));
  }, [superchargerRate]);

  useEffect(() => {
    setHomeKwInput(String(homePowerKw));
  }, [homePowerKw]);

  useEffect(() => {
    setScKwInput(String(superchargerPowerKw));
  }, [superchargerPowerKw]);

  const {
    vehicles,
    activeVehicle,
    selectedProfile,
    isManualMode,
    setActiveVehicleId,
    addVehicle,
    updateActiveVehicle,
    deleteVehicle,
    setSelectedProfile,
    selectProfileById,
    updateCustomProfile,
  } = useVehicleProfile();

  const [showVehicleModal, setShowVehicleModal] = useState<boolean>(false);
  const [showAddCarModal, setShowAddCarModal] = useState<boolean>(false);
  const [newCarName, setNewCarName] = useState<string>('');
  const [newCarProfileId, setNewCarProfileId] = useState<string>(TESLA_PROFILES[0].id);
  const [newCarIsPaired, setNewCarIsPaired] = useState<boolean>(false);

  const [showModelDropdown, setShowModelDropdown] = useState<boolean>(false);
  const [customNameInput, setCustomNameInput] = useState<string>(activeVehicle.name);
  const [customCapacityInput, setCustomCapacityInput] = useState<string>(String(selectedProfile.nominalCapacityKwh));
  const [customWhMiInput, setCustomWhMiInput] = useState<string>(String(selectedProfile.whPerMile));

  useEffect(() => {
    setCustomNameInput(activeVehicle.name);
    setCustomCapacityInput(String(selectedProfile.nominalCapacityKwh));
    setCustomWhMiInput(String(selectedProfile.whPerMile));
  }, [activeVehicle, selectedProfile]);

  const [tokenInput, setTokenInput] = useState<string>('');
  const [hasSavedToken, setHasSavedToken] = useState<boolean>(false);
  const [connectedVehicleName, setConnectedVehicleName] = useState<string>('');
  const [connectedVin, setConnectedVin] = useState<string>('');
  const [snapshotCount, setSnapshotCount] = useState<number>(0);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);

  const [serverUrlInput, setServerUrlInput] = useState<string>(getServerUrl());
  const [serverHealth, setServerHealth] = useState<ServerHealth | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  useFocusEffect(
    React.useCallback(() => {
      checkToken();
    }, [activeVehicle.id, activeVehicle.isPaired, isManualMode])
  );

  const checkToken = async () => {
    const health = await checkServerHealth();
    setServerHealth(health);

    if (isManualMode || !activeVehicle.isPaired) {
      let snaps = await getSnapshots(2000, activeVehicle.id);
      if (snaps.length === 0 && isPremium && health) {
        const sSnaps = await fetchServerSnapshots(5000);
        if (sSnaps.length > 0) {
          snaps = sSnaps;
        }
      }
      setSnapshotCount(snaps.length);
      setHasSavedToken(false);
      setTokenInput('');
      setConnectedVehicleName('');
      setConnectedVin('');
      return;
    }

    const token = await getTeslaRefreshToken(activeVehicle.id);
    const serverVehicleData = await fetchServerVehicle();

    const serverLinked = !!serverVehicleData?.isAccountLinked;
    const localLinked = !!token;
    const isConnected = serverLinked || localLinked;

    setHasSavedToken(isConnected);

    if (serverVehicleData?.vehicle) {
      setConnectedVehicleName(serverVehicleData.vehicle.display_name || activeVehicle.name || 'Tesla Model 3');
      setConnectedVin(serverVehicleData.vehicle.vin || '');
    }

    if (token) {
      setTokenInput(token);
    } else {
      setTokenInput('');
    }

    if (health) {
      setSnapshotCount(health.snapshotCount);
    } else {
      const snaps = await getSnapshots(500, activeVehicle.id);
      setSnapshotCount(snaps.length);
    }
  };

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.alert(`${title}\\n\\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const handleTestServer = async () => {
    setServerUrl(serverUrlInput);
    const health = await checkServerHealth();
    setServerHealth(health);
    if (health) {
      setSnapshotCount(health.snapshotCount);
      showAlert(
        'Server Connected! 🟢',
        `VoltIQ Backend is active.\\nUptime: ${health.uptimeSeconds}s\\nSnapshots in Server DB: ${health.snapshotCount}\\nSmart Poller: Active`
      );
    } else {
      showAlert(
        'Server Unreachable ⚪',
        `Could not connect to ${serverUrlInput}. Ensure backend is running.`
      );
    }
  };

  useEffect(() => {
    checkToken();
  }, [activeVehicle.id, activeVehicle.isPaired, isManualMode]);

  const handleSaveToken = async () => {
    if (!tokenInput.trim()) {
      Alert.alert('Empty Token', 'Please enter a valid Tesla refresh token.');
      return;
    }
    await saveTeslaRefreshToken(tokenInput, activeVehicle.id);
    await updateActiveVehicle({ isPaired: true });
    setHasSavedToken(true);
    showAlert('Saved', 'Your Tesla refresh token is securely stored on-device for this vehicle.');
  };

  const handleLogoutTesla = async () => {
    const doLogout = async () => {
      await disconnectServerTeslaAccount();
      await clearTeslaCredentials(activeVehicle.id);
      await updateActiveVehicle({ isPaired: false });
      setTokenInput('');
      setHasSavedToken(false);
      setConnectedVehicleName('');
      setConnectedVin('');
      await checkToken();
      showAlert('Tesla Account Disconnected', 'Tesla account unlinked for this vehicle.');
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm('Disconnect your Tesla account and stop automatic 24/7 background telemetry sync?')) {
        await doLogout();
      }
    } else {
      Alert.alert(
        'Disconnect Tesla Account',
        'Disconnect your Tesla account and stop automatic 24/7 background sync?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Disconnect & Logout', style: 'destructive', onPress: doLogout },
        ]
      );
    }
  };

  const handleClearDatabase = async () => {
    const doClear = async () => {
      await clearSnapshots(activeVehicle.id);
      if (!isManualMode) {
        await clearServerDatabase();
      }
      setSnapshotCount(0);
      const health = await checkServerHealth();
      setServerHealth(health);
      showAlert('Database Cleared 🗑️', 'Historical snapshot records for this vehicle have been deleted.');
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm('Clear battery snapshots and records for this vehicle?')) {
        await doClear();
      }
    } else {
      Alert.alert('Confirm Clear Database', 'Clear all battery snapshots for this vehicle?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase Vehicle Data',
          style: 'destructive',
          onPress: doClear,
        },
      ]);
    }
  };

  const handleSeedData = async () => {
    const prof = selectedProfile;
    await seedSampleData(prof.nominalCapacityKwh);
    const snaps = await getSnapshots(500, activeVehicle.id);
    setSnapshotCount(snaps.length);
    Alert.alert('Populated', `Added sample snapshots for ${prof.name}.`);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await checkToken();
    setRefreshing(false);
  };

  const handleCreateNewCar = async () => {
    if (newCarIsPaired && !isPremium) {
      setShowAddCarModal(false);
      setShowPaywall(true);
      return;
    }
    const prof = TESLA_PROFILES.find((p) => p.id === newCarProfileId) || TESLA_PROFILES[0];
    const name = newCarName.trim() || prof.name;
    await addVehicle(name, prof, newCarIsPaired);
    setNewCarName('');
    setShowAddCarModal(false);
    showAlert('Vehicle Added', `Added ${name} in ${newCarIsPaired ? 'Paired' : 'Manual'} mode.`);
  };

  const handleDeleteActiveCar = async () => {
    if (vehicles.length <= 1) {
      showAlert('Cannot Delete', 'You must have at least one vehicle.');
      return;
    }

    const doDelete = async () => {
      await deleteVehicle(activeVehicle.id);
      showAlert('Vehicle Removed', `Deleted ${activeVehicle.name}.`);
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(`Are you sure you want to delete ${activeVehicle.name}?`)) {
        await doDelete();
      }
    } else {
      Alert.alert('Delete Vehicle', `Are you sure you want to delete ${activeVehicle.name}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
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
      <View style={styles.header}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.screenTitle}>Settings</Text>
          <Text style={styles.screenSubtitle}>Vehicles, credentials & pack profiles</Text>
        </View>
        <HeaderStatusBadges isManual={isManualMode} isPaired={hasSavedToken} />
      </View>

      {/* --- TOP ACTIVE VEHICLE SELECTOR --- */}
      <Text style={styles.sectionHeader}>Active Vehicle</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Selected Garage Vehicle</Text>
        <Text style={styles.subText}>
          Switch active vehicle or add multiple cars (manual or Tesla-paired).
        </Text>

        <TouchableOpacity
          style={styles.vehicleSelectorBtn}
          onPress={() => setShowVehicleModal(true)}
          activeOpacity={0.7}
        >
          <View style={{ flex: 1 }}>
            <View style={styles.vehicleBtnHeaderRow}>
              <Text style={styles.vehicleBtnName}>{activeVehicle.name}</Text>
              <View
                style={[
                  styles.vehicleModeBadge,
                  activeVehicle.isPaired ? styles.badgePaired : styles.badgeManual,
                ]}
              >
                <Text
                  style={[
                    styles.vehicleModeBadgeText,
                    activeVehicle.isPaired ? styles.textPaired : styles.textManual,
                  ]}
                >
                  {activeVehicle.isPaired ? '● PAIRED' : '● MANUAL'}
                </Text>
              </View>
            </View>
            <Text style={styles.dropdownSubText}>
              {selectedProfile.nominalCapacityKwh} kWh &bull; ~{selectedProfile.whPerMile} Wh/mi ({vehicles.length} vehicle{vehicles.length > 1 ? 's' : ''} saved)
            </Text>
          </View>
          <Text style={styles.dropdownArrow}>▼</Text>
        </TouchableOpacity>

        {/* Mode Switch for Active Vehicle */}
        <View style={styles.packDivider} />
        <View style={styles.modeToggleRow}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={styles.modeToggleTitle}>Tesla Fleet Paired Mode</Text>
            <Text style={styles.modeToggleSub}>
              {activeVehicle.isPaired
                ? 'Enabled — 24/7 Tesla API telemetry sync and cloud database storage.'
                : 'Disabled — Vehicle is in Manual Mode using local phone storage.'}
            </Text>
          </View>
          <Switch
            value={activeVehicle.isPaired}
            onValueChange={(val) => {
              if (val && !isPremium) {
                setShowPaywall(true);
                return;
              }
              updateActiveVehicle({ isPaired: val });
            }}
            trackColor={{ false: '#64748b', true: '#0284c7' }}
            thumbColor={activeVehicle.isPaired ? '#38bdf8' : '#cbd5e1'}
          />
        </View>

        {vehicles.length > 1 && (
          <TouchableOpacity
            style={styles.deleteVehicleBtn}
            onPress={handleDeleteActiveCar}
          >
            <Text style={styles.deleteVehicleBtnText}>🗑️ Delete This Vehicle</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* --- PREMIUM UPGRADE BANNER (When on Free / Manual tier) --- */}
      {!isPremium && (
        <TouchableOpacity
          style={styles.premiumUnlockCard}
          onPress={() => setShowPaywall(true)}
          activeOpacity={0.8}
        >
          <View style={styles.premiumUnlockHeader}>
            <Text style={styles.premiumUnlockIcon}>⚡</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.premiumUnlockTitle}>Unlock Tesla Fleet 24/7 Sync & Cloud DB</Text>
              <Text style={styles.premiumUnlockSub}>
                Upgrade to TrueBattery Premium ({priceLabel}) to enable automatic 24/7 background telemetry logging, server database storage, and historical degradation curves.
              </Text>
            </View>
          </View>
          <View style={styles.premiumUnlockAction}>
            <Text style={styles.premiumUnlockActionText}>Unlock Lifetime Access ({priceLabel}) →</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* --- TESLA ACCOUNT & FLEET API (Only when Paired Mode is enabled) --- */}
      {activeVehicle.isPaired && isPremium && (
        <>
          <Text style={styles.sectionHeader}>Tesla Account & Fleet API</Text>
          <View style={styles.card}>
            <View style={styles.accountHeaderRow}>
              <View style={styles.accountHeaderLeft}>
                <View
                  style={[
                    styles.statusDot,
                    hasSavedToken ? styles.statusDotConnected : styles.statusDotDisconnected,
                  ]}
                />
                <Text style={styles.accountStatusTitle}>
                  {hasSavedToken ? 'Tesla Account Linked' : 'Not Connected'}
                </Text>
              </View>
              <View
                style={[
                  styles.accountBadge,
                  hasSavedToken ? styles.accountBadgeConnected : styles.accountBadgeDisconnected,
                ]}
              >
                <Text
                  style={[
                    styles.accountBadgeText,
                    hasSavedToken ? styles.accountBadgeTextConnected : styles.accountBadgeTextDisconnected,
                  ]}
                >
                  {hasSavedToken ? 'CONNECTED' : 'DISCONNECTED'}
                </Text>
              </View>
            </View>

            {hasSavedToken ? (
              <View style={styles.connectedBox}>
                <Text style={styles.connectedLabel}>Linked Vehicle</Text>
                <Text style={styles.connectedValue}>
                  {connectedVehicleName || activeVehicle.name || 'Tesla Model 3'}
                </Text>
                {connectedVin ? (
                  <Text style={styles.connectedVin}>VIN: {connectedVin}</Text>
                ) : null}

                <TouchableOpacity
                  style={styles.logoutBtn}
                  onPress={handleLogoutTesla}
                >
                  <Text style={styles.logoutBtnText}>Disconnect & Logout</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.subText}>
                  Connect your Tesla account to enable automated background telemetry polling and real-time charging insights.
                </Text>

                <TouchableOpacity
                  style={styles.loginBtn}
                  onPress={() => setShowLoginModal(true)}
                >
                  <Text style={styles.loginBtnText}>⚡ Sign In with Tesla</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </>
      )}

      {/* --- VEHICLE & BATTERY PACK SPECS --- */}
      <Text style={styles.sectionHeader}>Vehicle & Battery Pack Specs</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Tesla Model Preset</Text>
        <Text style={styles.subText}>
          Choose a preset model from the dropdown to auto-fill specs.
        </Text>

        <TouchableOpacity
          style={styles.dropdownBtn}
          onPress={() => setShowModelDropdown(true)}
          activeOpacity={0.7}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.dropdownSelectedText}>{selectedProfile.name}</Text>
            <Text style={styles.dropdownSubText}>
              {selectedProfile.nominalCapacityKwh} kWh &bull; ~{selectedProfile.whPerMile} Wh/mi
            </Text>
          </View>
          <Text style={styles.dropdownArrow}>▼</Text>
        </TouchableOpacity>

        <View style={styles.packDivider} />

        <Text style={[styles.label, { marginTop: 8 }]}>Adjust Vehicle Specs</Text>
        <Text style={styles.subText}>
          Fine-tune the model name, usable capacity, or rated consumption below.
        </Text>

        <View style={{ marginTop: 10 }}>
          <Text style={styles.tariffFieldLabel}>Vehicle / Pack Name</Text>
          <View style={styles.customInputBox}>
            <TextInput
              style={styles.customTextInput}
              value={customNameInput}
              onChangeText={(t) => {
                setCustomNameInput(t);
                updateActiveVehicle({ name: t });
                updateCustomProfile({ name: t });
              }}
              placeholder="Tesla Model Name"
              placeholderTextColor="#64748b"
            />
          </View>
        </View>

        <View style={[styles.tariffRow, { marginTop: 12 }]}>
          <View style={styles.tariffCol}>
            <Text style={styles.tariffFieldLabel}>Nominal Capacity</Text>
            <View style={styles.tariffInputBox}>
              <TextInput
                style={styles.tariffInput}
                value={customCapacityInput}
                onChangeText={(t) => {
                  setCustomCapacityInput(t);
                  const num = parseFloat(t);
                  if (!isNaN(num) && num > 0) {
                    updateCustomProfile({ nominalCapacityKwh: num });
                  }
                }}
                keyboardType="numeric"
                placeholder="60.0"
                placeholderTextColor="#64748b"
              />
              <Text style={styles.tariffUnitText}>kWh</Text>
            </View>
            <Text style={styles.tariffSubtext}>Usable pack size</Text>
          </View>

          <View style={styles.tariffCol}>
            <Text style={styles.tariffFieldLabel}>Rated Consumption</Text>
            <View style={styles.tariffInputBox}>
              <TextInput
                style={styles.tariffInput}
                value={customWhMiInput}
                onChangeText={(t) => {
                  setCustomWhMiInput(t);
                  const num = parseFloat(t);
                  if (!isNaN(num) && num > 0) {
                    updateCustomProfile({ whPerMile: num });
                  }
                }}
                keyboardType="numeric"
                placeholder="220"
                placeholderTextColor="#64748b"
              />
              <Text style={styles.tariffUnitText}>Wh/mi</Text>
            </View>
            <Text style={styles.tariffSubtext}>EPA benchmark</Text>
          </View>
        </View>
      </View>

      {/* --- DISPLAY & UNIT PREFERENCES --- */}
      <Text style={styles.sectionHeader}>Display & Units</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Distance Unit</Text>
        <Text style={styles.subText}>
          Choose your preferred measurement unit for range and odometer.
        </Text>
        <View style={styles.unitToggleContainer}>
          <TouchableOpacity
            style={[styles.unitButton, unit === 'miles' && styles.unitButtonActive]}
            onPress={() => setUnit('miles')}
          >
            <Text style={[styles.unitButtonText, unit === 'miles' && styles.unitButtonTextActive]}>
              Miles (mi)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.unitButton, unit === 'km' && styles.unitButtonActive]}
            onPress={() => setUnit('km')}
          >
            <Text style={[styles.unitButtonText, unit === 'km' && styles.unitButtonTextActive]}>
              Kilometers (km)
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.packDivider} />

        <Text style={[styles.label, { marginTop: 10 }]}>Efficiency Display Unit</Text>
        <Text style={styles.subText}>
          Choose how vehicle energy efficiency is displayed across the app.
        </Text>
        <View style={styles.unitToggleContainer}>
          <TouchableOpacity
            style={[
              styles.unitButton,
              efficiencyUnit === 'distance_per_kwh' && styles.unitButtonActive,
            ]}
            onPress={() => setEfficiencyUnit('distance_per_kwh')}
          >
            <Text
              style={[
                styles.unitButtonText,
                efficiencyUnit === 'distance_per_kwh' && styles.unitButtonTextActive,
              ]}
            >
              {unit === 'km' ? 'km/kWh' : 'mi/kWh'} (Distance/kWh)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.unitButton,
              efficiencyUnit === 'energy_per_distance' && styles.unitButtonActive,
            ]}
            onPress={() => setEfficiencyUnit('energy_per_distance')}
          >
            <Text
              style={[
                styles.unitButtonText,
                efficiencyUnit === 'energy_per_distance' && styles.unitButtonTextActive,
              ]}
            >
              {unit === 'km' ? 'Wh/km' : 'Wh/mi'} (Energy/Distance)
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* --- ELECTRICITY TARIFFS --- */}
      <Text style={styles.sectionHeader}>Electricity Tariffs & Charging Costs</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Currency</Text>
        <Text style={styles.subText}>Used for trip costs and charge estimations.</Text>
        <View style={styles.currencyToggleRow}>
          {(['GBP', 'USD', 'EUR'] as const).map((currCode) => {
            const sym = currCode === 'GBP' ? '£' : currCode === 'USD' ? '$' : '€';
            return (
              <TouchableOpacity
                key={currCode}
                style={[styles.currencyBtn, currency === currCode && styles.currencyBtnActive]}
                onPress={() => setCurrency(currCode)}
              >
                <Text style={[styles.currencyBtnText, currency === currCode && styles.currencyBtnTextActive]}>
                  {sym} {currCode}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.tariffRow}>
          <View style={styles.tariffCol}>
            <Text style={styles.tariffFieldLabel}>Home Off-Peak Tariff</Text>
            <View style={styles.tariffInputBox}>
              <TextInput
                style={styles.tariffInput}
                value={homeRateInput}
                onChangeText={(t) => {
                  setHomeRateInput(t);
                  const num = parseFloat(t);
                  if (!isNaN(num) && num >= 0) setHomeRate(num);
                }}
                keyboardType="numeric"
                placeholder="7.5"
                placeholderTextColor="#64748b"
              />
              <Text style={styles.tariffUnitText}>{currencySubUnit}/kWh</Text>
            </View>
            <Text style={styles.tariffSubtext}>e.g. Octopus EV Night</Text>
          </View>

          <View style={styles.tariffCol}>
            <Text style={styles.tariffFieldLabel}>Supercharger Tariff</Text>
            <View style={styles.tariffInputBox}>
              <TextInput
                style={styles.tariffInput}
                value={scRateInput}
                onChangeText={(t) => {
                  setScRateInput(t);
                  const num = parseFloat(t);
                  if (!isNaN(num) && num >= 0) setSuperchargerRate(num);
                }}
                keyboardType="numeric"
                placeholder="42"
                placeholderTextColor="#64748b"
              />
              <Text style={styles.tariffUnitText}>{currencySubUnit}/kWh</Text>
            </View>
            <Text style={styles.tariffSubtext}>DC Fast Charging</Text>
          </View>
        </View>
      </View>

      {/* --- DATA STORAGE & MANAGEMENT --- */}
      <Text style={styles.sectionHeader}>Data Storage & Diagnostics</Text>
      <View style={styles.card}>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Historical Snapshots</Text>
          <Text style={styles.statValue}>{snapshotCount}</Text>
        </View>

        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={handleSeedData}>
            <Text style={styles.secondaryBtnText}>⚡ Populate Sample Data</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.dangerBtn} onPress={handleClearDatabase}>
            <Text style={styles.dangerBtnText}>🗑️ Clear Database</Text>
          </TouchableOpacity>
        </View>
      </View>

      
      {/* --- VOLTIQ CLOUD SERVER & BACKEND CONNECTION --- */}
      <Text style={styles.sectionHeader}>VoltIQ Cloud Server Connection</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Backend Server URL</Text>
        <Text style={styles.subText}>
          VoltIQ server managing 24/7 background telemetry sync and central database storage.
        </Text>

        <View style={styles.serverStatusRow}>
          <View
            style={[
              styles.statusDot,
              serverHealth ? styles.statusDotConnected : styles.statusDotDisconnected,
            ]}
          />
          <Text style={styles.serverStatusText}>
            {serverHealth
              ? `Connected 🟢 (DB: ${serverHealth.snapshotCount} logs, Uptime: ${serverHealth.uptimeSeconds}s)`
              : 'Server Unreachable / Offline ⚪'}
          </Text>
        </View>

        <View style={[styles.customInputBox, { marginTop: 10, marginBottom: 12 }]}>
          <TextInput
            style={styles.customTextInput}
            value={serverUrlInput}
            onChangeText={setServerUrlInput}
            placeholder="http://145.241.192.121:3001"
            placeholderTextColor="#64748b"
            autoCapitalize="none"
          />
        </View>

        <TouchableOpacity
          style={styles.testServerBtn}
          onPress={handleTestServer}
        >
          <Text style={styles.testServerBtnText}>⚡ Test Server Connection</Text>
        </TouchableOpacity>
      </View>

      {/* --- GARAGE VEHICLE SELECTOR MODAL --- */}
      <Modal
        visible={showVehicleModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowVehicleModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>🚗 Garage Vehicles</Text>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setShowVehicleModal(false)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalList} showsVerticalScrollIndicator={false}>
              {vehicles.map((v) => {
                const isCurrent = v.id === activeVehicle.id;
                return (
                  <TouchableOpacity
                    key={v.id}
                    style={[
                      styles.vehicleOptionItem,
                      isCurrent && styles.vehicleOptionItemActive,
                    ]}
                    onPress={async () => {
                      await setActiveVehicleId(v.id);
                      setShowVehicleModal(false);
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={styles.vehicleItemHeaderRow}>
                        <Text
                          style={[
                            styles.vehicleItemName,
                            isCurrent && styles.vehicleItemNameActive,
                          ]}
                        >
                          {v.name}
                        </Text>
                        <View
                          style={[
                            styles.vehicleModeBadge,
                            v.isPaired ? styles.badgePaired : styles.badgeManual,
                          ]}
                        >
                          <Text
                            style={[
                              styles.vehicleModeBadgeText,
                              v.isPaired ? styles.textPaired : styles.textManual,
                            ]}
                          >
                            {v.isPaired ? 'PAIRED' : 'MANUAL'}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.vehicleItemSub}>
                        {v.profile.name} &bull; {v.profile.nominalCapacityKwh} kWh
                      </Text>
                    </View>
                    {isCurrent && <Text style={styles.checkMark}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.addCarBtn}
                onPress={() => {
                  setShowVehicleModal(false);
                  setShowAddCarModal(true);
                }}
              >
                <Text style={styles.addCarBtnText}>+ Add New Vehicle</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* --- ADD NEW VEHICLE MODAL --- */}
      <Modal
        visible={showAddCarModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowAddCarModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>+ Add Vehicle to Garage</Text>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setShowAddCarModal(false)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalList} showsVerticalScrollIndicator={false}>
              <Text style={styles.tariffFieldLabel}>Vehicle Name / Nickname</Text>
              <View style={[styles.customInputBox, { marginBottom: 14 }]}>
                <TextInput
                  style={styles.customTextInput}
                  value={newCarName}
                  onChangeText={setNewCarName}
                  placeholder="e.g. Family Model Y"
                  placeholderTextColor="#64748b"
                />
              </View>

              <Text style={styles.tariffFieldLabel}>Tesla Model Preset</Text>
              {TESLA_PROFILES.map((p) => {
                const isSelected = p.id === newCarProfileId;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[
                      styles.modelOptionItem,
                      isSelected && styles.modelOptionItemActive,
                    ]}
                    onPress={() => setNewCarProfileId(p.id)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modelOptionName, isSelected && styles.modelOptionNameActive]}>
                        {p.name}
                      </Text>
                      <Text style={styles.modelOptionSub}>
                        {p.nominalCapacityKwh} kWh &bull; ~{p.whPerMile} Wh/mi
                      </Text>
                    </View>
                    {isSelected && <Text style={styles.checkMark}>✓</Text>}
                  </TouchableOpacity>
                );
              })}

              <View style={[styles.modeToggleRow, { marginTop: 14 }]}>
                <View style={{ flex: 1, marginRight: 10 }}>
                  <Text style={styles.modeToggleTitle}>
                    {newCarIsPaired ? 'Tesla Fleet API Mode' : 'Manual Mode (Phone Storage)'}
                  </Text>
                  <Text style={styles.modeToggleSub}>
                    {newCarIsPaired
                      ? 'Will sync with server and Tesla Fleet API.'
                      : 'Store logs directly on phone offline.'}
                  </Text>
                </View>
                <Switch
                  value={newCarIsPaired}
                  onValueChange={(val) => {
                    if (val && !isPremium) {
                      setShowAddCarModal(false);
                      setShowPaywall(true);
                      return;
                    }
                    setNewCarIsPaired(val);
                  }}
                  trackColor={{ false: '#64748b', true: '#0284c7' }}
                  thumbColor={newCarIsPaired ? '#38bdf8' : '#cbd5e1'}
                />
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleCreateNewCar}
              >
                <Text style={styles.saveBtnText}>Save Vehicle</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* --- MODEL PRESET DROPDOWN MODAL --- */}
      <Modal
        visible={showModelDropdown}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowModelDropdown(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Tesla Model</Text>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setShowModelDropdown(false)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalList} showsVerticalScrollIndicator={false}>
              {TESLA_PROFILES.map((p) => {
                const isSelected = p.id === selectedProfile.id;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[
                      styles.modelOptionItem,
                      isSelected && styles.modelOptionItemActive,
                    ]}
                    onPress={() => {
                      selectProfileById(p.id);
                      setShowModelDropdown(false);
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.modelOptionName,
                          isSelected && styles.modelOptionNameActive,
                        ]}
                      >
                        {p.name}
                      </Text>
                      <Text style={styles.modelOptionSub}>
                        {p.nominalCapacityKwh} kWh &bull; ~{p.whPerMile} Wh/mi
                      </Text>
                    </View>
                    {isSelected && <Text style={styles.checkMark}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Tesla OAuth Modal */}
      <TeslaLoginModal
        visible={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onSuccess={checkToken}
      />

      {/* Version footer */}
      
      {/* --- PAYWALL UPGRADE MODAL --- */}
      <Modal visible={showPaywall} transparent animationType="slide" onRequestClose={() => setShowPaywall(false)}>
        <View style={styles.paywallOverlay}>
          <View style={styles.paywallModalContent}>
            <Text style={styles.paywallBadge}>⚡ ONE-OFF LIFETIME UNLOCK</Text>
            <Text style={styles.paywallTitle}>TrueBattery Premium</Text>
            <Text style={styles.paywallSubtitle}>
              One payment of {priceLabel}. No monthly subscriptions.
            </Text>

            <View style={styles.featureList}>
              <View style={styles.featureItem}>
                <Text style={styles.featureCheck}>✓</Text>
                <Text style={styles.featureText}>Full historical degradation curves & multi-axis trend graphs</Text>
              </View>
              <View style={styles.featureItem}>
                <Text style={styles.featureCheck}>✓</Text>
                <Text style={styles.featureText}>24/7 Tesla Fleet API syncing & cloud database storage</Text>
              </View>
              <View style={styles.featureItem}>
                <Text style={styles.featureCheck}>✓</Text>
                <Text style={styles.featureText}>Unlimited AutoTrader & eBay Resale PDF Certificates</Text>
              </View>
              <View style={styles.featureItem}>
                <Text style={styles.featureCheck}>✓</Text>
                <Text style={styles.featureText}>Multi-car garage with paired & manual vehicles</Text>
              </View>
              <View style={styles.featureItem}>
                <Text style={styles.featureCheck}>✓</Text>
                <Text style={styles.featureText}>100% Zero recurring monthly subscriptions</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.paywallBtn}
              onPress={async () => {
                const ok = await unlockLifetimePremium();
                if (ok) {
                  setShowPaywall(false);
                  Alert.alert('Unlocked! 🎉', 'You now have full Lifetime access to Tesla Fleet syncing, historical graphs, and cloud database.');
                }
              }}
            >
              <Text style={styles.paywallBtnText}>Unlock Lifetime Access ({priceLabel})</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.restoreBtn}
              onPress={async () => {
                const res = await restorePurchases();
                if (res) {
                  setShowPaywall(false);
                  Alert.alert('Restored', 'Your lifetime purchase has been restored.');
                } else {
                  Alert.alert('Notice', 'No previous purchases found.');
                }
              }}
            >
              <Text style={styles.restoreBtnText}>Restore Previous Purchase</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.paywallCloseBtn}
              onPress={() => setShowPaywall(false)}
            >
              <Text style={styles.paywallCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <FooterVersion />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  serverStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    marginBottom: 4,
  },
  serverStatusText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#e2e8f0',
  },
  testServerBtn: {
    backgroundColor: '#0284c7',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  testServerBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },

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
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingTop: 8,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.5,
  },
  screenSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 2,
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: '700',
    color: '#38bdf8',
    marginTop: 16,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  subText: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
    marginBottom: 12,
    lineHeight: 18,
  },
  vehicleSelectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  vehicleBtnHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  vehicleBtnName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  vehicleModeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgePaired: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: '#38bdf8',
  },
  badgeManual: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: '#f59e0b',
  },
  vehicleModeBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  textPaired: {
    color: '#38bdf8',
  },
  textManual: {
    color: '#f59e0b',
  },
  modeToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  modeToggleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e2e8f0',
  },
  modeToggleSub: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  deleteVehicleBtn: {
    marginTop: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    alignItems: 'center',
  },
  deleteVehicleBtnText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '700',
  },
  dropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  dropdownSelectedText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  dropdownSubText: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  dropdownArrow: {
    fontSize: 12,
    color: '#64748b',
    marginLeft: 8,
  },
  packDivider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 14,
  },
  customInputBox: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    marginTop: 6,
  },
  customTextInput: {
    height: 44,
    color: '#ffffff',
    fontSize: 14,
  },
  unitToggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderRadius: 10,
    padding: 4,
    marginTop: 8,
  },
  unitButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  unitButtonActive: {
    backgroundColor: '#0284c7',
  },
  unitButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94a3b8',
  },
  unitButtonTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  currencyToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  currencyBtn: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
  },
  currencyBtnActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: '#38bdf8',
  },
  currencyBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94a3b8',
  },
  currencyBtnTextActive: {
    color: '#38bdf8',
    fontWeight: '700',
  },
  tariffRow: {
    flexDirection: 'row',
    gap: 12,
  },
  tariffCol: {
    flex: 1,
  },
  tariffFieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#cbd5e1',
    marginBottom: 6,
  },
  tariffInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
  },
  tariffInput: {
    flex: 1,
    height: 42,
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  tariffUnitText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
    marginLeft: 4,
  },
  tariffSubtext: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
  },
  accountHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  accountHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusDotConnected: {
    backgroundColor: '#10b981',
  },
  statusDotDisconnected: {
    backgroundColor: '#64748b',
  },
  accountStatusTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  accountBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  accountBadgeConnected: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10b981',
  },
  accountBadgeDisconnected: {
    backgroundColor: '#0f172a',
    borderColor: '#64748b',
  },
  accountBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  accountBadgeTextConnected: {
    color: '#10b981',
  },
  accountBadgeTextDisconnected: {
    color: '#94a3b8',
  },
  connectedBox: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  connectedLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  connectedValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    marginTop: 2,
  },
  connectedVin: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 2,
  },
  logoutBtn: {
    marginTop: 12,
    backgroundColor: '#334155',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  logoutBtnText: {
    color: '#f87171',
    fontSize: 13,
    fontWeight: '700',
  },
  loginBtn: {
    backgroundColor: '#0284c7',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  loginBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  statLabel: {
    fontSize: 14,
    color: '#94a3b8',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: '#334155',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  dangerBtn: {
    flex: 1,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    alignItems: 'center',
  },
  dangerBtnText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    padding: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#334155',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  modalCloseBtn: {
    padding: 8,
    backgroundColor: '#0f172a',
    borderRadius: 16,
  },
  modalCloseText: {
    color: '#94a3b8',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalList: {
    marginBottom: 16,
  },
  vehicleOptionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#0f172a',
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  vehicleOptionItemActive: {
    borderColor: '#38bdf8',
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
  },
  vehicleItemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  vehicleItemName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#e2e8f0',
  },
  vehicleItemNameActive: {
    color: '#38bdf8',
  },
  vehicleItemSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  modelOptionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#0f172a',
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modelOptionItemActive: {
    borderColor: '#38bdf8',
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
  },
  modelOptionName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#e2e8f0',
  },
  modelOptionNameActive: {
    color: '#38bdf8',
  },
  modelOptionSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  checkMark: {
    fontSize: 18,
    color: '#38bdf8',
    fontWeight: 'bold',
    marginLeft: 10,
  },
  modalFooter: {
    paddingTop: 10,
  },
  addCarBtn: {
    backgroundColor: '#0284c7',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  addCarBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  saveBtn: {
    backgroundColor: '#10b981',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },

  premiumUnlockCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#0284c7',
  },
  premiumUnlockHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  premiumUnlockIcon: {
    fontSize: 24,
  },
  premiumUnlockTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#38bdf8',
    marginBottom: 4,
  },
  premiumUnlockSub: {
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 17,
  },
  premiumUnlockAction: {
    marginTop: 12,
    backgroundColor: '#0284c7',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  premiumUnlockActionText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  paywallOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  paywallModalContent: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#1e293b',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#38bdf8',
    alignItems: 'center',
  },
  paywallBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: '#38bdf8',
    letterSpacing: 1.5,
    marginBottom: 8,
    textAlign: 'center',
  },
  paywallTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 4,
    textAlign: 'center',
  },
  paywallSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 20,
  },
  featureList: {
    width: '100%',
    marginBottom: 24,
    gap: 12,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  featureCheck: {
    fontSize: 14,
    color: '#10b981',
    fontWeight: '800',
  },
  featureText: {
    fontSize: 13,
    color: '#e2e8f0',
    flex: 1,
    lineHeight: 18,
  },
  paywallBtn: {
    width: '100%',
    backgroundColor: '#0284c7',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  paywallBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  restoreBtn: {
    paddingVertical: 8,
    marginBottom: 8,
  },
  restoreBtnText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  paywallCloseBtn: {
    paddingVertical: 6,
  },
  paywallCloseText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '600',
  },

});
