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
        // Attempt to check if RevenueCat is initialized or fallback to persisted setting
        if (Platform.OS !== 'web') {
          const stored = await SecureStore.getItemAsync(PREVIEW_PREMIUM_KEY);
          if (stored === 'true') {
            setIsPremium(true);
          }
        }
      } catch {
        // Fallback for mock environments
      } finally {
        setIsLoading(false);
      }
    }
    initPurchases();
  }, []);

  const unlockLifetimePremium = async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      // In production with native builds, Purchases.purchasePackage(lifetimePkg) would execute.
      // In sandbox/local-first Expo environment:
      if (Platform.OS !== 'web') {
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
      if (Platform.OS !== 'web') {
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
    if (Platform.OS !== 'web') {
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
