import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/memory/[id].tsx', import.meta.url).pathname, 'utf8');
const startBody = source.slice(source.indexOf('  const startVoiceNote = async () => {') + '  const startVoiceNote = async () => {'.length, source.indexOf('\n  const stopVoiceNote'));
const stopBody = source.slice(source.indexOf('  const stopVoiceNote = async () => {') + '  const stopVoiceNote = async () => {'.length, source.indexOf('\n  const saveMemory'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function pickerHandler(name: string, next: string) {
  const header = name === 'captureWithCamera'
    ? "  const captureWithCamera = async (kind: 'PHOTO' | 'VIDEO') => {"
    : `  const ${name} = async () => {`;
  return source.slice(source.indexOf(header) + header.length, source.indexOf(`\n  const ${next}`)).replace(/\n  };\s*$/, '');
}

function voiceFixture() {
  const events: string[] = [];
  const state = { current: false };
  const operation = { current: false };
  const picker = { current: { busy: false } };
  const errors: string[] = [];
  const contributions: unknown[] = [];
  let busy = false;
  let recording = false;
  const recorder = {
    isRecording: false,
    uri: 'file:///note.m4a',
    prepareToRecordAsync: async () => { events.push('prepare'); },
    record: () => { events.push('record'); recorder.isRecording = true; },
    getStatus: () => ({ isRecording: recorder.isRecording, durationMillis: 3000 }),
    stop: async () => { events.push('stop'); recorder.isRecording = false; },
  };
  const keys = ['voiceOperation', 'voiceRecordingRef', 'recorder', 'pickerOperation', 'sharedPickerBusy', 'saveMemory', 'setCaptureError', 'setVoiceBusy', 'requestRecordingPermissionsAsync', 'isMounted', 'setAudioModeAsync', 'setVoiceRecording', 'console', 'Platform', 'File', 'validateMemoryMedia', 'enqueueUploads', 'mediaFileName', 'nextQueuedMediaSortOrder', 'setVoiceOpen', 'uploadMessage'];
  const values = [operation, state, recorder, picker, false, { isPending: false }, (message: string | null) => { if (message) errors.push(message); }, (value: boolean) => { busy = value; }, async () => ({ granted: true }), { current: true }, async (mode: { allowsRecording: boolean }) => { events.push(mode.allowsRecording ? 'record-mode' : 'playback-mode'); }, (value: boolean) => { recording = value; }, { info: () => {}, warn: () => {} }, { OS: 'android' }, class { size = 4096; }, () => null, (inputs: unknown[]) => contributions.push(...inputs), () => 'note.m4a', () => 0, () => {}, (error: Error) => error.message];
  return { events, errors, contributions, recorder, picker, state, operation, get busy() { return busy; }, get recording() { return recording; }, start: new AsyncFunction(...keys, startBody.replace(/\n  };\s*$/, '')), stop: new AsyncFunction(...keys, stopBody.replace(/\n  };\s*$/, '').replace('let file: Blob | undefined;', 'let file;').replace('let byteSize: number | undefined;', 'let byteSize;')), values };
}

describe('Memory native picker handlers with Android API doubles', () => {
  test.each([
    ['choosePhotos', 'chooseVideo', 'PHOTO', 'library'],
    ['chooseVideo', 'captureWithCamera', 'VIDEO', 'library'],
    ['captureWithCamera', 'startVoiceNote', 'PHOTO', 'camera'],
    ['captureWithCamera', 'startVoiceNote', 'VIDEO', 'camera'],
  ])('%s launches %s and accepts its returned contribution', async (name, next, kind, expectedSource) => {
    const events: string[] = [];
    const assets = [{ uri: 'file:///selected', type: kind === 'PHOTO' ? 'image' : 'video' }];
    const keys = ['kind', 'setCaptureError', 'Platform', 'draftStorageQueue', 'memoryId', 'ImagePicker', 'requestRecordingPermissionsAsync', 'launchNativeMediaPicker'];
    const launched = async (options: { mediaTypes: string[] }, launchSource: string) => {
      events.push(`${launchSource}:${options.mediaTypes[0]}`);
      return { canceled: false, assets };
    };
    const run = new AsyncFunction(...keys, pickerHandler(name!, next!).replace(/memoryId!/g, 'memoryId'));
    await run(kind, () => {}, { OS: 'android' }, { current: Promise.resolve() }, 'memory',
      { requestCameraPermissionsAsync: async () => ({ granted: true }), launchCameraAsync: (options: { mediaTypes: string[] }) => launched(options, 'camera'), launchImageLibraryAsync: (options: { mediaTypes: string[] }) => launched(options, 'library') },
      async () => ({ granted: true }), async (owner: string, launch: () => Promise<{ assets: typeof assets }>) => {
        expect(owner).toBe('memory:memory'); events.push('shared');
        const result = await launch(); expect(result.assets).toBe(assets); events.push(`preview:${kind}`);
      });
    expect(events).toEqual(['shared', `${expectedSource}:${kind === 'PHOTO' ? 'images' : 'videos'}`, `preview:${kind}`]);
  });
});

describe('Memory native recorder handlers with Android API doubles', () => {
  test('Start prepares and records, Stop accepts voice contribution and restores mode', async () => {
    const fixture = voiceFixture();
    await fixture.start(...fixture.values);
    expect(fixture.events).toEqual(['record-mode', 'prepare', 'record']);
    expect(fixture.recording).toBe(true);
    expect(fixture.busy).toBe(false);
    await fixture.stop(...fixture.values);
    expect(fixture.events).toEqual(['record-mode', 'prepare', 'record', 'stop', 'playback-mode']);
    expect(fixture.recording).toBe(false);
    expect(fixture.contributions).toEqual([expect.objectContaining({ kind: 'VOICE_NOTE', uri: 'file:///note.m4a', durationMs: 3000 })]);
    expect(fixture.errors).toEqual([]);
  });

  test('preparation failure releases recorder/mode and allows a second Start', async () => {
    const fixture = voiceFixture();
    fixture.recorder.prepareToRecordAsync = async () => { throw new Error('Mic unavailable'); };
    await fixture.start(...fixture.values);
    expect(fixture.operation.current).toBe(false);
    expect(fixture.state.current).toBe(false);
    expect(fixture.busy).toBe(false);
    expect(fixture.events).toEqual(['record-mode', 'stop', 'playback-mode']);
    fixture.recorder.prepareToRecordAsync = async () => {};
    await fixture.start(...fixture.values);
    expect(fixture.recording).toBe(true);
  });

  test('pending picker blocks recording with visible feedback instead of silently doing nothing', async () => {
    const fixture = voiceFixture();
    fixture.picker.current.busy = true;
    await fixture.start(...fixture.values);
    expect(fixture.events).toEqual([]);
    expect(fixture.errors).toEqual(['The previous media selection is still returning. Please wait for it to finish.']);
  });
});
