import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

interface ManualLogModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (reading: {
    soc: number;
    ratedRange: number;
    odometer: number;
  }) => Promise<void>;
  initialSoc?: number;
  initialRange?: number;
  initialOdo?: number;
  unitLabel: string;
  toDisplayDistance: (miles: number) => number;
  fromInputDistance: (val: number) => number;
}

export const ManualLogModal: React.FC<ManualLogModalProps> = ({
  visible,
  onClose,
  onSave,
  initialSoc = 80,
  initialRange = 220,
  initialOdo = 15000,
  unitLabel,
  toDisplayDistance,
  fromInputDistance,
}) => {
  const [socInput, setSocInput] = useState<string>(initialSoc.toString());
  const [rangeInput, setRangeInput] = useState<string>(
    toDisplayDistance(initialRange).toString()
  );
  const [odoInput, setOdoInput] = useState<string>(
    toDisplayDistance(initialOdo).toString()
  );
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    if (visible) {
      setSocInput(initialSoc.toString());
      setRangeInput(toDisplayDistance(initialRange).toString());
      setOdoInput(toDisplayDistance(initialOdo).toString());
    }
  }, [visible, initialSoc, initialRange, initialOdo]);

  const handleSave = async () => {
    const socNum = parseFloat(socInput);
    const rangeNum = parseFloat(rangeInput);
    const odoNum = parseFloat(odoInput);

    if (isNaN(socNum) || socNum < 1 || socNum > 100) {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert('Please enter a valid battery percentage (1 - 100%).');
      }
      return;
    }
    if (isNaN(rangeNum) || rangeNum <= 0) {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert('Please enter a valid rated range.');
      }
      return;
    }
    if (isNaN(odoNum) || odoNum < 0) {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert('Please enter a valid odometer reading.');
      }
      return;
    }

    setSaving(true);
    try {
      const actualRangeMiles = fromInputDistance(rangeNum);
      const actualOdoMiles = fromInputDistance(odoNum);

      await onSave({
        soc: socNum,
        ratedRange: actualRangeMiles,
        odometer: actualOdoMiles,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>📋 Log Vehicle Reading</Text>
              <Text style={styles.subtitle}>Calculates health & efficiency directly on device</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* Battery SoC */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Current State of Charge (%)</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  value={socInput}
                  onChangeText={setSocInput}
                  placeholder="80"
                  placeholderTextColor="#64748b"
                />
                <Text style={styles.inputUnit}>%</Text>
              </View>
              <Text style={styles.fieldHelp}>Battery charge shown on vehicle screen</Text>
            </View>

            {/* Rated Range */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Rated Range ({unitLabel})</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  value={rangeInput}
                  onChangeText={setRangeInput}
                  placeholder="220"
                  placeholderTextColor="#64748b"
                />
                <Text style={styles.inputUnit}>{unitLabel}</Text>
              </View>
              <Text style={styles.fieldHelp}>Remaining range displayed on dash</Text>
            </View>

            {/* Odometer */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Odometer Reading ({unitLabel})</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  value={odoInput}
                  onChangeText={setOdoInput}
                  placeholder="15000"
                  placeholderTextColor="#64748b"
                />
                <Text style={styles.inputUnit}>{unitLabel}</Text>
              </View>
              <Text style={styles.fieldHelp}>Total vehicle mileage</Text>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onClose}
              disabled={saving}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={styles.saveBtnText}>
                {saving ? 'Saving...' : '💾 Save to Phone'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  container: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#1e293b',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#334155',
    maxHeight: '85%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  closeBtn: {
    padding: 8,
    backgroundColor: '#0f172a',
    borderRadius: 16,
  },
  closeBtnText: {
    fontSize: 16,
    color: '#94a3b8',
    fontWeight: 'bold',
  },
  body: {
    padding: 20,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#e2e8f0',
    marginBottom: 6,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    height: 44,
    color: '#ffffff',
    fontSize: 15,
  },
  inputUnit: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '600',
    marginLeft: 6,
  },
  fieldHelp: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
  },
  footer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    color: '#cbd5e1',
    fontWeight: '600',
    fontSize: 14,
  },
  saveBtn: {
    flex: 2,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
});
