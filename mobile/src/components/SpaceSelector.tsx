import { useState } from 'react';
import { Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Check, ChevronDown, Layers3, MapPinned, Plane, X } from 'lucide-react-native';
import { AppText, colors, radii, shadows } from '@/components/ui';
import type { PlanningContextKey, PlanningContextOption } from '@/lib/planning-context';

const selectorTestID = (key: string) =>
  `space-selector-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

function ContextIcon({ kind, selected = false }: { kind: PlanningContextOption['kind']; selected?: boolean }) {
  const color = selected ? colors.surface : kind === 'TRIP' ? colors.sage : colors.inkMuted;
  const Icon = kind === 'TRIP' ? Plane : kind === 'ALL' ? Layers3 : MapPinned;
  return <Icon color={color} size={18} strokeWidth={2} />;
}

export function SpaceSelector({
  options,
  selectedKey,
  onSelect,
}: {
  options: PlanningContextOption[];
  selectedKey: PlanningContextKey | null;
  onSelect: (key: PlanningContextKey) => void;
}) {
  const [open, setOpen] = useState<boolean>(false);
  const { height, width } = useWindowDimensions();
  const selectedOption = options.find((option) => option.key === selectedKey) ?? null;
  const wide = width >= 720;

  return (
    <View testID="space-selector" className="self-start">
      <AppText variant="label" tone="muted" className="mb-2 uppercase">
        Planning context
      </AppText>
      <Pressable
        testID="space-selector-trigger"
        accessibilityRole="button"
        accessibilityLabel={`Change planning context. Current: ${selectedOption?.label ?? 'none'}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        className="min-h-12 max-w-full flex-row items-center border px-4 active:opacity-75"
        style={{
          backgroundColor: colors.surface,
          borderColor: colors.lineStrong,
          borderRadius: radii.pill,
        }}>
        {selectedOption ? <ContextIcon kind={selectedOption.kind} /> : <MapPinned color={colors.inkMuted} size={18} />}
        <AppText variant="label" className="ml-2 min-w-0 shrink" numberOfLines={1}>
          {selectedOption?.label ?? 'Choose context'}
        </AppText>
        <ChevronDown color={colors.inkMuted} size={17} className="ml-2" />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}>
        <View
          testID="space-selector-menu"
          className={wide ? 'flex-1 items-center justify-center px-6' : 'flex-1 justify-end'}>
          <Pressable
            testID="space-selector-dismiss"
            accessibilityRole="button"
            accessibilityLabel="Close planning context menu"
            onPress={() => setOpen(false)}
            className="absolute inset-0"
            style={{ backgroundColor: 'rgba(40,38,33,0.34)' }}
          />
          <View
            className={wide ? 'w-full border p-3' : 'w-full rounded-t-[28px] border p-3 pb-8'}
            style={[
              {
                maxWidth: 520,
                maxHeight: height * 0.84,
                backgroundColor: colors.paper,
                borderColor: colors.line,
                borderRadius: wide ? radii.large : undefined,
              },
              shadows.floating,
            ]}>
            <View className="flex-row items-center justify-between px-2 pb-3 pt-1">
              <View>
                <AppText variant="heading">Plan together in…</AppText>
                <AppText variant="meta" tone="muted" className="mt-0.5">
                  Ideas follow this context across DuoDate.
                </AppText>
              </View>
              <Pressable
                testID="space-selector-close"
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setOpen(false)}
                className="h-11 w-11 items-center justify-center rounded-full active:opacity-70"
                style={{ backgroundColor: colors.surface }}>
                <X color={colors.inkSoft} size={19} />
              </Pressable>
            </View>

            <ScrollView
              testID="space-selector-options"
              showsVerticalScrollIndicator={false}
              contentContainerClassName="pb-1"
              style={{ flexShrink: 1 }}>
              {options.map((option) => {
                const selected = option.key === selectedKey;
                return (
                  <Pressable
                    key={option.key}
                    testID={selectorTestID(option.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${option.label}${selected ? ', selected' : ''}`}
                    onPress={() => {
                      onSelect(option.key);
                      setOpen(false);
                    }}
                    className="mb-2 min-h-16 flex-row items-center border px-4 active:opacity-75"
                    style={{
                      backgroundColor: selected ? colors.ink : colors.surface,
                      borderColor: selected ? colors.ink : colors.line,
                      borderRadius: radii.medium,
                    }}>
                    <View
                      className="h-10 w-10 items-center justify-center rounded-full"
                      style={{ backgroundColor: selected ? 'rgba(255,255,255,0.13)' : colors.paperDeep }}>
                      <ContextIcon kind={option.kind} selected={selected} />
                    </View>
                    <View className="ml-3 min-w-0 flex-1">
                      <AppText variant="label" tone={selected ? 'inverse' : 'default'} numberOfLines={1}>
                        {option.label}
                      </AppText>
                      <AppText
                        variant="meta"
                        numberOfLines={1}
                        style={{ color: selected ? colors.line : colors.inkMuted }}>
                        {option.detail}
                      </AppText>
                    </View>
                    {selected ? <Check color={colors.surface} size={19} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
