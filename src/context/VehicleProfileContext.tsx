import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { TESLA_PROFILES, VehicleModelProfile } from '../services/batteryLogic';

const PROFILE_STORAGE_KEY = 'voltiq_selected_profile_id';
const CUSTOM_PROFILE_KEY = 'voltiq_custom_profile_data';

interface VehicleProfileContextType {
  selectedProfile: VehicleModelProfile;
  setSelectedProfile: (profile: VehicleModelProfile) => Promise<void>;
  selectProfileById: (profileId: string) => Promise<void>;
  updateCustomProfile: (fields: Partial<VehicleModelProfile>) => Promise<void>;
}

const VehicleProfileContext = createContext<VehicleProfileContextType>({
  selectedProfile: TESLA_PROFILES[0], // Model 3 RWD 60 kWh LFP
  setSelectedProfile: async () => {},
  selectProfileById: async () => {},
  updateCustomProfile: async () => {},
});

export const VehicleProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedProfile, setSelectedProfileState] = useState<VehicleModelProfile>(TESLA_PROFILES[0]);

  useEffect(() => {
    async function loadSavedProfile() {
      try {
        let savedId: string | null = null;
        let savedCustomJson: string | null = null;
        if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
          savedId = localStorage.getItem(PROFILE_STORAGE_KEY);
          savedCustomJson = localStorage.getItem(CUSTOM_PROFILE_KEY);
        } else {
          savedId = await SecureStore.getItemAsync(PROFILE_STORAGE_KEY);
          savedCustomJson = await SecureStore.getItemAsync(CUSTOM_PROFILE_KEY);
        }

        if (savedCustomJson) {
          try {
            const parsed = JSON.parse(savedCustomJson);
            if (parsed && typeof parsed.nominalCapacityKwh === 'number') {
              setSelectedProfileState(parsed);
              return;
            }
          } catch {}
        }

        if (savedId) {
          const match = TESLA_PROFILES.find((p) => p.id === savedId);
          if (match) setSelectedProfileState(match);
        }
      } catch (err) {
        console.warn('Failed to load saved vehicle profile:', err);
      }
    }
    loadSavedProfile();
  }, []);

  const saveProfileData = async (profile: VehicleModelProfile) => {
    try {
      const json = JSON.stringify(profile);
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.setItem(PROFILE_STORAGE_KEY, profile.id);
        localStorage.setItem(CUSTOM_PROFILE_KEY, json);
      } else {
        await SecureStore.setItemAsync(PROFILE_STORAGE_KEY, profile.id);
        await SecureStore.setItemAsync(CUSTOM_PROFILE_KEY, json);
      }
    } catch (err) {
      console.warn('Failed to persist vehicle profile:', err);
    }
  };

  const setSelectedProfile = async (profile: VehicleModelProfile) => {
    setSelectedProfileState(profile);
    await saveProfileData(profile);
  };

  const selectProfileById = async (profileId: string) => {
    const match = TESLA_PROFILES.find((p) => p.id === profileId);
    if (match) {
      await setSelectedProfile(match);
    }
  };

  const updateCustomProfile = async (fields: Partial<VehicleModelProfile>) => {
    setSelectedProfileState((prev) => {
      const updated = { ...prev, ...fields };
      saveProfileData(updated);
      return updated;
    });
  };

  return (
    <VehicleProfileContext.Provider
      value={{
        selectedProfile,
        setSelectedProfile,
        selectProfileById,
        updateCustomProfile,
      }}
    >
      {children}
    </VehicleProfileContext.Provider>
  );
};

export const useVehicleProfile = () => useContext(VehicleProfileContext);
