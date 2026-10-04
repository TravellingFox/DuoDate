// @ts-expect-error Tests run in Bun, whose globals are intentionally not added to the app tsconfig.
import { describe, expect, test } from 'bun:test';
// @ts-expect-error Tests run in Bun, whose file API is intentionally not added to the app tsconfig.
import { file } from 'bun';

interface PackageManifest {
  dependencies?: Record<string, string>;
}

interface BundledNativeModules {
  'react-native-keyboard-controller': string;
}

describe('native keyboard compatibility', () => {
  test('uses the keyboard controller version bundled with this Expo SDK', async () => {
    const packageManifest = await file(
      new URL('../../package.json', import.meta.url),
    ).json() as PackageManifest;
    const bundledNativeModules = await file(
      new URL('../../node_modules/expo/bundledNativeModules.json', import.meta.url),
    ).json() as BundledNativeModules;

    expect(packageManifest.dependencies?.['react-native-keyboard-controller']).toBe(
      bundledNativeModules['react-native-keyboard-controller'],
    );
  });
});
