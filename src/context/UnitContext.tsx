import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type DistanceUnit = 'miles' | 'km';
export type EfficiencyUnit = 'distance_per_kwh' | 'energy_per_distance'; // mi/kWh vs Wh/mi

const UNIT_STORAGE_KEY = 'voltiq_distance_unit';
const EFFICIENCY_UNIT_STORAGE_KEY = 'voltiq_efficiency_unit';

interface UnitContextType {
  unit: DistanceUnit;
  setUnit: (unit: DistanceUnit) => Promise<void>;
  toDisplayDistance: (miles: number) => number;
  fromInputDistance: (inputVal: number) => number;
  formatDistance: (miles: number, decimals?: number) => string;
  unitLabel: string;
  unitLongLabel: string;
  efficiencyUnit: EfficiencyUnit;
  setEfficiencyUnit: (unit: EfficiencyUnit) => Promise<void>;
  formatEfficiency: (whPerMile: number) => string;
  efficiencyLabel: string;
}

const UnitContext = createContext<UnitContextType>({
  unit: 'miles',
  setUnit: async () => {},
  toDisplayDistance: (m) => m,
  fromInputDistance: (v) => v,
  formatDistance: (m) => `${m} mi`,
  unitLabel: 'mi',
  unitLongLabel: 'Miles',
  efficiencyUnit: 'distance_per_kwh',
  setEfficiencyUnit: async () => {},
  formatEfficiency: (wh) => `${(1000 / (wh || 222)).toFixed(2)} mi/kWh`,
  efficiencyLabel: 'mi/kWh',
});

const KM_PER_MILE = 1.609344;

export const UnitProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [unit, setUnitState] = useState<DistanceUnit>('miles');
  const [efficiencyUnit, setEfficiencyUnitState] = useState<EfficiencyUnit>('distance_per_kwh');

  useEffect(() => {
    async function loadSettings() {
      try {
        let savedUnit: string | null = null;
        let savedEff: string | null = null;
        if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
          savedUnit = localStorage.getItem(UNIT_STORAGE_KEY);
          savedEff = localStorage.getItem(EFFICIENCY_UNIT_STORAGE_KEY);
        } else {
          savedUnit = await SecureStore.getItemAsync(UNIT_STORAGE_KEY);
          savedEff = await SecureStore.getItemAsync(EFFICIENCY_UNIT_STORAGE_KEY);
        }
        if (savedUnit === 'km' || savedUnit === 'miles') {
          setUnitState(savedUnit);
        }
        if (savedEff === 'distance_per_kwh' || savedEff === 'energy_per_distance') {
          setEfficiencyUnitState(savedEff);
        }
      } catch (err) {
        console.warn('Could not load unit settings:', err);
      }
    }
    loadSettings();
  }, []);

  const setUnit = async (newUnit: DistanceUnit) => {
    setUnitState(newUnit);
    try {
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.setItem(UNIT_STORAGE_KEY, newUnit);
      } else {
        await SecureStore.setItemAsync(UNIT_STORAGE_KEY, newUnit);
      }
    } catch (err) {
      console.warn('Could not save unit setting:', err);
    }
  };

  const setEfficiencyUnit = async (newEffUnit: EfficiencyUnit) => {
    setEfficiencyUnitState(newEffUnit);
    try {
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.setItem(EFFICIENCY_UNIT_STORAGE_KEY, newEffUnit);
      } else {
        await SecureStore.setItemAsync(EFFICIENCY_UNIT_STORAGE_KEY, newEffUnit);
      }
    } catch (err) {
      console.warn('Could not save efficiency unit setting:', err);
    }
  };

  const toDisplayDistance = (miles: number) => {
    if (unit === 'km') {
      return Math.round(miles * KM_PER_MILE * 10) / 10;
    }
    return Math.round(miles * 10) / 10;
  };

  const fromInputDistance = (inputVal: number) => {
    if (unit === 'km') {
      return inputVal / KM_PER_MILE;
    }
    return inputVal;
  };

  const formatDistance = (miles: number, decimals: number = 1) => {
    const val = toDisplayDistance(miles);
    const formatted = decimals === 0 ? Math.round(val).toLocaleString() : val.toLocaleString();
    return `${formatted} ${unit === 'km' ? 'km' : 'mi'}`;
  };

  const formatEfficiency = (whPerMile: number) => {
    const safeWh = whPerMile > 0 ? whPerMile : 222;
    if (efficiencyUnit === 'distance_per_kwh') {
      if (unit === 'km') {
        const kmPerKwh = (1000 / safeWh) * KM_PER_MILE;
        return `${kmPerKwh.toFixed(2)} km/kWh`;
      }
      const miPerKwh = 1000 / safeWh;
      return `${miPerKwh.toFixed(2)} mi/kWh`;
    } else {
      if (unit === 'km') {
        const whPerKm = Math.round(safeWh / KM_PER_MILE);
        return `${whPerKm} Wh/km`;
      }
      return `${Math.round(safeWh)} Wh/mi`;
    }
  };

  const efficiencyLabel =
    efficiencyUnit === 'distance_per_kwh'
      ? unit === 'km'
        ? 'km/kWh'
        : 'mi/kWh'
      : unit === 'km'
      ? 'Wh/km'
      : 'Wh/mi';

  return (
    <UnitContext.Provider
      value={{
        unit,
        setUnit,
        toDisplayDistance,
        fromInputDistance,
        formatDistance,
        unitLabel: unit === 'km' ? 'km' : 'mi',
        unitLongLabel: unit === 'km' ? 'Kilometers' : 'Miles',
        efficiencyUnit,
        setEfficiencyUnit,
        formatEfficiency,
        efficiencyLabel,
      }}
    >
      {children}
    </UnitContext.Provider>
  );
};

export const useUnit = () => useContext(UnitContext);
