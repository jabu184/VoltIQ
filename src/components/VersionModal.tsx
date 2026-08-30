import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
} from 'react-native';

export const APP_VERSION = 'v1.0.5';
export const APP_BUILD = 'OTA Wireless #2';

interface VersionModalProps {
  visible: boolean;
  onClose: () => void;
}

export const VersionModal: React.FC<VersionModalProps> = ({ visible, onClose }) => {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.modalCard}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.iconCircle}>
              <Text style={{ fontSize: 24 }}>⚡</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.title}>VoltIQ</Text>
              <Text style={styles.subtitle}>Tesla Battery Intelligence</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Details */}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>App Version</Text>
            <Text style={styles.infoValue}>{APP_VERSION}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Build Hash</Text>
            <Text style={styles.infoValue}>{APP_BUILD}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Cloud Engine</Text>
            <Text style={styles.infoValue}>145.241.192.121</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>OTA Updates</Text>
            <Text style={[styles.infoValue, { color: '#10b981' }]}>● Enabled</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Telemetry Mode</Text>
            <Text style={[styles.infoValue, { color: '#38bdf8' }]}>60s Real-time</Text>
          </View>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

export const VersionPill: React.FC = () => {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <TouchableOpacity
        style={styles.pillBtn}
        onPress={() => setShowModal(true)}
        activeOpacity={0.7}
      >
        <Text style={styles.pillText}>{APP_VERSION}</Text>
      </TouchableOpacity>
      <VersionModal visible={showModal} onClose={() => setShowModal(false)} />
    </>
  );
};

const styles = StyleSheet.create({
  pillBtn: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: 'rgba(56, 189, 248, 0.35)',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 14,
  },
  pillText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#1e293b',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  infoLabel: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 13,
    color: '#f8fafc',
    fontWeight: '700',
  },
  closeBtn: {
    backgroundColor: '#0284c7',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  closeBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});