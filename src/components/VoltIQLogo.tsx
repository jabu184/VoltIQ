import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface VoltIQLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
}

export const VoltIQLogo: React.FC<VoltIQLogoProps> = ({
  size = 'md',
  showSubtitle = true,
}) => {
  const isSm = size === 'sm';
  const isLg = size === 'lg';

  const fontSize = isSm ? 18 : isLg ? 26 : 22;
  const iconSize = isSm ? 14 : isLg ? 18 : 16;
  const badgePadding = isSm ? 4 : 5;

  return (
    <View style={styles.container}>
      <View style={styles.brandRow}>
        {/* Minimalist Energy Spark Badge */}
        <View
          style={[
            styles.sparkBadge,
            {
              paddingHorizontal: badgePadding + 1,
              paddingVertical: badgePadding - 1,
              marginRight: isSm ? 6 : 8,
            },
          ]}
        >
          <Text style={[styles.sparkIcon, { fontSize: iconSize }]}>⚡</Text>
        </View>

        {/* Typographic Logo */}
        <Text style={[styles.textVolt, { fontSize }]}>
          Volt<Text style={styles.textIQ}>IQ</Text>
        </Text>

        {/* Small AI/Intelligence Pip */}
        <View style={styles.pulseDot} />
      </View>

      {showSubtitle && (
        <Text style={[styles.subtitle, isSm && { fontSize: 10 }]}>
          Tesla Battery Intelligence
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sparkBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sparkIcon: {
    color: '#38bdf8',
    lineHeight: 18,
  },
  textVolt: {
    fontWeight: '900',
    color: '#f8fafc',
    letterSpacing: -0.6,
  },
  textIQ: {
    fontWeight: '900',
    color: '#38bdf8',
    letterSpacing: -0.2,
  },
  pulseDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#10b981',
    marginLeft: 5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '500',
    marginTop: 2,
    letterSpacing: 0.3,
  },
});
