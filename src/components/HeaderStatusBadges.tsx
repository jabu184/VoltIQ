import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { fetchServerVehicle } from '../services/apiClient';
import { getTeslaRefreshToken } from '../services/teslaClient';

interface HeaderStatusBadgesProps {
  isPaired?: boolean;
  isOnline?: boolean;
}

export const HeaderStatusBadges: React.FC<HeaderStatusBadgesProps> = ({
  isPaired: propIsPaired,
  isOnline: propIsOnline,
}) => {
  const [internalPaired, setInternalPaired] = useState<boolean>(propIsPaired ?? false);
  const [internalOnline, setInternalOnline] = useState<boolean>(propIsOnline ?? false);

  const checkStatus = async () => {
    try {
      const token = await getTeslaRefreshToken();
      const serverVehicleData = await fetchServerVehicle();

      const serverLinked = !!serverVehicleData?.isAccountLinked;
      const isLinked = serverLinked || !!token;
      setInternalPaired(isLinked);

      const v = serverVehicleData?.vehicle;
      const online = v?.last_state === 'online';
      setInternalOnline(online);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (propIsPaired !== undefined) {
      setInternalPaired(propIsPaired);
    }
    if (propIsOnline !== undefined) {
      setInternalOnline(propIsOnline);
    }
  }, [propIsPaired, propIsOnline]);

  useEffect(() => {
    if (propIsPaired === undefined || propIsOnline === undefined) {
      checkStatus();
      const interval = setInterval(checkStatus, 10000);
      return () => clearInterval(interval);
    }
  }, [propIsPaired, propIsOnline]);

  const isPaired = propIsPaired !== undefined ? propIsPaired : internalPaired;
  const isOnline = propIsOnline !== undefined ? propIsOnline : internalOnline;

  return (
    <View style={styles.container}>
      <View style={[styles.badge, isPaired ? styles.badgePaired : styles.badgeUnpaired]}>
        <Text style={[styles.badgeText, isPaired ? styles.textPaired : styles.textUnpaired]}>
          {isPaired ? '● PAIRED' : '○ UNPAIRED'}
        </Text>
      </View>
      {isPaired && (
        <View style={[styles.badge, isOnline ? styles.badgeConnected : styles.badgeOffline]}>
          <Text style={[styles.badgeText, isOnline ? styles.textConnected : styles.textOffline]}>
            {isOnline ? '● CONNECTED' : '○ OFFLINE'}
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
    flexShrink: 0,
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