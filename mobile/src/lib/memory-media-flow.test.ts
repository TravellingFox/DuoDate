import { readFileSync } from 'node:fs';
// @ts-expect-error Tests run in Bun, whose globals are intentionally not added to the app tsconfig.
import { describe, expect, test } from 'bun:test';
import { deferMediaAction } from './deferred-media-action';

const source = readFileSync(new URL('../app/memory/[id].tsx', import.meta.url).pathname, 'utf8');

describe('Memory native media handoff', () => {
  test('retains the selected action until the modal dismissal delay and launches once', async () => {
    let launches = 0;
    deferMediaAction(() => { launches += 1; }, 10);
    expect(launches).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(launches).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(launches).toBe(1);
  });

  test('cancels a handoff when the screen unmounts', async () => {
    let launches = 0;
    const cancel = deferMediaAction(() => { launches += 1; }, 10);
    cancel();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(launches).toBe(0);
  });

  test('every photo/video choice queues its native action and Android recovers picker results', () => {
    expect(source).toContain('selectMediaAction(choosePhotos)');
    expect(source).toContain('selectMediaAction(chooseVideo)');
    expect(source).toContain("selectMediaAction(() => captureWithCamera('PHOTO'))");
    expect(source).toContain("selectMediaAction(() => captureWithCamera('VIDEO'))");
    expect(source).toContain('onDismiss={launchMediaAction}');
    expect(source).toContain("animationType={Platform.OS === 'android' ? 'none' : 'fade'}");
    expect(source).toContain('pendingAction.current = null');
    expect(source).toContain('useNativeMediaPicker(`memory:${memoryId}`');
    expect(source).toContain('await launchNativeMediaPicker(`memory:${memoryId}`');
    expect(source).toContain('claimedReceipts.current.includes(receiptId)');
    expect(source).toContain('await enqueueUploads(inputs)');
  });
});

describe('Memory contribution completion', () => {
  test('a saved voice note exits even if local draft cleanup is delayed', async () => {
    const completion = source.slice(source.indexOf('const saveMemory = useMutation'));
    const success = completion.match(/onSuccess: \(saved\) => \{([\s\S]*?)\n    \},\n    onError: \(error\) => setCaptureError/)?.[1];
    expect(success).toBeDefined();
    let release!: () => void;
    const writes = new Promise<void>((resolve) => { release = resolve; });
    const events: string[] = [];
    const complete = new Function('saved', 'acceptMemory', 'Platform', 'draftStorageQueue', 'mediaStorage', 'draftStorageKey', 'router', 'draftClosed', success!);
    complete({ mediaItems: [{ kind: 'VOICE_NOTE', byteSize: 1024 }] }, () => events.push('cache'),
      { OS: 'android' }, { current: writes }, { removeItem: async () => { events.push('cleanup'); } },
      'draft', { dismissTo: (route: string) => events.push(route) }, { current: false });
    expect(events).toEqual(['cache', '/memories']);
    release();
    await writes;
    await Promise.resolve();
    expect(events).toEqual(['cache', '/memories', 'cleanup']);
  });

  test('places manual Add Memory above the album and removes unwanted copy', () => {
    const album = readFileSync(new URL('../app/(tabs)/memories.tsx', import.meta.url).pathname, 'utf8');
    expect(album.indexOf('testID="new-spontaneous-memory-button"')).toBeLessThan(album.indexOf('testID="memories-saved-section"'));
    expect(album.match(/testID="new-spontaneous-memory-button"/g)).toHaveLength(1);
    expect(source).not.toContain('Another one for us');
    expect(source).not.toContain('Opening media picker');
  });
  test('direct creation skips the light pre-composer and edits details in the warm capture', () => {
    const entry = readFileSync(new URL('../app/memory/new.tsx', import.meta.url).pathname, 'utf8');
    expect(entry).not.toContain('Create a Memory');
    expect(entry).not.toContain('FocusableTextInput');
    expect(entry).toContain("editDetails: '1'");
    expect(source).toContain('testID="memory-title-input"');
    expect(source).toContain('testID="memory-location-input"');
    expect(source).toContain('KeyboardAwareScrollView');
    expect(source).toContain('bottomOffset={24}');
  });

  test('new spontaneous Memory title is an empty draft and Photo has one source entry', () => {
    const entry = readFileSync(new URL('../app/memory/new.tsx', import.meta.url).pathname, 'utf8');
    expect(entry).toContain("emptyTitle: '1'");
    expect(source).toContain("current ?? { title: '', date:");
    expect(source).toContain('value={detailValue.title} placeholder="Our spontaneous memory"');
    expect(source).not.toContain('Choose existing photos');
    expect(source).not.toContain('memory-photo-library-button');
    expect(source).toMatch(/testID="add-memory-photo"[^\n]+onPress=\{\(\) => setPhotoMenu\(true\)\}/);
    expect(source).toContain('testID="take-memory-photo"');
    expect(source).toContain('testID="choose-memory-photos"');
  });

  test('preserves voice duration before stop and blocks completion during preparation', () => {
    expect(source).toMatch(/const durationMs = Math.max\(0, Math.round\(recorder.getStatus\(\).durationMillis\)\);\s+await recorder.stop\(\);/);
    expect(source).toContain('setVoiceBusy(true)');
    expect(source).toContain('voiceOperation.current = false');
  });
  test('renders local selected photo/video previews and accepts persisted media into detail cache', () => {
    expect(source).toContain('memory-draft-photo-${draft.id}');
    expect(source).toContain('memory-draft-video-${draft.id}');
    expect(source).toContain('acceptMemory(result.memory)');
    expect(source).toContain('queryClient.cancelQueries({ queryKey: queryKeys.memory(value.id) })');
    expect(source).toContain('media={media}');
  });

  test('offers explicit Save Memory and waits for all uploads and valid persisted content', () => {
    expect(source).toContain('testID="save-memory-button"');
    expect(source).toContain('hasActiveContributions(uploads)');
    expect(source).toContain('canCompleteMemory({');
    expect(source).toContain('discard-memory-upload-${draft.id}');
    expect(source).toContain('scope: contributionScope');
    expect(source).toContain('disabled={!canSaveMemory || saveMemory.isPending}');
    expect(source).toContain('await addText.mutateAsync(text.trim())');
    expect(source).toContain('!hasMemoryContent(saved)');
    expect(source).toContain('const saved = acknowledgedMemory.current ?? await memorySaveRequest');
    expect(source).toContain('voiceOperation.current || voiceRecordingRef.current || recorder.isRecording');
    expect(source).toContain('voiceRecordingRef.current = true');
    expect(source).toContain('pickerOperation.current.busy');
    expect(source).toContain("router.dismissTo('/memories')");
  });
});
