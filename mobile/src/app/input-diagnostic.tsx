import { useState } from 'react';
import { Text, View } from 'react-native';
import { FocusableTextInput } from '@/components/ui';

export default function InputDiagnosticScreen() {
  const [value, setValue] = useState<string>('');
  const [multilineValue, setMultilineValue] = useState<string>('');

  if (!__DEV__) return null;

  return (
    <View
      testID="input-diagnostic-screen"
      style={{ flex: 1, gap: 16, padding: 24, backgroundColor: '#fffaf6' }}>
      <Text style={{ fontSize: 24, fontWeight: '600', color: '#2f2926' }}>
        Native input diagnostic
      </Text>

      <FocusableTextInput
        testID="input-diagnostic-input"
        accessibilityLabel="Native input diagnostic"
        value={value}
        onChangeText={setValue}
        placeholder="Type here"
        placeholderTextColor="#857974"
        containerStyle={{
          minHeight: 54,
          borderWidth: 1,
          borderColor: '#a99d97',
          borderRadius: 12,
          backgroundColor: '#ffffff',
        }}
        style={{
          flex: 1,
          paddingHorizontal: 16,
          fontSize: 16,
          color: '#2f2926',
        }}
      />

      <Text testID="input-diagnostic-value" style={{ fontSize: 16, color: '#2f2926' }}>
        Current value: {value}
      </Text>

      <FocusableTextInput
        testID="input-diagnostic-multiline-input"
        accessibilityLabel="Native multiline input diagnostic"
        multiline
        textAlignVertical="top"
        value={multilineValue}
        onChangeText={setMultilineValue}
        placeholder="Optional multiline input"
        placeholderTextColor="#857974"
        containerStyle={{
          minHeight: 120,
          borderWidth: 1,
          borderColor: '#a99d97',
          borderRadius: 12,
          backgroundColor: '#ffffff',
        }}
        style={{
          flex: 1,
          padding: 16,
          fontSize: 16,
          color: '#2f2926',
        }}
      />
    </View>
  );
}
