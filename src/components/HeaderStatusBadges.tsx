import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { fetchServerVehicle, checkServerHealth } from '../services/apiClient';
import { getTeslaRefreshToken } from '../services/teslaClient';

export const HeaderStatusBadges: React.FC = () => {
  const [hasToken, setHasToken] = useState<boolean>(false);
  const [isCarOnline, setIsCarOnline] = useState<boolean>(false);

  const checkStatus = async () => {
    try {
      const token = await getTeslaRefreshToken();
      const serverVehicleData = await fetchServerVehicle();

      const serverLinked = !!serverVehicleData?.isAccountLinked;
      const isLinked = serverLinked || !!token;
      setHasToken(isLinked);

      const v = serverVehicleData?.vehicle;
      const online = v?.last_state === 'online';
      setIsCarOnline(online);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={styles.container}>
      <View style={[styles.badge, hasToken ? styles.badgePaired : styles.badgeUnpaired]}>
        <Text style={[styles.badgeText, hasToken ? styles.textPaired : styles.textUnpaired]}>
          {hasToken ? '● PAIRED' : '○ UNPAIRED'}
        </Text>
      </View>
      {hasToken && (
        <View style={[styles.badge, isCarOnline ? styles.badgeConnected : styles.badgeOffline]}>
          <Text style={[styles.badgeText, isCarOnline ? styles.textConnected : styles.textOffline]}>
            {isCarOnline ? '● CONNECTED' : '○ OFFLINE'}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 12,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  badgePaired: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: '#38bdf8',
  },
  badgeUnpaired: {
    backgroundColor: '#1e293b',
    borderColor: '#64748b',
  },
  badgeConnected: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10b981',
  },
  badgeOffline: {
    backgroundColor: 'rgba(100, 116, 139, 0.15)',
    borderColor: '#64748b',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  textPaired: {
    color: '#38bdf8',
  },
  textUnpaired: {
    color: '#94a3b8',
  },
  textConnected: {
    color: '#10b981',
  },
  textOffline: {
    color: '#94a3b8',
  },
});