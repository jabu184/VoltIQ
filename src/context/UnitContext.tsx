import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type DistanceUnit = 'miles' | 'km';

const UNIT_STORAGE_KEY = 'voltiq_distance_unit';

interface UnitContextType {
  unit: DistanceUnit;
  setUnit: (unit: DistanceUnit) => Promise<void>;
  toDisplayDistance: (miles: number) => number;
  fromInputDistance: (inputVal: number) => number;
  formatDistance: (miles: number, decimals?: number) => string;
  unitLabel: string;
  unitLongLabel: string;
}

const UnitContext = createContext<UnitContextType>({
  unit: 'miles',
  setUnit: async () => {},
  toDisplayDistance: (m) => m,
  fromInputDistance: (v) => v,
  formatDistance: (m) => `${m} mi`,
  unitLabel: 'mi',
  unitLongLabel: 'Miles',
});

const KM_PER_MILE = 1.609344;

export const UnitProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [unit, setUnitState] = useState<DistanceUnit>('miles');

  useEffect(() => {
    async function loadUnit() {
      try {
        let saved: string | null = null;
        if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
          saved = localStorage.getItem(UNIT_STORAGE_KEY);
        } else {
          saved = await SecureStore.getItemAsync(UNIT_STORAGE_KEY);
        }
        if (saved === 'km' || saved === 'miles') {
          setUnitState(saved);
        }
      } catch (err) {
        console.warn('Could not load unit setting:', err);
      }
    }
    loadUnit();
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
      }}
    >
      {children}
    </UnitContext.Provider>
  );
};

export const useUnit = () => useContext(UnitContext);
