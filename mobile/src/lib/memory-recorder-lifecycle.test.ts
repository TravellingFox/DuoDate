import { readFileSync } from 'node:fs';
// @ts-expect-error Tests run in Bun, whose globals are intentionally not added to the app tsconfig.
import { describe, expect, test } from 'bun:test';

const source = readFileSync(new URL('../app/memory/[id].tsx', import.meta.url).pathname, 'utf8');
const cleanupBody = source.match(/return \(\) => \{\n\s+isMounted\.current = false;([\s\S]*?)\n\s+\};\n\s+\}, \[\]\);/)?.[1];

function runCleanup(setAudioModeAsync: () => Promise<void>, warn: (...args: unknown[]) => void) {
  if (!cleanupBody) throw new Error('Memory recorder cleanup was not found');
  const isMounted = { current: true };
  const releasedRecorder = {
    get isRecording(): boolean {
      throw new Error('Cannot use shared object that was already released');
    },
    stop() {
      throw new Error('Cannot stop a released recorder');
    },
  };
  const cleanup = new Function('isMounted', 'recorder', 'setAudioModeAsync', 'console',
    `isMounted.current = false;${cleanupBody}`);
  cleanup(isMounted, releasedRecorder, setAudioModeAsync, { warn });
  return isMounted;
}

describe('Memory recorder lifecycle', () => {
  test('unmount never reads or stops the recorder already released by Expo', () => {
    const modes: unknown[] = [];
    const mounted = runCleanup(async (...args: unknown[]) => { modes.push(args[0]); }, () => {});
    expect(mounted.current).toBe(false);
    expect(modes).toEqual([{ allowsRecording: false, playsInSilentMode: true }]);
    expect(cleanupBody).not.toMatch(/recorder\./);
  });

  test('handles audio-mode reset rejection without an unhandled promise', async () => {
    const error = new Error('Audio session unavailable');
    const warnings: unknown[][] = [];
    runCleanup(async () => { throw error; }, (...args) => { warnings.push(args); });
    await Promise.resolve();
    expect(warnings).toEqual([['Could not restore playback audio mode:', error]]);
  });

  test('guards recorder access after asynchronous preparation and stopping', () => {
    expect(source).toMatch(/await requestRecordingPermissionsAsync\(\);\s+if \(!isMounted.current\) return;/);
    expect(source).toMatch(/await recorder.prepareToRecordAsync\(\);\s+if \(!isMounted.current\) return;\s+recorder.record\(\);/);
    expect(source).toMatch(/await recorder.stop\(\);\s+if \(!isMounted.current\) return;\s+const uri = recorder.uri;/);
    expect(source).toMatch(/if \(isMounted.current\) \{\s+try \{\s+if \(recorder.isRecording\) await recorder.stop\(\);/);
  });
});
