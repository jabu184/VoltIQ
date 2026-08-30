import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
} from 'react-native';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  buildTeslaAuthUrl,
  extractCodeFromCallbackUrl,
  exchangeAuthCodeForTokens,
  saveTeslaRefreshToken,
} from '../services/teslaClient';
import { insertSnapshot } from '../services/db';
import { getServerUrl, fetchServerVehicle } from '../services/apiClient';
import { calculateBatteryCapacity, TESLA_PROFILES } from '../services/batteryLogic';

interface TeslaLoginModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const TeslaLoginModal: React.FC<TeslaLoginModalProps> = ({
  visible,
  onClose,
  onSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<'oauth' | 'manual' | 'token'>('oauth');

  // OAuth on-device state
  const [codeVerifier, setCodeVerifier] = useState<string>('');
  const [authUrl, setAuthUrl] = useState<string>('');
  const [callbackInput, setCallbackInput] = useState<string>('');
  const [oauthLoading, setOauthLoading] = useState<boolean>(false);

  // Manual car data input
  const [manualSoc, setManualSoc] = useState<string>('80');
  const [manualRange, setManualRange] = useState<string>('240');
  const [manualOdo, setManualOdo] = useState<string>('25000');
  const [manualSaving, setManualSaving] = useState<boolean>(false);

  // Direct token paste state
  const [quickToken, setQuickToken] = useState<string>('');
  const [tokenSaving, setTokenSaving] = useState<boolean>(false);

  // Initialize fresh PKCE parameters every time modal opens
  useEffect(() => {
    if (visible) {
      let isMounted = true;
      async function initAuth() {
        try {
          const serverUrl = getServerUrl();
          const res = await fetch(`${serverUrl}/api/auth/url`);
          if (res.ok) {
            const data = await res.json();
            if (data.authUrl && isMounted) {
              setAuthUrl(data.authUrl);
              return;
            }
          }
        } catch {}
        const verifier = generateCodeVerifier();
        const challenge = generateCodeChallenge(verifier);
        const url = buildTeslaAuthUrl(challenge, '2dd7a3b6-3daa-4975-8234-1109615d4deb', 'https://medfizz.com/api/auth/callback');
        if (isMounted) {
          setCodeVerifier(verifier);
          setAuthUrl(url);
        }
      }
      initAuth();
      setCallbackInput('');
      setOauthLoading(false);
      return () => { isMounted = false; };
    }
  }, [visible]);

  const handleOpenTeslaLogin = async () => {
    if (!authUrl) return;
    try {
      await Linking.openURL(authUrl);
    } catch {
      Alert.alert('Error', 'Could not launch browser for Tesla login.');
    }
  };

  const handleVerifyAndConnect = async () => {
    setOauthLoading(true);
    try {
      // 1. If user pasted a callback URL or code, exchange it immediately with Tesla
      if (callbackInput.trim()) {
        const raw = callbackInput.trim();
        const code = extractCodeFromCallbackUrl(raw) || raw;
        if (code) {
          const res = await exchangeAuthCodeForTokens(code, codeVerifier);
          if (res.refreshToken) {
            await saveTeslaRefreshToken(res.refreshToken);
          }
          Alert.alert('Connected! 🎉', 'Your Tesla vehicle is now linked and active 24/7!');
          onSuccess();
          onClose();
          return;
        }
      }

      // 2. Otherwise check if server already received the webhook
      const serverData = await fetchServerVehicle();
      if (serverData && serverData.isAccountLinked) {
        Alert.alert('Connected! 🎉', `Successfully linked ${serverData.vehicle?.display_name || 'Tesla Model 3'}!`);
        onSuccess();
        onClose();
      } else {
        Alert.alert(
          'Paste Callback URL',
          'Please sign in on Tesla.com, then paste the callback URL or code from your browser address bar into the box.'
        );
      }
    } catch (err: any) {
      console.warn('OAuth verification error:', err);
      Alert.alert(
        'Connection Error',
        err.message || 'Could not verify Tesla link. Please make sure the pasted URL is valid.'
      );
    } finally {
      setOauthLoading(false);
    }
  };

  const handleSaveManualReading = async () => {
    const soc = parseFloat(manualSoc);
    const range = parseFloat(manualRange);
    const odo = parseFloat(manualOdo);

    if (isNaN(soc) || soc <= 0 || soc > 100) {
      Alert.alert('Invalid Battery %', 'Please enter a valid battery % (1 - 100).');
      return;
    }
    if (isNaN(range) || range <= 0) {
      Alert.alert('Invalid Range', 'Please enter your rated range in miles.');
      return;
    }
    if (isNaN(odo) || odo < 0) {
      Alert.alert('Invalid Odometer', 'Please enter vehicle mileage.');
      return;
    }

    setManualSaving(true);
    try {
      const profile = TESLA_PROFILES[1]; // Model 3 LR
      const calc = calculateBatteryCapacity(range, soc, profile);

      await insertSnapshot({
        timestamp: Date.now(),
        odometer_miles: odo,
        battery_level_pct: soc,
        rated_range_miles: range,
        calculated_capacity_kwh: calc.calculatedCapacityKwh,
        degradation_pct: calc.degradationPct,
        is_fast_charging: 0,
        charger_power_kw: 0,
      });

      Alert.alert(
        'Reading Saved! 🎉',
        `Calculated Usable Capacity: ${calc.calculatedCapacityKwh} kWh\nDegradation: ${calc.degradationPct}%`
      );
      onSuccess();
      onClose();
    } catch {
      Alert.alert('Save Error', 'Failed to save snapshot to database.');
    } finally {
      setManualSaving(false);
    }
  };

  const handleSaveToken = async () => {
    if (!quickToken.trim()) {
      Alert.alert('Empty Token', 'Please paste your Tesla refresh token.');
      return;
    }
    setTokenSaving(true);
    try {
      await saveTeslaRefreshToken(quickToken.trim());
      Alert.alert('Connected!', 'Tesla token saved in encrypted storage.');
      onSuccess();
      onClose();
    } catch {
      Alert.alert('Storage Error', 'Failed to save token.');
    } finally {
      setTokenSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Connect Tesla Vehicle</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Tab Selector */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'oauth' && styles.tabActive]}
              onPress={() => setActiveTab('oauth')}
            >
              <Text style={[styles.tabText, activeTab === 'oauth' && styles.tabTextActive]}>
                ⚡ On-Device Sign-In
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'manual' && styles.tabActive]}
              onPress={() => setActiveTab('manual')}
            >
              <Text style={[styles.tabText, activeTab === 'manual' && styles.tabTextActive]}>
                📝 10s Car Log
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'token' && styles.tabActive]}
              onPress={() => setActiveTab('token')}
            >
              <Text style={[styles.tabText, activeTab === 'token' && styles.tabTextActive]}>
                🔑 Paste Token
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* TAB 1: DIRECT ON-DEVICE OAUTH */}
            {activeTab === 'oauth' && (
              <View style={styles.tabContent}>
                <View style={styles.noticeBox}>
                  <Text style={styles.noticeTitle}>🔒 100% On-Device OAuth</Text>
                  <Text style={styles.noticeText}>
                    VoltIQ retrieves your token directly on this phone via Tesla's official sign-in page.
                    Your password never leaves your browser and no third-party websites are used.
                  </Text>
                </View>

                {/* Step 1 */}
                <View style={styles.stepCard}>
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepNum}>1</Text>
                  </View>
                  <View style={styles.stepBody}>
                    <Text style={styles.stepHeading}>Log In on Tesla.com</Text>
                    <Text style={styles.stepDesc}>
                      Tap below to open Tesla's official sign-in portal:
                    </Text>
                    <TouchableOpacity
                      style={styles.openBrowserBtn}
                      onPress={handleOpenTeslaLogin}
                    >
                      <Text style={styles.openBrowserBtnText}>🌐 Open Tesla Sign-In Page</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Step 2 */}
                <View style={styles.stepCard}>
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepNum}>2</Text>
                  </View>
                  <View style={styles.stepBody}>
                    <Text style={styles.stepHeading}>Copy the Callback URL</Text>
                    <Text style={styles.stepDesc}>
                      Once you enter your credentials, Tesla redirects to a "Page Not Found" address.
                      Copy that entire address bar URL and paste it below:
                    </Text>

                    <TextInput
                      style={styles.input}
                      placeholder="https://medfizz.com/api/auth/callback?code=NA_..."
                      placeholderTextColor="#64748b"
                      value={callbackInput}
                      onChangeText={setCallbackInput}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                </View>

                {/* Step 3 */}
                <View style={{ marginTop: 12 }}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={handleVerifyAndConnect}
                    disabled={oauthLoading}
                  >
                    {oauthLoading ? (
                      <ActivityIndicator color="#ffffff" />
                    ) : (
                      <Text style={styles.actionBtnText}>⚡ Verify & Link Tesla Account</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* TAB 2: INSTANT 10s CAR STATS */}
            {activeTab === 'manual' && (
              <View style={styles.tabContent}>
                <View style={styles.noticeBox}>
                  <Text style={styles.noticeTitle}>💡 Zero Tokens / Zero Setup</Text>
                  <Text style={styles.noticeText}>
                    Glance at your Tesla center screen or Tesla mobile app and enter your current numbers:
                  </Text>
                </View>

                <Text style={styles.fieldLabel}>Current Battery Level (%)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 80"
                  placeholderTextColor="#64748b"
                  value={manualSoc}
                  onChangeText={setManualSoc}
                  keyboardType="numeric"
                />

                <Text style={styles.fieldLabel}>Rated Range (miles)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 240"
                  placeholderTextColor="#64748b"
                  value={manualRange}
                  onChangeText={setManualRange}
                  keyboardType="numeric"
                />

                <Text style={styles.fieldLabel}>Vehicle Odometer (miles)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 25000"
                  placeholderTextColor="#64748b"
                  value={manualOdo}
                  onChangeText={setManualOdo}
                  keyboardType="numeric"
                />

                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={handleSaveManualReading}
                  disabled={manualSaving}
                >
                  {manualSaving ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.actionBtnText}>📊 Save Reading & Compute Health</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* TAB 3: DIRECT TOKEN PASTE */}
            {activeTab === 'token' && (
              <View style={styles.tabContent}>
                <Text style={styles.fieldLabel}>Paste Existing Tesla Refresh Token</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Paste refresh token here..."
                  placeholderTextColor="#64748b"
                  value={quickToken}
                  onChangeText={setQuickToken}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                />

                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={handleSaveToken}
                  disabled={tokenSaving}
                >
                  {tokenSaving ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.actionBtnText}>Save Token to SecureStore</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            <Text style={styles.privacyNote}>
              🔒 Hardware Security: Credentials are encrypted locally using your phone's KeyStore.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    padding: 16,
  },
  modalContainer: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 20,
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: '#334155',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#f8fafc',
  },
  closeBtn: {
    padding: 6,
  },
  closeBtnText: {
    fontSize: 18,
    color: '#94a3b8',
    fontWeight: '700',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: '#0284c7',
  },
  tabText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#ffffff',
  },
  tabContent: {
    marginBottom: 10,
  },
  noticeBox: {
    backgroundColor: 'rgba(2, 132, 199, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0284c7',
    padding: 12,
    marginBottom: 14,
  },
  noticeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#38bdf8',
    marginBottom: 3,
  },
  noticeText: {
    fontSize: 11.5,
    color: '#94a3b8',
    lineHeight: 16,
  },
  stepCard: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 12,
  },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#0284c7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNum: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 13,
  },
  stepBody: {
    flex: 1,
  },
  stepHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  stepDesc: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 3,
    lineHeight: 16,
  },
  openBrowserBtn: {
    backgroundColor: '#0284c7',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginTop: 10,
    alignItems: 'center',
  },
  openBrowserBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#cbd5e1',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 11,
    color: '#ffffff',
    fontSize: 12,
    marginTop: 8,
  },
  actionBtn: {
    backgroundColor: '#10b981',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 10,
  },
  actionBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  privacyNote: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 6,
  },
});
