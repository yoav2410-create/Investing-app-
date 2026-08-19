import React from 'react';
import { Platform, type ColorValue } from 'react-native';
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
        tabBarStyle: {
          backgroundColor: palette.bgElevated,
          borderTopColor: palette.border,
          // The web tab bar defaults to 48pt: 5pt of padding top and bottom, a
          // 28pt icon that cannot shrink, and a label that can. The label lost
          // the argument — its box was squeezed from 14pt to 10pt and
          // `overflow: hidden` sliced the bottom off every glyph, at every
          // width, in both themes. 28 + 14 + 10 needs 52.
          //
          // Web only: on native React Navigation derives this height from the
          // bottom safe-area inset, and a fixed number there would put the
          // labels under the home indicator.
          ...(Platform.OS === 'web' ? { height: 56 } : {}),
        },
        // Pinned so the arithmetic above does not depend on how a given
        // platform resolves `line-height: normal` for the system font.
        tabBarLabelStyle: { fontSize: 10, lineHeight: 14 },
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
