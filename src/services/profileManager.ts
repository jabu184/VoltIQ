import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { TESLA_PROFILES, VehicleModelProfile } from './batteryLogic';

const PROFILE_KEY = 'voltiq_active_profile_id';

let inMemoryProfileId = 'm3_rwd_lfp';

export async function getActiveProfile(): Promise<VehicleModelProfile> {
  try {
    let id: string | null = null;
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      id = localStorage.getItem(PROFILE_KEY);
    } else {
      id = await SecureStore.getItemAsync(PROFILE_KEY);
    }
    const found = TESLA_PROFILES.find((p) => p.id === (id || inMemoryProfileId));
    return found || TESLA_PROFILES[0];
  } catch {
    return TESLA_PROFILES[0];
  }
}

export async function setActiveProfile(profileId: string): Promise<void> {
  try {
    inMemoryProfileId = profileId;
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      localStorage.setItem(PROFILE_KEY, profileId);
    } else {
      await SecureStore.setItemAsync(PROFILE_KEY, profileId);
    }
  } catch (err) {
    console.warn('Could not persist active profile:', err);
  }
}
