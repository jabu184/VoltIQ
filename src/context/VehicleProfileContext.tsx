import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { TESLA_PROFILES, VehicleModelProfile } from '../services/batteryLogic';

const VEHICLES_STORAGE_KEY = 'voltiq_vehicles_list_v2';
const ACTIVE_VEHICLE_ID_KEY = 'voltiq_active_vehicle_id_v2';

export interface ManualTelemetry {
  batteryLevelPct: number;
  ratedRangeMiles: number;
  odometerMiles: number;
  insideTempC?: number;
  outsideTempC?: number;
  lastUpdated?: number;
}

export interface VehicleConfig {
  id: string;
  name: string;
  vin?: string;
  isPaired: boolean; // false = Manual mode (local only, default); true = Tesla Fleet API
  profile: VehicleModelProfile;
  manualTelemetry?: ManualTelemetry;
}

const DEFAULT_VEHICLE: VehicleConfig = {
  id: 'veh_default',
  name: 'Tesla Model 3 RWD',
  vin: '',
  isPaired: false, // Default to Manual mode when no car is linked
  profile: TESLA_PROFILES[0],
  manualTelemetry: {
    batteryLevelPct: 80,
    ratedRangeMiles: 220.0,
    odometerMiles: 15000,
    insideTempC: 20,
    outsideTempC: 15,
    lastUpdated: Date.now(),
  },
};

interface VehicleProfileContextType {
  vehicles: VehicleConfig[];
  activeVehicle: VehicleConfig;
  selectedProfile: VehicleModelProfile; // alias for activeVehicle.profile
  isManualMode: boolean; // alias for !activeVehicle.isPaired
  setActiveVehicleId: (id: string) => Promise<void>;
  addVehicle: (name?: string, profile?: VehicleModelProfile, isPaired?: boolean) => Promise<VehicleConfig>;
  updateActiveVehicle: (updates: Partial<VehicleConfig>) => Promise<void>;
  updateVehicle: (id: string, updates: Partial<VehicleConfig>) => Promise<void>;
  deleteVehicle: (id: string) => Promise<void>;
  setSelectedProfile: (profile: VehicleModelProfile) => Promise<void>;
  selectProfileById: (profileId: string) => Promise<void>;
  updateCustomProfile: (fields: Partial<VehicleModelProfile>) => Promise<void>;
  updateManualTelemetry: (telemetry: Partial<ManualTelemetry>) => Promise<void>;
}

const VehicleProfileContext = createContext<VehicleProfileContextType>({
  vehicles: [DEFAULT_VEHICLE],
  activeVehicle: DEFAULT_VEHICLE,
  selectedProfile: DEFAULT_VEHICLE.profile,
  isManualMode: true,
  setActiveVehicleId: async () => {},
  addVehicle: async () => DEFAULT_VEHICLE,
  updateActiveVehicle: async () => {},
  updateVehicle: async () => {},
  deleteVehicle: async () => {},
  setSelectedProfile: async () => {},
  selectProfileById: async () => {},
  updateCustomProfile: async () => {},
  updateManualTelemetry: async () => {},
});

