import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './ui';
import { glossary, type GlossaryKey } from '@/domain/glossary';

/**
 * The "?" that sits beside a metric.
 *
 * A single shared sheet rather than one Modal per button: a screen like the
 * stock detail page carries thirty of these, and thirty mounted modals is thirty
 * mounted modals.
 */

interface InfoContextValue {
  open: (key: GlossaryKey) => void;
}

const InfoContext = createContext<InfoContextValue | null>(null);

export function InfoProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<GlossaryKey | null>(null);
  const { palette, spacing, radius } = useTheme();

  const open = useCallback((key: GlossaryKey) => setActive(key), []);
  const value = useMemo(() => ({ open }), [open]);
  const entry = active ? glossary(active) : null;

  return (
    <InfoContext.Provider value={value}>
      {children}
      <Modal
        visible={entry != null}
        transparent
        animationType="fade"
        onRequestClose={() => setActive(null)}
        accessibilityViewIsModal
      >
        <Pressable
          onPress={() => setActive(null)}
          accessibilityLabel="Close explanation"
          style={{ flex: 1, backgroundColor: palette.overlay, justifyContent: 'flex-end' }}
        >
          {/* Stop the press from bubbling so tapping the card does not dismiss. */}
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: palette.bgElevated,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              padding: spacing.xl,
              paddingBottom: spacing.xxl + spacing.lg,
              gap: spacing.md,
              maxHeight: '80%',
            }}
          >
            {entry ? (
              <ScrollView contentContainerStyle={{ gap: spacing.md }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: spacing.md,
                  }}
                >
                  <Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>
                    {entry.title}
                  </Text>
                  <Pressable
                    onPress={() => setActive(null)}
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    hitSlop={12}
                  >
                    <Ionicons name="close" size={24} color={palette.textMuted} />
                  </Pressable>
                </View>

                <View style={{ gap: spacing.xs }}>
                  <Text variant="caption" faint>
                    WHAT IT IS
                  </Text>
                  <Text variant="body">{entry.what}</Text>
                </View>

                <View style={{ gap: spacing.xs }}>
                  <Text variant="caption" faint>
                    HOW TO READ IT
                  </Text>
                  <Text variant="body">{entry.read}</Text>
                </View>

                {entry.caveat ? (
                  <View
                    style={{
                      gap: spacing.xs,
                      backgroundColor: palette.warnMuted,
                      borderRadius: radius.md,
                      padding: spacing.md,
                    }}
                  >
                    <Text variant="caption" tone="warn">
                      WHERE IT MISLEADS
                    </Text>
                    <Text variant="body">{entry.caveat}</Text>
                  </View>
                ) : null}
              </ScrollView>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </InfoContext.Provider>
  );
}

export function useInfo(): InfoContextValue {
  const ctx = useContext(InfoContext);
  // Falling back to a no-op keeps a stray "?" from crashing a screen that has
  // not been wrapped yet.
  return ctx ?? { open: () => {} };
}

export function InfoButton({ term, size = 15 }: { term: GlossaryKey; size?: number }) {
  const { palette } = useTheme();
  const { open } = useInfo();
  const entry = glossary(term);
  return (
    <Pressable
      onPress={() => open(term)}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={`What is ${entry.title}?`}
      accessibilityHint="Opens a plain-English explanation"
      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 0.75 })}
    >
      <Ionicons name="help-circle-outline" size={size} color={palette.textFaint} />
    </Pressable>
  );
}
