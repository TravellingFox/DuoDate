import Constants from 'expo-constants';
import { normalizeExpoBootstrapPath } from '@/lib/native-path';

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  return normalizeExpoBootstrapPath({
    path,
    initial,
    hostUri: Constants.expoConfig?.hostUri,
  });
}