export const VehicleProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [vehicles, setVehicles] = useState<VehicleConfig[]>([DEFAULT_VEHICLE]);
  const [activeVehicleId, setActiveVehicleIdState] = useState<string>(DEFAULT_VEHICLE.id);

  // Derive active vehicle
  const activeVehicle = vehicles.find((v) => v.id === activeVehicleId) || vehicles[0] || DEFAULT_VEHICLE;
  const selectedProfile = activeVehicle.profile;
  const isManualMode = !activeVehicle.isPaired;

  useEffect(() => {
    async function loadSavedVehicles() {
      try {
        let savedVehiclesJson: string | null = null;
        let savedActiveId: string | null = null;

        if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
          savedVehiclesJson = localStorage.getItem(VEHICLES_STORAGE_KEY);
          savedActiveId = localStorage.getItem(ACTIVE_VEHICLE_ID_KEY);
        } else {
          savedVehiclesJson = await SecureStore.getItemAsync(VEHICLES_STORAGE_KEY);
          savedActiveId = await SecureStore.getItemAsync(ACTIVE_VEHICLE_ID_KEY);
        }

        if (savedVehiclesJson) {
          try {
            const parsed = JSON.parse(savedVehiclesJson);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setVehicles(parsed);
              if (savedActiveId && parsed.some((v: VehicleConfig) => v.id === savedActiveId)) {
                setActiveVehicleIdState(savedActiveId);
              } else {
                setActiveVehicleIdState(parsed[0].id);
              }
              return;
            }
          } catch {}
        }
      } catch (err) {
        console.warn('Failed to load saved vehicles list:', err);
      }
    }
    loadSavedVehicles();
  }, []);

  const saveVehiclesState = async (updatedList: VehicleConfig[], activeId: string) => {
    try {
      const json = JSON.stringify(updatedList);
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.setItem(VEHICLES_STORAGE_KEY, json);
        localStorage.setItem(ACTIVE_VEHICLE_ID_KEY, activeId);
      } else {
        await SecureStore.setItemAsync(VEHICLES_STORAGE_KEY, json);
        await SecureStore.setItemAsync(ACTIVE_VEHICLE_ID_KEY, activeId);
      }
    } catch (err) {
      console.warn('Failed to persist vehicles state:', err);
    }
  };

  const setActiveVehicleId = async (id: string) => {
    const exists = vehicles.some((v) => v.id === id);
    if (exists) {
      setActiveVehicleIdState(id);
      await saveVehiclesState(vehicles, id);
    }
  };

  const addVehicle = async (name?: string, profile?: VehicleModelProfile, isPaired: boolean = false): Promise<VehicleConfig> => {
    const prof = profile || TESLA_PROFILES[0];
    const newVeh: VehicleConfig = {
      id: `veh_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: name || `${prof.name} (Car ${vehicles.length + 1})`,
      vin: '',
      isPaired,
      profile: prof,
      manualTelemetry: {
        batteryLevelPct: 80,
        ratedRangeMiles: 220.0,
        odometerMiles: 15000,
        insideTempC: 20,
        outsideTempC: 15,
        lastUpdated: Date.now(),
      },
    };

    const updated = [...vehicles, newVeh];
    setVehicles(updated);
    setActiveVehicleIdState(newVeh.id);
    await saveVehiclesState(updated, newVeh.id);
    return newVeh;
  };

  const updateVehicle = async (id: string, updates: Partial<VehicleConfig>) => {
    const updated = vehicles.map((v) => (v.id === id ? { ...v, ...updates } : v));
    setVehicles(updated);
    await saveVehiclesState(updated, activeVehicleId);
  };

  const updateActiveVehicle = async (updates: Partial<VehicleConfig>) => {
    await updateVehicle(activeVehicle.id, updates);
  };

  const deleteVehicle = async (id: string) => {
    if (vehicles.length <= 1) {
      console.warn('Cannot delete the only remaining vehicle.');
      return;
    }
    const updated = vehicles.filter((v) => v.id !== id);
    const newActiveId = id === activeVehicleId ? updated[0].id : activeVehicleId;
    setVehicles(updated);
    setActiveVehicleIdState(newActiveId);
    await saveVehiclesState(updated, newActiveId);
  };

  const setSelectedProfile = async (profile: VehicleModelProfile) => {
    await updateActiveVehicle({
      profile,
      name: activeVehicle.name || profile.name,
    });
  };

  const selectProfileById = async (profileId: string) => {
    const match = TESLA_PROFILES.find((p) => p.id === profileId);
    if (match) {
      await setSelectedProfile(match);
    }
  };

  const updateCustomProfile = async (fields: Partial<VehicleModelProfile>) => {
    const updatedProf = { ...activeVehicle.profile, ...fields };
    await updateActiveVehicle({ profile: updatedProf });
  };

  const updateManualTelemetry = async (telemetry: Partial<ManualTelemetry>) => {
    const currentTel = activeVehicle.manualTelemetry || {
      batteryLevelPct: 80,
      ratedRangeMiles: 220.0,
      odometerMiles: 15000,
      insideTempC: 20,
      outsideTempC: 15,
    };
    const updatedTel = { ...currentTel, ...telemetry, lastUpdated: Date.now() };
    await updateActiveVehicle({ manualTelemetry: updatedTel });
  };

  return (
    <VehicleProfileContext.Provider
      value={{
        vehicles,
        activeVehicle,
        selectedProfile,
        isManualMode,
        setActiveVehicleId,
        addVehicle,
        updateActiveVehicle,
        updateVehicle,
        deleteVehicle,
        setSelectedProfile,
        selectProfileById,
        updateCustomProfile,
        updateManualTelemetry,
      }}
    >
      {children}
    </VehicleProfileContext.Provider>
  );
};

export const useVehicleProfile = () => useContext(VehicleProfileContext);
