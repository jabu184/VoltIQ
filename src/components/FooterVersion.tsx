import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { VersionModal, APP_VERSION } from './VersionModal';

export const FooterVersion: React.FC = () => {
  const [modalVisible, setModalVisible] = useState<boolean>(false);

  return (
    <View style={styles.footerContainer}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => setModalVisible(true)}
        style={styles.versionBtn}
      >
        <Text style={styles.versionText}>⚡ {APP_VERSION}</Text>
      </TouchableOpacity>
      <VersionModal visible={modalVisible} onClose={() => setModalVisible(false)} />
    </View>
  );
};

const styles = StyleSheet.create({
  footerContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingVertical: 14,
    paddingRight: 4,
    marginTop: 10,
  },
  versionBtn: {
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  versionText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});