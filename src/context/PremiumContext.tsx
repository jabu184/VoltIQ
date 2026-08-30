import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const PREVIEW_PREMIUM_KEY = 'voltiq_mock_premium_unlocked';

interface PremiumContextType {
  isPremium: boolean;
  isLoading: boolean;
  unlockLifetimePremium: () => Promise<boolean>;
  restorePurchases: () => Promise<boolean>;
  toggleMockPremium: () => Promise<void>;
  priceLabel: string;
}

const PremiumContext = createContext<PremiumContextType>({
  isPremium: false,
  isLoading: true,
  unlockLifetimePremium: async () => false,
  restorePurchases: async () => false,
  toggleMockPremium: async () => {},
  priceLabel: '£2.99',
});

export const PremiumProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isPremium, setIsPremium] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const priceLabel = '£2.99';

  useEffect(() => {
    async function initPurchases() {
      try {
        if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
          const stored = window.localStorage.getItem(PREVIEW_PREMIUM_KEY);
          if (stored === 'true') {
            setIsPremium(true);
          }
        } else {
          const stored = await SecureStore.getItemAsync(PREVIEW_PREMIUM_KEY);
          if (stored === 'true') {
            setIsPremium(true);
          }
        }
      } catch {
        // Fallback
      } finally {
        setIsLoading(false);
      }
    }
    initPurchases();
  }, []);

  const unlockLifetimePremium = async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(PREVIEW_PREMIUM_KEY, 'true');
      } else {
        await SecureStore.setItemAsync(PREVIEW_PREMIUM_KEY, 'true');
      }
      setIsPremium(true);
      return true;
    } catch (err) {
      console.warn('Purchase error:', err);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const restorePurchases = async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(PREVIEW_PREMIUM_KEY);
        if (stored === 'true') {
          setIsPremium(true);
          return true;
        }
      } else {
        const stored = await SecureStore.getItemAsync(PREVIEW_PREMIUM_KEY);
        if (stored === 'true') {
          setIsPremium(true);
          return true;
        }
      }
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMockPremium = async (): Promise<void> => {
    const nextState = !isPremium;
    setIsPremium(nextState);
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(PREVIEW_PREMIUM_KEY, nextState ? 'true' : 'false');
    } else {
      await SecureStore.setItemAsync(PREVIEW_PREMIUM_KEY, nextState ? 'true' : 'false');
    }
  };

  return (
    <PremiumContext.Provider
      value={{
        isPremium,
        isLoading,
        unlockLifetimePremium,
        restorePurchases,
        toggleMockPremium,
        priceLabel,
      }}
    >
      {children}
    </PremiumContext.Provider>
  );
};

export const usePremium = () => useContext(PremiumContext);
