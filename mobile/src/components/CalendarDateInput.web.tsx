import type { ChangeEvent } from 'react';
import { colors, radii } from '@/components/ui';

export function CalendarDateInput({
  value,
  minimumDate,
  onChange,
  testID,
}: {
  value: string;
  minimumDate?: string;
  timeZone: string;
  onChange: (value: string) => void;
  onDismiss?: () => void;
  testID: string;
}) {
  return (
    <input
      data-testid={testID}
      aria-label="Choose calendar date"
      type="date"
      value={value}
      min={minimumDate}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.currentTarget.value)}
      style={{
        width: '100%',
        minHeight: 48,
        padding: '0 14px',
        boxSizing: 'border-box',
        color: colors.ink,
        backgroundColor: colors.surface,
        border: `1px solid ${colors.lineStrong}`,
        borderRadius: radii.medium,
        fontSize: 16,
        fontFamily: 'inherit',
      }}
    />
  );
}
