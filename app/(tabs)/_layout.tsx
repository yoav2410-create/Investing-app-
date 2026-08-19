import React from 'react';
import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export default function TabsLayout() {
  const { palette } = useTheme();
  const icon =
    (name: IconName, active: IconName) =>
    ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => (
      <Ionicons name={focused ? active : name} size={size} color={color as string} />
    );

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.bg },
        headerTintColor: palette.text,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: palette.bgElevated, borderTopColor: palette.border },
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textFaint,
        sceneStyle: { backgroundColor: palette.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Portfolio', tabBarIcon: icon('pie-chart-outline', 'pie-chart') }}
      />
      <Tabs.Screen
        name="stocks"
        options={{ title: 'Stocks', tabBarIcon: icon('list-outline', 'list') }}
      />
      <Tabs.Screen
        name="sectors"
        options={{ title: 'Sectors', tabBarIcon: icon('layers-outline', 'layers') }}
      />
      <Tabs.Screen
        name="plan"
        options={{ title: 'Plan', tabBarIcon: icon('checkbox-outline', 'checkbox') }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: icon('ellipsis-horizontal', 'ellipsis-horizontal') }}
      />
    </Tabs>
  );
}
