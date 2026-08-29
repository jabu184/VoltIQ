import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { TESLA_PROFILES, VehicleModelProfile } from '../services/batteryLogic';

const PROFILE_STORAGE_KEY = 'voltiq_selected_profile_id';

interface VehicleProfileContextType {
  selectedProfile: VehicleModelProfile;
  setSelectedProfile: (profile: VehicleModelProfile) => Promise<void>;
  selectProfileById: (profileId: string) => Promise<void>;
}

const VehicleProfileContext = createContext<VehicleProfileContextType>({
  selectedProfile: TESLA_PROFILES[0], // Model 3 RWD 60 kWh LFP
  setSelectedProfile: async () => {},
  selectProfileById: async () => {},
});

export const VehicleProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedProfile, setSelectedProfileState] = useState<VehicleModelProfile>(TESLA_PROFILES[0]);

  useEffect(() => {
    async function loadSavedProfile() {
      try {
        let savedId: string | null = null;
        if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
          savedId = localStorage.getItem(PROFILE_STORAGE_KEY);
        } else {
          savedId = await SecureStore.getItemAsync(PROFILE_STORAGE_KEY);
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

  const setSelectedProfile = async (profile: VehicleModelProfile) => {
    setSelectedProfileState(profile);
    try {
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.setItem(PROFILE_STORAGE_KEY, profile.id);
      } else {
        await SecureStore.setItemAsync(PROFILE_STORAGE_KEY, profile.id);
      }
    } catch (err) {
      console.warn('Failed to persist vehicle profile:', err);
    }
  };

  const selectProfileById = async (profileId: string) => {
    const match = TESLA_PROFILES.find((p) => p.id === profileId);
    if (match) {
      await setSelectedProfile(match);
    }
  };

  return (
    <VehicleProfileContext.Provider
      value={{
        selectedProfile,
        setSelectedProfile,
        selectProfileById,
      }}
    >
      {children}
    </VehicleProfileContext.Provider>
  );
};

export const useVehicleProfile = () => useContext(VehicleProfileContext);
