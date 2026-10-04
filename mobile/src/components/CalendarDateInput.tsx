import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Platform } from 'react-native';
import { dateForZonedWallTime, calendarDateInTimeZone } from '@/lib/format';

export function CalendarDateInput({
  value,
  minimumDate,
  timeZone,
  onChange,
  onDismiss,
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
    <DateTimePicker
      testID={testID}
      value={dateForZonedWallTime(value, '12:00', timeZone)}
      minimumDate={minimumDate ? dateForZonedWallTime(minimumDate, '12:00', timeZone) : undefined}
      mode="date"
      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
      timeZoneName={timeZone}
      onChange={(event: DateTimePickerEvent, selected?: Date) => {
        if (event.type !== 'set') {
          onDismiss?.();
          return;
        }
        if (selected) onChange(calendarDateInTimeZone(selected, timeZone));
      }}
    />
  );
}
