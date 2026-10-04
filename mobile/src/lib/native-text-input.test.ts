import { readFileSync } from 'node:fs';
// @ts-expect-error Tests run in Bun, whose globals are intentionally not added to the app tsconfig.
import { describe, expect, test } from 'bun:test';

const forms = [
  {
    file: '../app/add-idea.tsx',
    fields: ['idea-title-input', 'idea-notes-input', 'idea-location-input'],
  },
  {
    file: '../app/trip-form.tsx',
    fields: ['destination-name-input', 'trip-name-input'],
  },
  {
    file: '../app/memory/[id].tsx',
    fields: ['memory-title-input', 'memory-location-input', 'memory-text-input'],
  },
  {
    file: '../app/login.tsx',
    fields: ['login-handle-input', 'login-passphrase-input'],
  },
  {
    file: '../app/(tabs)/memories.tsx',
    fields: ['memories-search-input'],
  },
] as const;

describe('native TextInput forms', () => {
  test('uses FocusableTextInput wrapper instead of the regressed StableTextInput', () => {
    for (const form of forms) {
      const source = readFileSync(new URL(form.file, import.meta.url).pathname, 'utf8');
      expect(source).toContain('FocusableTextInput');
      expect(source).not.toContain('StableTextInput');

      for (const field of form.fields) {
        expect(source).toContain(`testID="${field}"`);
      }
    }
  });

  test('does not force-blur Android inputs via TextInput.State', () => {
    // TextInput.State.blurTextInput() bypasses React Native's normal focus
    // flow and talks straight to the native Android view. Combined with
    // autoFocus, this desynced the native touch-hit-testing from what RN
    // thought was focused: after the keyboard hid, only a tap on the exact
    // prior cursor position could refocus the field. Never reintroduce this.
    const source = readFileSync(new URL('../app/add-idea.tsx', import.meta.url).pathname, 'utf8');

    expect(source).not.toContain('TextInput.State.blurTextInput');
    expect(source).not.toContain('TextInput.State.currentlyFocusedInput');
    expect(source).toContain("autoFocus={Platform.OS !== 'android'}");
  });

  test('gives Add Idea native inputs the full visible field width', () => {
    const source = readFileSync(new URL('../app/add-idea.tsx', import.meta.url).pathname, 'utf8');

    expect(source).toContain("width: '100%' as const");
    expect(source).toContain("alignSelf: 'stretch' as const");
    expect(source).toMatch(/testID="idea-title-input"[\s\S]*?containerStyle=\{inputContainerStyle\(\)\}/);
    expect(source).toMatch(/testID="idea-notes-input"[\s\S]*?containerStyle=\{inputContainerStyle\(true\)\}/);
  });
});
