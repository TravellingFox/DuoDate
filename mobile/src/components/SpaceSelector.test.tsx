import React from 'react';
// @ts-expect-error The package is installed, but this workspace does not include its optional type package.
import { act, create } from 'react-test-renderer';
// @ts-expect-error Tests run in Bun, whose globals are intentionally not added to the app tsconfig.
import { describe, expect, mock, test } from 'bun:test';
import type { PlanningContextKey, PlanningContextOption } from '@/lib/planning-context';

mock.module('react-native', () => ({
  Modal: ({ visible, children, ...props }: { visible: boolean; children: React.ReactNode }) =>
    visible ? React.createElement('Modal', props, children) : null,
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
}));

mock.module('lucide-react-native', () => ({
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  Layers3: 'Layers3',
  MapPinned: 'MapPinned',
  Plane: 'Plane',
  X: 'X',
}));

mock.module('@/components/ui', () => ({
  AppText: 'AppText',
  colors: {
    surface: '#fff',
    sage: '#758B78',
    inkMuted: '#8A8478',
    lineStrong: '#CFC2B1',
    paper: '#F7F2E8',
    line: '#DED5C7',
    ink: '#282621',
    paperDeep: '#EFE6D7',
  },
  radii: { pill: 999, large: 24, medium: 16 },
  shadows: { floating: {} },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { SpaceSelector } = await import('./SpaceSelector');

const options: PlanningContextOption[] = [
  { key: 'TRIP:trip-1', kind: 'TRIP', label: 'Lisbon', detail: 'Active trip' },
  { key: 'ALL', kind: 'ALL', label: 'All spaces', detail: 'Your full active idea pool' },
  { key: 'SPACE:home', kind: 'SPACE', label: 'Close to home', detail: 'Space' },
];

describe('SpaceSelector', () => {
  test('opens from the current selection and closes after choosing another context', () => {
    let selected: PlanningContextKey | null = 'TRIP:trip-1';
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = create(
        <SpaceSelector options={options} selectedKey={selected} onSelect={(key) => { selected = key; }} />,
      );
    });

    const root = renderer!.root;
    const trigger = root.findByProps({ testID: 'space-selector-trigger' });
    expect(trigger.props.accessibilityLabel).toContain('Lisbon');
    expect(root.findAllByProps({ testID: 'space-selector-menu' })).toHaveLength(0);

    act(() => trigger.props.onPress());
    expect(root.findAllByProps({ testID: 'space-selector-menu' })).toHaveLength(1);

    act(() => root.findByProps({ testID: 'space-selector-space-home' }).props.onPress());
    expect(selected).toBe('SPACE:home');
    expect(root.findAllByProps({ testID: 'space-selector-menu' })).toHaveLength(0);
  });
});
