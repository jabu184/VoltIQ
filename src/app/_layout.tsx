import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { Text } from 'react-native';
import { PremiumProvider } from '@/context/PremiumContext';
import { VehicleProfileProvider } from '@/context/VehicleProfileContext';
import { UnitProvider } from '@/context/UnitContext';
import { TariffProvider } from '@/context/TariffContext';
import { VoltIQLogo } from '@/components/VoltIQLogo';
import { VersionPill } from '@/components/VersionModal';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <PremiumProvider>
      <VehicleProfileProvider>
        <UnitProvider>
          <TariffProvider>
            <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerStyle: {
            backgroundColor: '#0f172a',
            borderBottomColor: '#1e293b',
            borderBottomWidth: 1,
          },
          headerTintColor: '#ffffff',
          headerTitleAlign: 'center',
          headerTitle: () => <VoltIQLogo size="sm" showSubtitle={false} />,
          headerRight: () => <VersionPill />,
          tabBarStyle: {
            backgroundColor: '#0f172a',
            borderTopColor: '#1e293b',
            borderTopWidth: 1,
            height: 60,
            paddingBottom: 8,
            paddingTop: 6,
          },
          tabBarActiveTintColor: '#38bdf8',
          tabBarInactiveTintColor: '#64748b',
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Telemetry',
            tabBarIcon: () => (
              <Text style={{ fontSize: 20 }}>⚡</Text>
            ),
          }}
        />
        <Tabs.Screen
          name="health"
          options={{
            title: 'Battery Health',
            tabBarIcon: () => (
              <Text style={{ fontSize: 20 }}>🔋</Text>
            ),
          }}
        />
        <Tabs.Screen
          name="range"
          options={{
            title: 'Calculator',
            tabBarIcon: () => (
              <Text style={{ fontSize: 20 }}>🎯</Text>
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: () => (
              <Text style={{ fontSize: 20 }}>🔧</Text>
            ),
          }}
        />
      </Tabs>
          </TariffProvider>
        </UnitProvider>
      </VehicleProfileProvider>
    </PremiumProvider>
  );
}
