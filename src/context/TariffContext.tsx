import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TARIFF_STORAGE_KEY = 'voltiq_charging_tariffs_v2';

export type CurrencyType = 'GBP' | 'USD' | 'EUR';

export interface CurrencyConfig {
  code: CurrencyType;
  symbol: string;
  subUnit: string;
  name: string;
}

export const CURRENCIES: Record<CurrencyType, CurrencyConfig> = {
  GBP: { code: 'GBP', symbol: '£', subUnit: 'p', name: 'British Pound (£)' },
  USD: { code: 'USD', symbol: '$', subUnit: '¢', name: 'US Dollar ($)' },
  EUR: { code: 'EUR', symbol: '€', subUnit: 'c', name: 'Euro (€)' },
};

interface TariffContextType {
  currency: CurrencyType;
  currencySymbol: string;
  currencySubUnit: string;
  setCurrency: (curr: CurrencyType) => Promise<void>;

  homeRate: number; // in subunit (e.g. 7p or 12¢)
  superchargerRate: number; // in subunit (e.g. 45p or 40¢)
  setHomeRate: (val: number) => Promise<void>;
  setSuperchargerRate: (val: number) => Promise<void>;

  homePowerKw: number; // default 7.0 kW
  superchargerPowerKw: number; // default 150 kW
  setHomePowerKw: (val: number) => Promise<void>;
  setSuperchargerPowerKw: (val: number) => Promise<void>;

  calcHomeCost: (kwh: number) => number;
  calcSuperchargerCost: (kwh: number) => number;
  formatCost: (cost: number) => string;

  // Backward-compatibility aliases
  homeRatePence: number;
  superchargerRatePence: number;
  setHomeRatePence: (val: number) => Promise<void>;
  setSuperchargerRatePence: (val: number) => Promise<void>;
}

const TariffContext = createContext<TariffContextType>({
  currency: 'GBP',
  currencySymbol: '£',
  currencySubUnit: 'p',
  setCurrency: async () => {},

  homeRate: 7,
  superchargerRate: 45,
  setHomeRate: async () => {},
  setSuperchargerRate: async () => {},

  homePowerKw: 7.0,
  superchargerPowerKw: 150,
  setHomePowerKw: async () => {},
  setSuperchargerPowerKw: async () => {},

  calcHomeCost: (kwh) => (kwh * 7) / 100,
  calcSuperchargerCost: (kwh) => (kwh * 45) / 100,
  formatCost: (c) => `£${c.toFixed(2)}`,

  homeRatePence: 7,
  superchargerRatePence: 45,
  setHomeRatePence: async () => {},
  setSuperchargerRatePence: async () => {},
});

export const TariffProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currency, setCurrencyState] = useState<CurrencyType>('GBP');
  const [homeRate, setHomeRateState] = useState<number>(7);
  const [superchargerRate, setSuperchargerRateState] = useState<number>(45);
  const [homePowerKw, setHomePowerKwState] = useState<number>(7.0);
  const [superchargerPowerKw, setSuperchargerPowerKwState] = useState<number>(150);

  useEffect(() => {
    async function loadTariffs() {
      try {
        let saved: string | null = null;
        if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
          saved = localStorage.getItem(TARIFF_STORAGE_KEY);
        } else {
          saved = await SecureStore.getItemAsync(TARIFF_STORAGE_KEY);
        }

        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.currency && CURRENCIES[parsed.currency as CurrencyType]) {
            setCurrencyState(parsed.currency);
          }
          if (typeof parsed.homeRate === 'number') {
            setHomeRateState(parsed.homeRate);
          } else if (typeof parsed.homeRatePence === 'number') {
            setHomeRateState(parsed.homeRatePence);
          }
          if (typeof parsed.superchargerRate === 'number') {
            setSuperchargerRateState(parsed.superchargerRate);
          } else if (typeof parsed.superchargerRatePence === 'number') {
            setSuperchargerRateState(parsed.superchargerRatePence);
          }
          if (typeof parsed.homePowerKw === 'number') {
            setHomePowerKwState(parsed.homePowerKw);
          }
          if (typeof parsed.superchargerPowerKw === 'number') {
            setSuperchargerPowerKwState(parsed.superchargerPowerKw);
          }
        }
      } catch (err) {
        console.warn('Could not load tariffs:', err);
      }
    }
    loadTariffs();
  }, []);

  const saveConfig = async (
    curr: CurrencyType,
    hRate: number,
    scRate: number,
    hKw: number,
    scKw: number
  ) => {
    try {
      const payload = JSON.stringify({
        currency: curr,
        homeRate: hRate,
        superchargerRate: scRate,
        homePowerKw: hKw,
        superchargerPowerKw: scKw,
      });
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.setItem(TARIFF_STORAGE_KEY, payload);
      } else {
        await SecureStore.setItemAsync(TARIFF_STORAGE_KEY, payload);
      }
    } catch (err) {
      console.warn('Could not save tariffs config:', err);
    }
  };

  const setCurrency = async (curr: CurrencyType) => {
    setCurrencyState(curr);
    await saveConfig(curr, homeRate, superchargerRate, homePowerKw, superchargerPowerKw);
  };

  const setHomeRate = async (val: number) => {
    const clean = Math.max(0, Math.round(val * 10) / 10);
    setHomeRateState(clean);
    await saveConfig(currency, clean, superchargerRate, homePowerKw, superchargerPowerKw);
  };

  const setSuperchargerRate = async (val: number) => {
    const clean = Math.max(0, Math.round(val * 10) / 10);
    setSuperchargerRateState(clean);
    await saveConfig(currency, homeRate, clean, homePowerKw, superchargerPowerKw);
  };

  const setHomePowerKw = async (val: number) => {
    const clean = Math.max(0.5, Math.round(val * 10) / 10);
    setHomePowerKwState(clean);
    await saveConfig(currency, homeRate, superchargerRate, clean, superchargerPowerKw);
  };

  const setSuperchargerPowerKw = async (val: number) => {
    const clean = Math.max(10, Math.round(val * 10) / 10);
    setSuperchargerPowerKwState(clean);
    await saveConfig(currency, homeRate, superchargerRate, homePowerKw, clean);
  };

  const calcHomeCost = (kwh: number) => {
    return Math.round(((kwh * homeRate) / 100) * 100) / 100;
  };

  const calcSuperchargerCost = (kwh: number) => {
    return Math.round(((kwh * superchargerRate) / 100) * 100) / 100;
  };

  const currConfig = CURRENCIES[currency] || CURRENCIES.GBP;

  const formatCost = (cost: number) => {
    return `${currConfig.symbol}${cost.toFixed(2)}`;
  };

  return (
    <TariffContext.Provider
      value={{
        currency,
        currencySymbol: currConfig.symbol,
        currencySubUnit: currConfig.subUnit,
        setCurrency,

        homeRate,
        superchargerRate,
        setHomeRate,
        setSuperchargerRate,

        homePowerKw,
        superchargerPowerKw,
        setHomePowerKw,
        setSuperchargerPowerKw,

        calcHomeCost,
        calcSuperchargerCost,
        formatCost,

        homeRatePence: homeRate,
        superchargerRatePence: superchargerRate,
        setHomeRatePence: setHomeRate,
        setSuperchargerRatePence: setSuperchargerRate,
      }}
    >
      {children}
    </TariffContext.Provider>
  );
};

export const useTariff = () => useContext(TariffContext);
