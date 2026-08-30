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
import {
  getServerUrl,
  setServerUrl,
  checkServerHealth,
  clearServerDatabase,
  ServerHealth,
  fetchServerVehicle,
  disconnectServerTeslaAccount,
} from '../services/apiClient';
import { useVehicleProfile } from '../context/VehicleProfileContext';
import { useUnit } from '../context/UnitContext';
import { useTariff } from '../context/TariffContext';

export const SettingsScreen: React.FC = () => {
  const { isPremium, toggleMockPremium, priceLabel } = usePremium();
  const { unit, setUnit } = useUnit();
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

  const { selectedProfile, setSelectedProfile, selectProfileById, updateCustomProfile } = useVehicleProfile();
  const selectedProfileIndex = Math.max(0, TESLA_PROFILES.findIndex((p) => p.id === selectedProfile.id));
  const [showModelDropdown, setShowModelDropdown] = useState<boolean>(false);
  const [customNameInput, setCustomNameInput] = useState<string>(selectedProfile.name);
  const [customCapacityInput, setCustomCapacityInput] = useState<string>(String(selectedProfile.nominalCapacityKwh));
  const [customWhMiInput, setCustomWhMiInput] = useState<string>(String(selectedProfile.whPerMile));

  useEffect(() => {
    setCustomNameInput(selectedProfile.name);
    setCustomCapacityInput(String(selectedProfile.nominalCapacityKwh));
    setCustomWhMiInput(String(selectedProfile.whPerMile));
  }, [selectedProfile]);

  const [tokenInput, setTokenInput] = useState<string>('');
  const [hasSavedToken, setHasSavedToken] = useState<boolean>(false);
  const [connectedVehicleName, setConnectedVehicleName] = useState<string>('');
  const [connectedVin, setConnectedVin] = useState<string>('');
  const [snapshotCount, setSnapshotCount] = useState<number>(0);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);

  const [serverUrlInput, setServerUrlInput] = useState<string>(getServerUrl());
  const [serverHealth, setServerHealth] = useState<ServerHealth | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const checkToken = async () => {
    const health = await checkServerHealth();
    setServerHealth(health);

    const token = await getTeslaRefreshToken();
    const serverVehicleData = await fetchServerVehicle();

    const serverLinked = !!serverVehicleData?.isAccountLinked;
    const localLinked = !!token;
    const isConnected = serverLinked || localLinked;

    setHasSavedToken(isConnected);

    if (serverVehicleData?.vehicle) {
      setConnectedVehicleName(serverVehicleData.vehicle.display_name || 'Tesla Model 3');
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
      const snaps = await getSnapshots(500);
      setSnapshotCount(snaps.length);
    }
  };

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.alert(`${title}\n\n${message}`);
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
        `VoltIQ Backend is active.\nUptime: ${health.uptimeSeconds}s\nSnapshots in Server DB: ${health.snapshotCount}\nSmart Poller: Active`
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
  }, []);

  const handleSaveToken = async () => {
    if (!tokenInput.trim()) {
      Alert.alert('Empty Token', 'Please enter a valid Tesla refresh token.');
      return;
    }
    await saveTeslaRefreshToken(tokenInput);
    setHasSavedToken(true);
    Alert.alert('Saved', 'Your Tesla refresh token is securely stored in on-device Keychain/KeyStore.');
  };

  const handleLogoutTesla = async () => {
    const doLogout = async () => {
      await disconnectServerTeslaAccount();
      await clearTeslaCredentials();
      setTokenInput('');
      setHasSavedToken(false);
      setConnectedVehicleName('');
      setConnectedVin('');
      await checkToken();
      showAlert('Tesla Account Disconnected', 'Your Tesla account has been unlinked.');
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

  const handleClearToken = async () => {
    await handleLogoutTesla();
  };

  const handleClearDatabase = async () => {
    const doClear = async () => {
      await clearSnapshots();
      await clearServerDatabase();
      setSnapshotCount(0);
      const health = await checkServerHealth();
      setServerHealth(health);
      showAlert('Database Cleared 🗑️', 'All local and server battery snapshots have been deleted.');
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm('Clear all battery snapshots and historical records from database?')) {
        await doClear();
      }
    } else {
      Alert.alert('Confirm Clear Database', 'Clear all battery snapshots from both your phone and the server database?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase All Data',
          style: 'destructive',
          onPress: doClear,
        },
      ]);
    }
  };

  const handleSeedData = async () => {
    const prof = TESLA_PROFILES[selectedProfileIndex];
    await seedSampleData(prof.nominalCapacityKwh);
    const snaps = await getSnapshots(500);
    setSnapshotCount(snaps.length);
    Alert.alert('Populated', `Added sample snapshots for ${prof.name}.`);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await checkToken();
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
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Settings & Configuration</Text>
        <Text style={styles.screenSubtitle}>BYOK credentials, pack profile, and local storage</Text>
      </View>

      {/* Vehicle Profile Selection & Custom Pack */}
      <Text style={styles.sectionHeader}>Vehicle & Battery Pack</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Tesla Model Preset</Text>
        <Text style={styles.subText}>
          Choose a preset model from the dropdown to auto-fill specs.
        </Text>

        {/* Dropdown Selector Button */}
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
            <Text style={styles.tariffFieldLabel}>Rated Efficiency</Text>
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
            <Text style={styles.tariffSubtext}>EPA / WLTP rating</Text>
          </View>
        </View>
      </View>

      {/* Model Selection Dropdown Modal */}
      <Modal
        visible={showModelDropdown}
        transparent
        animationType="fade"
        onRequestClose={() => setShowModelDropdown(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowModelDropdown(false)}
        >
          <View style={styles.dropdownModalContent}>
            <Text style={styles.dropdownModalTitle}>Select Tesla Model</Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {TESLA_PROFILES.map((p) => {
                const isSelected = selectedProfile.id === p.id;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.dropdownModalItem, isSelected && styles.dropdownModalItemSelected]}
                    onPress={async () => {
                      await selectProfileById(p.id);
                      setCustomNameInput(p.name);
                      setCustomCapacityInput(String(p.nominalCapacityKwh));
                      setCustomWhMiInput(String(p.whPerMile));
                      setShowModelDropdown(false);
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.dropdownItemName, isSelected && styles.dropdownItemNameSelected]}>
                        {p.name}
                      </Text>
                      <Text style={styles.dropdownItemSub}>
                        {p.nominalCapacityKwh} kWh &bull; ~{p.whPerMile} Wh/mi
                      </Text>
                    </View>
                    {isSelected && <Text style={styles.dropdownCheck}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={styles.dropdownCloseBtn}
              onPress={() => setShowModelDropdown(false)}
            >
              <Text style={styles.dropdownCloseBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Units & Measurement */}
      <Text style={styles.sectionHeader}>Units & Measurement</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Distance & Range Unit</Text>
        <Text style={styles.subText}>Select whether distances and range are displayed in miles or kilometers.</Text>

        <View style={styles.unitToggleRow}>
          <TouchableOpacity
            style={[styles.unitToggleBtn, unit === 'miles' && styles.unitToggleBtnActive]}
            onPress={() => setUnit('miles')}
          >
            <Text style={[styles.unitToggleText, unit === 'miles' && styles.unitToggleTextActive]}>
              Miles (mi)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.unitToggleBtn, unit === 'km' && styles.unitToggleBtnActive]}
            onPress={() => setUnit('km')}
          >
            <Text style={[styles.unitToggleText, unit === 'km' && styles.unitToggleTextActive]}>
              Kilometers (km)
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Currency Selection */}
      <Text style={styles.sectionHeader}>Currency & Pricing</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Preferred Currency</Text>
        <Text style={styles.subText}>
          Choose your currency for charging costs and tariff calculations.
        </Text>
        <View style={styles.currencyToggleRow}>
          <TouchableOpacity
            style={[styles.currencyBtn, currency === 'GBP' && styles.currencyBtnActive]}
            onPress={() => setCurrency('GBP')}
          >
            <Text style={[styles.currencyBtnText, currency === 'GBP' && styles.currencyBtnTextActive]}>
              Pounds (£)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.currencyBtn, currency === 'USD' && styles.currencyBtnActive]}
            onPress={() => setCurrency('USD')}
          >
            <Text style={[styles.currencyBtnText, currency === 'USD' && styles.currencyBtnTextActive]}>
              Dollars ($)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.currencyBtn, currency === 'EUR' && styles.currencyBtnActive]}
            onPress={() => setCurrency('EUR')}
          >
            <Text style={[styles.currencyBtnText, currency === 'EUR' && styles.currencyBtnTextActive]}>
              Euros (€)
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Charging Rates & Power (kW) */}
      <Text style={styles.sectionHeader}>Charging Rates & Power (kW)</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Home AC Charging</Text>
        <Text style={styles.subText}>
          Configure your home electricity rate and wallbox power speed.
        </Text>
        <View style={styles.tariffRow}>
          <View style={styles.tariffCol}>
            <Text style={styles.tariffFieldLabel}>Electricity Rate</Text>
            <View style={styles.tariffInputBox}>
              <TextInput
                style={styles.tariffInput}
                value={homeRateInput}
                onChangeText={(t) => {
                  setHomeRateInput(t);
                  const num = parseFloat(t);
                  if (!isNaN(num)) setHomeRate(num);
                }}
                keyboardType="numeric"
                placeholder="7"
                placeholderTextColor="#64748b"
              />
              <Text style={styles.tariffUnitText}>{currencySubUnit} / kWh</Text>
            </View>
            <Text style={styles.tariffSubtext}>e.g. 7{currencySubUnit} (EV overnight)</Text>
          </View>

          <View style={styles.tariffCol}>
            <Text style={styles.tariffFieldLabel}>Power Speed</Text>
            <View style={styles.tariffInputBox}>
              <TextInput
                style={styles.tariffInput}
                value={homeKwInput}
                onChangeText={(t) => {
                  setHomeKwInput(t);
                  const num = parseFloat(t);
                  if (!isNaN(num)) setHomePowerKw(num);
                }}
                keyboardType="numeric"
                placeholder="7.0"
                placeholderTextColor="#64748b"
              />
              <Text style={styles.tariffUnitText}>kW</Text>
            </View>
            <Text style={styles.tariffSubtext}>e.g. 7.0 kW (wallbox)</Text>
          </View>
        </View>

        <View style={{ height: 1, backgroundColor: 'rgba(255, 255, 255, 0.08)', marginVertical: 14 }} />

        <Text style={styles.label}>Tesla Supercharger</Text>
        <Text style={styles.subText}>
          Configure Supercharger rate and peak power speed.
        </Text>
        <View style={styles.tariffRow}>
          <View style={styles.tariffCol}>
            <Text style={styles.tariffFieldLabel}>Supercharging Rate</Text>
            <View style={styles.tariffInputBox}>
              <TextInput
                style={styles.tariffInput}
                value={scRateInput}
                onChangeText={(t) => {
                  setScRateInput(t);
                  const num = parseFloat(t);
                  if (!isNaN(num)) setSuperchargerRate(num);
                }}
                keyboardType="numeric"
                placeholder="45"
                placeholderTextColor="#64748b"
              />
              <Text style={styles.tariffUnitText}>{currencySubUnit} / kWh</Text>
            </View>
            <Text style={styles.tariffSubtext}>e.g. 45{currencySubUnit} (Supercharger)</Text>
          </View>

          <View style={styles.tariffCol}>
            <Text style={styles.tariffFieldLabel}>Power Speed</Text>
            <View style={styles.tariffInputBox}>
              <TextInput
                style={styles.tariffInput}
                value={scKwInput}
                onChangeText={(t) => {
                  setScKwInput(t);
                  const num = parseFloat(t);
                  if (!isNaN(num)) setSuperchargerPowerKw(num);
                }}
                keyboardType="numeric"
                placeholder="150"
                placeholderTextColor="#64748b"
              />
              <Text style={styles.tariffUnitText}>kW</Text>
            </View>
            <Text style={styles.tariffSubtext}>e.g. 150 kW (V2 / V3)</Text>
          </View>
        </View>
      </View>

      {/* Tesla Account & Credentials */}
      <Text style={styles.sectionHeader}>Tesla Account & Credentials</Text>
      <View style={styles.card}>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Connection Status</Text>
          <View style={[styles.statusBadge, hasSavedToken ? styles.statusLive : styles.statusDemo]}>
            <Text style={styles.statusBadgeText}>
              {hasSavedToken ? '● PAIRED' : '○ UNPAIRED'}
            </Text>
          </View>
        </View>

        {hasSavedToken ? (
          <View style={styles.connectedBox}>
            <View style={styles.connectedHeaderRow}>
              <Text style={{ fontSize: 20 }}>🚗</Text>
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text style={styles.connectedVehicleName}>
                  {connectedVehicleName || 'Tesla Model 3'}
                </Text>
                {connectedVin ? (
                  <Text style={styles.connectedVinText}>VIN: {connectedVin}</Text>
                ) : null}
              </View>
            </View>

            <View style={styles.syncStatusRow}>
              <Text style={styles.syncStatusDot}>●</Text>
              <Text style={styles.syncStatusText}>24/7 Sleep-Safe Fleet Sync Active</Text>
            </View>

            <TouchableOpacity style={styles.disconnectTeslaBtn} onPress={handleLogoutTesla}>
              <Text style={styles.disconnectTeslaBtnText}>🔌 Disconnect & Logout Tesla Account</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            {/* In-app Tesla OAuth Login */}
            <TouchableOpacity
              style={styles.teslaLoginBtn}
              onPress={() => setShowLoginModal(true)}
            >
              <Text style={styles.teslaLoginBtnText}>⚡ Sign In with Tesla Account</Text>
            </TouchableOpacity>

            <View style={styles.orRow}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>OR MANUAL TOKEN PASTE</Text>
              <View style={styles.orLine} />
            </View>

            <Text style={styles.inputHelp}>
              Enter your Tesla Refresh Token manually if you already have one. It will be encrypted locally
              using hardware SecureStore.
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Paste Tesla Refresh Token..."
              placeholderTextColor="#64748b"
              value={tokenInput}
              onChangeText={setTokenInput}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveToken}>
                <Text style={styles.saveBtnText}>Save Token</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Premium Tier */}
      <Text style={styles.sectionHeader}>Monetization & License</Text>
      <View style={styles.card}>
        <View style={styles.statusRow}>
          <View>
            <Text style={styles.label}>Premium Status</Text>
            <Text style={styles.subText}>
              {isPremium ? 'Lifetime License Active' : `Free Tier (${priceLabel} one-off upgrade)`}
            </Text>
          </View>
          <View style={[styles.statusBadge, isPremium ? styles.statusLive : styles.statusDemo]}>
            <Text style={styles.statusBadgeText}>{isPremium ? 'PREMIUM' : 'FREE'}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.toggleRow}>
          <View style={styles.toggleTextContainer}>
            <Text style={styles.label}>Developer Mode (Mock Premium)</Text>
            <Text style={styles.subText}>Quickly toggle premium features without native store billing</Text>
          </View>
          <Switch
            value={isPremium}
            onValueChange={toggleMockPremium}
            trackColor={{ false: '#334155', true: '#0284c7' }}
            thumbColor={isPremium ? '#38bdf8' : '#94a3b8'}
          />
        </View>
      </View>

      {/* Backend Server & Smart Poller */}
      <Text style={styles.sectionHeader}>Backend Server & Smart Poller</Text>
      <View style={styles.card}>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Server Status</Text>
          <View style={[styles.statusBadge, serverHealth ? styles.statusLive : styles.statusDemo]}>
            <Text style={styles.statusBadgeText}>
              {serverHealth ? `● CONNECTED (${serverHealth.snapshotCount} SNAPSHOTS)` : '○ OFFLINE (LOCAL FALLBACK)'}
            </Text>
          </View>
        </View>

        <Text style={styles.inputHelp}>
          Configure your VoltIQ backend server URL. When connected, the server uses your Tesla Developer Fleet API credentials, runs the smart post-charge poller, and stores snapshots in a server database.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="http://localhost:3001"
          placeholderTextColor="#64748b"
          value={serverUrlInput}
          onChangeText={setServerUrlInput}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TouchableOpacity style={styles.teslaLoginBtn} onPress={handleTestServer}>
          <Text style={styles.teslaLoginBtnText}>🔌 Test Server Connection</Text>
        </TouchableOpacity>
      </View>

      {/* Database Management */}
      <Text style={styles.sectionHeader}>Database & Telemetry History</Text>
      <View style={styles.card}>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Recorded Snapshots</Text>
          <Text style={styles.boldText}>
            {serverHealth ? `${serverHealth.snapshotCount} server snapshots` : `${snapshotCount} local snapshots`}
          </Text>
        </View>
        <Text style={styles.subText}>
          {serverHealth
            ? 'Snapshots are securely stored in your Oracle Cloud SQLite database and synced 24/7.'
            : 'All telemetry data is saved strictly on-device in SQLite.'}
        </Text>

        <View style={{ marginTop: 14 }}>
          <TouchableOpacity style={styles.dangerBtn} onPress={handleClearDatabase}>
            <Text style={styles.dangerBtnText}>🗑️ Clear All Telemetry Data</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* App Version Footer */}
      <FooterVersion />

      {/* Tesla OAuth Modal */}
      <TeslaLoginModal
        visible={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onSuccess={checkToken}
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
  header: {
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
  sectionHeader: {
    fontSize: 14,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f8fafc',
  },
  subText: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  boldText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#38bdf8',
  },
  profileList: {
    marginTop: 10,
    gap: 8,
  },
  profileItem: {
    padding: 12,
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  profileItemSelected: {
    borderColor: '#38bdf8',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
  },
  profileName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e2e8f0',
  },
  profileNameSelected: {
    color: '#38bdf8',
    fontWeight: '700',
  },
  profileDetails: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusLive: {
    backgroundColor: '#065f46',
  },
  statusDemo: {
    backgroundColor: '#334155',
  },
  statusBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  teslaLoginBtn: {
    backgroundColor: '#0284c7',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 14,
  },
  teslaLoginBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 6,
    gap: 8,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#334155',
  },
  orText: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '700',
  },
  inputHelp: {
    fontSize: 12,
    color: '#94a3b8',
    marginVertical: 10,
    lineHeight: 16,
  },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 12,
    color: '#ffffff',
    fontSize: 13,
    marginBottom: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  saveBtn: {
    backgroundColor: '#334155',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  clearBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  clearBtnText: {
    color: '#ef4444',
    fontWeight: '600',
    fontSize: 13,
  },
  divider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 14,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleTextContainer: {
    flex: 1,
    marginRight: 10,
  },
  secondaryBtn: {
    backgroundColor: '#334155',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  secondaryBtnText: {
    color: '#e2e8f0',
    fontWeight: '600',
    fontSize: 12,
  },
  dangerBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  dangerBtnText: {
    color: '#ef4444',
    fontWeight: '600',
    fontSize: 12,
  },
  unitToggleRow: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 4,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  unitToggleBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  unitToggleBtnActive: {
    backgroundColor: '#0284c7',
  },
  unitToggleText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '700',
  },
  unitToggleTextActive: {
    color: '#ffffff',
  },
  tariffRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  tariffCol: {
    flex: 1,
  },
  tariffFieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 6,
  },
  tariffInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  tariffInput: {
    flex: 1,
    color: '#38bdf8',
    fontSize: 18,
    fontWeight: '800',
    paddingVertical: 8,
  },
  tariffUnitText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  tariffSubtext: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 4,
  },
  currencyToggleRow: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 4,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 4,
  },
  currencyBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  currencyBtnActive: {
    backgroundColor: '#0284c7',
  },
  currencyBtnText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '700',
  },
  currencyBtnTextActive: {
    color: '#ffffff',
  },
  connectedBox: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    marginTop: 6,
  },
  connectedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  connectedVehicleName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#f8fafc',
  },
  connectedVinText: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  syncStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 14,
  },
  syncStatusDot: {
    color: '#10b981',
    fontSize: 10,
    marginRight: 6,
  },
  syncStatusText: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '700',
  },
  disconnectTeslaBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disconnectTeslaBtnText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '700',
  },
  dropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#38bdf8',
    marginTop: 10,
  },
  dropdownSelectedText: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
  },
  dropdownSubText: {
    color: '#38bdf8',
    fontSize: 11,
    marginTop: 2,
  },
  dropdownArrow: {
    color: '#38bdf8',
    fontSize: 12,
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
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#334155',
    marginTop: 4,
  },
  customTextInput: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600',
    paddingVertical: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  dropdownModalContent: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#334155',
  },
  dropdownModalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#f8fafc',
    marginBottom: 12,
    textAlign: 'center',
  },
  dropdownModalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  dropdownModalItemSelected: {
    borderColor: '#38bdf8',
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
  },
  dropdownItemName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e2e8f0',
  },
  dropdownItemNameSelected: {
    color: '#38bdf8',
  },
  dropdownItemSub: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  dropdownCheck: {
    fontSize: 14,
    fontWeight: '800',
    color: '#38bdf8',
    marginLeft: 8,
  },
  dropdownCloseBtn: {
    marginTop: 12,
    backgroundColor: '#334155',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  dropdownCloseBtnText: {
    color: '#e2e8f0',
    fontWeight: '700',
    fontSize: 13,
  },
});
