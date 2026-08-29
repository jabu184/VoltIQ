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
import { getServerUrl, setServerUrl, checkServerHealth, ServerHealth } from '../services/apiClient';
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

  const { selectedProfile, setSelectedProfile } = useVehicleProfile();
  const selectedProfileIndex = Math.max(0, TESLA_PROFILES.findIndex((p) => p.id === selectedProfile.id));
  const [tokenInput, setTokenInput] = useState<string>('');
  const [hasSavedToken, setHasSavedToken] = useState<boolean>(false);
  const [snapshotCount, setSnapshotCount] = useState<number>(0);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);

  const [serverUrlInput, setServerUrlInput] = useState<string>(getServerUrl());
  const [serverHealth, setServerHealth] = useState<ServerHealth | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const checkToken = async () => {
    const health = await checkServerHealth();
    setServerHealth(health);

    const token = await getTeslaRefreshToken();
    if (token) {
      setHasSavedToken(true);
      setTokenInput(token);
    } else {
      setHasSavedToken(false);
      setTokenInput('');
    }
    const snaps = await getSnapshots(500);
    setSnapshotCount(snaps.length);
  };

  const handleTestServer = async () => {
    setServerUrl(serverUrlInput);
    const health = await checkServerHealth();
    setServerHealth(health);
    if (health) {
      Alert.alert(
        'Server Connected! 🟢',
        `VoltIQ Backend is active.\nUptime: ${health.uptimeSeconds}s\nSnapshots in Server DB: ${health.snapshotCount}\nSmart Poller: Active`
      );
    } else {
      Alert.alert(
        'Server Unreachable ⚪',
        `Could not connect to ${serverUrlInput}. Ensure 'npm run server' is running on your machine.`
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

  const handleClearToken = async () => {
    await clearTeslaCredentials();
    setTokenInput('');
    setHasSavedToken(false);
    Alert.alert('Cleared', 'Stored credentials have been erased.');
  };

  const handleClearDatabase = async () => {
    Alert.alert('Confirm Reset', 'Clear all local battery snapshots from SQLite?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Erase All',
        style: 'destructive',
        onPress: async () => {
          await clearSnapshots();
          setSnapshotCount(0);
          Alert.alert('Cleared', 'Database cleared.');
        },
      },
    ]);
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

      {/* Vehicle Profile Selection */}
      <Text style={styles.sectionHeader}>Vehicle & Battery Pack</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Select Your Tesla Model</Text>
        <View style={styles.profileList}>
          {TESLA_PROFILES.map((p, idx) => (
            <TouchableOpacity
              key={p.id}
              style={[
                styles.profileItem,
                selectedProfileIndex === idx && styles.profileItemSelected,
              ]}
              onPress={async () => {
                await setSelectedProfile(p);
                Alert.alert(
                  'Vehicle Profile Updated! ⚡',
                  `Active pack set to ${p.name} (${p.nominalCapacityKwh} kWh nominal).\n\nBattery health, usable capacity, and degradation will now compute against this pack!`
                );
              }}
            >
              <Text
                style={[
                  styles.profileName,
                  selectedProfileIndex === idx && styles.profileNameSelected,
                ]}
              >
                {p.name}
              </Text>
              <Text style={styles.profileDetails}>
                {p.nominalCapacityKwh} kWh &bull; ~{p.whPerMile} Wh/mi
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

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

      {/* BYOK Tesla API Token */}
      <Text style={styles.sectionHeader}>Tesla Account & Credentials</Text>
      <View style={styles.card}>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Connection Mode</Text>
          <View style={[styles.statusBadge, hasSavedToken ? styles.statusLive : styles.statusDemo]}>
            <Text style={styles.statusBadgeText}>
              {hasSavedToken ? '● LIVE TESLA BYOK' : '○ SIMULATED DEMO'}
            </Text>
          </View>
        </View>

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
          using hardware SecureStore and never transmitted to third parties.
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
          {hasSavedToken && (
            <TouchableOpacity style={styles.clearBtn} onPress={handleClearToken}>
              <Text style={styles.clearBtnText}>Disconnect</Text>
            </TouchableOpacity>
          )}
        </View>
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

      {/* Local SQLite Database */}
      <Text style={styles.sectionHeader}>Local Storage (`tesla_battery.db`)</Text>
      <View style={styles.card}>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Recorded Snapshots</Text>
          <Text style={styles.boldText}>{snapshotCount} snapshots</Text>
        </View>
        <Text style={styles.subText}>All telemetry data is saved strictly on-device in SQLite.</Text>

        <View style={[styles.buttonRow, { marginTop: 14 }]}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={handleSeedData}>
            <Text style={styles.secondaryBtnText}>Seed 6M Sample History</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dangerBtn} onPress={handleClearDatabase}>
            <Text style={styles.dangerBtnText}>Clear DB</Text>
          </TouchableOpacity>
        </View>
      </View>

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
});
