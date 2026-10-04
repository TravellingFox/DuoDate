import { readFileSync } from 'node:fs';
import { prepareIdeaAttachment } from './idea-attachment';
import type { ImagePickerAsset } from 'expo-image-picker';
import { createIdeaPhotoDraft, ideaPhotoDraftKey, type IdeaPhotoDraft } from './idea-photo-draft';

function asset(overrides: Partial<ImagePickerAsset> = {}): ImagePickerAsset {
  return { uri: 'file:///photo.jpg', width: 100, height: 100, type: 'image', fileSize: 1000, ...overrides };
}

const addIdeaSource = readFileSync(new URL('../app/add-idea.tsx', import.meta.url).pathname, 'utf8');

function draftFixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); },
  };
  const initial: IdeaPhotoDraft = {
    title: '', photo: null, pickerPending: false, clientRequestId: 'idea-request', savedIdeaId: null,
  };
  const key = ideaPhotoDraftKey('household', 'pablo', {});
  return { values, storage, initial, key, create: () => createIdeaPhotoDraft(storage, key, initial) };
}

describe('Native idea attachment draft lifecycle', () => {
  test('restores the title and exact photo across recreation, including a partial upload retry', async () => {
    const fixture = draftFixture();
    const first = fixture.create();
    await first.update({ title: 'Outdoor film', photo: asset({ uri: 'content://media/photo/123' }), savedIdeaId: 'saved-idea' });
    const restored = await fixture.create().restore();
    expect(restored).toMatchObject({ title: 'Outdoor film', photo: { uri: 'content://media/photo/123' }, savedIdeaId: 'saved-idea', clientRequestId: 'idea-request' });
  });

  test('recovers a result delivered after the mount check, and persists it for the next activity', async () => {
    const fixture = draftFixture();
    const beforePicker = fixture.create();
    await beforePicker.update({ title: 'Film', pickerPending: true });
    const afterRecreation = fixture.create();
    await afterRecreation.restore();
    const accepted: ImagePickerAsset[] = [];
    const errors: string[] = [];
    await afterRecreation.recover(async () => null, (photo) => accepted.push(photo), (error) => errors.push(error));
    expect(afterRecreation.value.pickerPending).toBe(true);
    await afterRecreation.recover(async () => ({ canceled: false, assets: [asset()] }), (photo) => accepted.push(photo), (error) => errors.push(error));
    expect(accepted).toEqual([asset()]);
    expect(errors).toEqual([]);
    expect(await fixture.create().restore()).toMatchObject({ title: 'Film', photo: asset(), pickerPending: false });
    let calls = 0;
    await afterRecreation.recover(async () => { calls++; return null; }, () => {}, () => {});
    expect(calls).toBe(0);
  });

  test('never consumes a pending result belonging to another media flow', async () => {
    const draft = draftFixture().create();
    let calls = 0;
    await draft.recover(async () => { calls++; return { canceled: false, assets: [asset()] }; }, () => {}, () => {});
    expect(calls).toBe(0);
  });

  test('cancellation and rejected recovery keep the existing valid attachment', async () => {
    const fixture = draftFixture();
    const draft = fixture.create();
    await draft.update({ photo: asset(), pickerPending: true });
    await draft.recover(async () => ({ canceled: true, assets: null }), () => { throw new Error('must not replace'); }, () => {});
    expect(draft.value.photo).toEqual(asset());
    await draft.update({ pickerPending: true });
    const errors: string[] = [];
    await draft.recover(async () => ({ canceled: false, assets: [asset({ type: 'video' })] }), () => { throw new Error('must not replace'); }, (error) => errors.push(error));
    expect(errors[0]).toContain('Videos are not supported');
    expect(draft.value.photo).toEqual(asset());
    expect(draft.value.pickerPending).toBe(false);
  });

  test('removal persists without losing the title; successful save clears after queued writes', async () => {
    const fixture = draftFixture();
    const draft = fixture.create();
    void draft.update({ title: 'Film', photo: asset() });
    await draft.update({ photo: null, pickerPending: false });
    expect(await fixture.create().restore()).toMatchObject({ title: 'Film', photo: null });
    void draft.update({ photo: asset() });
    await draft.clear();
    await draft.update({ photo: asset() });
    expect(fixture.values.has(fixture.key)).toBe(false);
  });

  test('does not overwrite a persisted attachment with the empty initial mount', async () => {
    const fixture = draftFixture();
    await fixture.create().update({ title: 'Kept', photo: asset() });
    const next = fixture.create();
    const restored = await next.restore();
    expect(restored.title).toBe('Kept');
    expect(restored.photo).toEqual(asset());
    expect(JSON.parse(fixture.values.get(fixture.key)!)).toMatchObject({ title: 'Kept', photo: asset() });
  });

  test('coalesces foreground checks while Android is decoding one result', async () => {
    const draft = draftFixture().create();
    await draft.update({ pickerPending: true });
    let resolve!: (result: { canceled: false; assets: ImagePickerAsset[] }) => void;
    const pending = new Promise<{ canceled: false; assets: ImagePickerAsset[] }>((done) => { resolve = done; });
    let calls = 0;
    let accepted = 0;
    const getPending = () => { calls++; return pending; };
    const first = draft.recover(getPending, () => { accepted++; }, () => {});
    const second = draft.recover(getPending, () => { accepted++; }, () => {});
    resolve({ canceled: false, assets: [asset()] });
    await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(accepted).toBe(1);
  });

  test('shares a delayed old recovery with a replacement that already restored the pending draft', async () => {
    const fixture = draftFixture();
    const old = fixture.create();
    await old.update({ title: 'Kept', pickerPending: true });
    let resolve!: (result: { canceled: false; assets: ImagePickerAsset[] }) => void;
    const pending = new Promise<{ canceled: false; assets: ImagePickerAsset[] }>((done) => { resolve = done; });
    let calls = 0;
    const recovery = old.recover(() => { calls++; return pending; }, () => {}, () => {});
    const replacement = fixture.create();
    expect(await replacement.restore()).toMatchObject({ title: 'Kept', photo: null, pickerPending: true });
    const joined = replacement.recover(() => { calls++; return pending; }, () => {}, () => {});
    expect(joined).toBe(recovery);
    resolve({ canceled: false, assets: [asset()] });
    await Promise.all([recovery, joined]);
    expect(calls).toBe(1);
    expect(replacement.value).toMatchObject({ title: 'Kept', photo: asset(), pickerPending: false });
    expect(JSON.parse(fixture.values.get(fixture.key)!)).toMatchObject({ photo: asset(), pickerPending: false });
  });

  test('a storage read started before recovery cannot overwrite its accepted photo', async () => {
    const fixture = draftFixture();
    const old = fixture.create();
    await old.update({ pickerPending: true });
    const stale = fixture.values.get(fixture.key)!;
    let completeRead!: (raw: string) => void;
    let readStarted!: () => void;
    const started = new Promise<void>((done) => { readStarted = done; });
    fixture.storage.getItem = () => { readStarted(); return new Promise<string>((done) => { completeRead = done; }); };
    const replacement = fixture.create();
    const restoring = replacement.restore();
    await started;
    await old.recover(async () => ({ canceled: false, assets: [asset()] }), () => {}, () => {});
    completeRead(stale);
    expect(await restoring).toMatchObject({ photo: asset(), pickerPending: false });
  });

  test('real recovery errors unlock every instance without removing the existing photo', async () => {
    const fixture = draftFixture();
    const old = fixture.create();
    await old.update({ photo: asset(), pickerPending: true });
    const replacement = fixture.create();
    await replacement.restore();
    const errors: string[] = [];
    await old.recover(async () => { throw new Error('native decode failed'); }, () => {}, (message) => errors.push(message));
    expect(errors).toHaveLength(1);
    expect(replacement.value).toMatchObject({ photo: asset(), pickerPending: false });
    expect(JSON.parse(fixture.values.get(fixture.key)!)).toMatchObject({ photo: asset(), pickerPending: false });
    await replacement.update({ pickerPending: true });
    await replacement.recover(async () => ({ canceled: false, assets: [asset({ uri: 'file:///next.jpg' })] }), () => {}, () => {});
    expect(old.value.photo?.uri).toBe('file:///next.jpg');
  });

  test('a synchronous recovery exception releases the shared recovery lock', async () => {
    const fixture = draftFixture();
    const draft = fixture.create();
    await draft.update({ pickerPending: true });
    await draft.recover(() => { throw new Error('native invocation failed'); }, () => {}, () => {});
    expect(draft.value.pickerPending).toBe(false);
    await draft.update({ pickerPending: true });
    await fixture.create().recover(async () => ({ canceled: false, assets: [asset()] }), () => {}, () => {});
    expect(draft.value).toMatchObject({ photo: asset(), pickerPending: false });
  });

  test('a closed draft is not reused and its decoding result cannot overwrite a new draft', async () => {
    const fixture = draftFixture();
    const old = fixture.create();
    await old.update({ title: 'Old', pickerPending: true });
    let resolve!: (result: { canceled: false; assets: ImagePickerAsset[] }) => void;
    const pending = new Promise<{ canceled: false; assets: ImagePickerAsset[] }>((done) => { resolve = done; });
    const recovering = old.recover(() => pending, () => { throw new Error('closed result'); }, () => {});
    await old.clear();
    const next = fixture.create();
    expect(await next.restore()).toEqual(fixture.initial);
    await next.update({ title: 'New', photo: asset({ uri: 'file:///new.jpg' }) });
    resolve({ canceled: false, assets: [asset()] });
    await recovering;
    await old.update({ title: 'Late old edit' });
    expect(next.value).toMatchObject({ title: 'New', photo: { uri: 'file:///new.jpg' }, pickerPending: false });
    expect(JSON.parse(fixture.values.get(fixture.key)!)).toMatchObject({ title: 'New', photo: { uri: 'file:///new.jpg' } });
  });

  test('does not share state or recovery between different storage objects with the same key', async () => {
    const first = draftFixture();
    const second = draftFixture();
    const old = first.create();
    await old.update({ title: 'First', pickerPending: true });
    const separate = second.create();
    expect(await separate.restore()).toEqual(second.initial);
    let calls = 0;
    await separate.recover(async () => { calls++; return null; }, () => {}, () => {});
    expect(calls).toBe(0);
    expect(old.value.pickerPending).toBe(true);
  });

  test('a removed photo cannot be resurrected by an already decoding pending result', async () => {
    const fixture = draftFixture();
    const draft = fixture.create();
    await draft.update({ title: 'Kept', photo: asset(), pickerPending: true });
    let resolve!: (result: { canceled: false; assets: ImagePickerAsset[] }) => void;
    const pending = new Promise<{ canceled: false; assets: ImagePickerAsset[] }>((done) => { resolve = done; });
    let accepted = 0;
    const recovery = draft.recover(() => pending, () => { accepted++; }, () => {});
    await draft.update({ photo: null, pickerPending: false });
    resolve({ canceled: false, assets: [asset()] });
    await recovery;
    expect(accepted).toBe(0);
    expect(await fixture.create().restore()).toMatchObject({ title: 'Kept', photo: null });
  });

  test('validates restored drafts without discarding the title or deleting malformed storage', async () => {
    const fixture = draftFixture();
    fixture.values.set(fixture.key, JSON.stringify({ title: 'Film', photo: asset({ type: 'video' }) }));
    expect(await fixture.create().restore()).toMatchObject({ title: 'Film', photo: null });
    const malformed = draftFixture();
    malformed.values.set(malformed.key, '{invalid');
    expect(await malformed.create().restore()).toEqual(malformed.initial);
    expect(malformed.values.get(malformed.key)).toBe('{invalid');
  });

  test('scopes drafts to account and idea context', () => {
    const key = ideaPhotoDraftKey('h1', 'pablo', { tripId: 'trip-1' });
    expect(key).not.toBe(ideaPhotoDraftKey('h1', 'luane', { tripId: 'trip-1' }));
    expect(key).not.toBe(ideaPhotoDraftKey('h2', 'pablo', { tripId: 'trip-1' }));
    expect(key).not.toBe(ideaPhotoDraftKey('h1', 'pablo', { destinationId: 'trip-1' }));
  });
});

describe('Idea photo attachments', () => {
  test('normalizes photo MIME aliases without changing the selected asset', () => {
    const selected = asset({ mimeType: 'image/jpg', fileName: 'photo.jpg' });
    const original = { ...selected };
    expect(prepareIdeaAttachment(selected)).toMatchObject({
      kind: 'PHOTO', contentType: 'image/jpeg', fileName: 'photo.jpg', error: null,
    });
    expect(selected).toEqual(original);
  });

  test('prepares captured photos and flyer images with absent MIME metadata', () => {
    expect(prepareIdeaAttachment(asset({ fileName: 'flyer.png' })))
      .toMatchObject({ kind: 'PHOTO', contentType: 'image/png', fileName: 'flyer.png', error: null });
    expect(prepareIdeaAttachment(asset({ uri: 'file:///capture.heic' })))
      .toMatchObject({ kind: 'PHOTO', contentType: 'image/heic', error: null });
    expect(prepareIdeaAttachment(asset({ uri: 'content://media/picker/123', fileName: null, mimeType: undefined })))
      .toMatchObject({ kind: 'PHOTO', contentType: 'image/jpeg', error: null });
  });

  test('rejects videos by picker type, MIME type, or filename even with missing metadata', () => {
    const videos = [
      asset({ type: 'video', uri: 'file:///capture.mov' }),
      asset({ type: 'video', mimeType: 'image/jpeg' }),
      asset({ type: undefined, mimeType: ' Video/MP4; codecs=avc1 ', fileName: 'clip' }),
      asset({ type: undefined, fileName: 'clip.MP4' }),
      asset({ type: undefined, fileName: null, uri: 'file:///capture.mov?token=123' }),
    ];
    for (const video of videos) {
      expect(prepareIdeaAttachment(video).error).toContain('Videos are not supported');
    }
  });

  test('rejects unsupported, oversized, and empty photos before saving', () => {
    expect(prepareIdeaAttachment(asset({ mimeType: 'image/gif' })).error).toContain('JPEG');
    expect(prepareIdeaAttachment(asset({ type: undefined, mimeType: 'audio/mp4' })).error).toContain('JPEG');
    expect(prepareIdeaAttachment(asset({ fileSize: 20 * 1024 * 1024 })).error).toBeNull();
    expect(prepareIdeaAttachment(asset({ fileSize: 20 * 1024 * 1024 + 1 })).error).toContain('20 MB');
    expect(prepareIdeaAttachment(asset({ fileSize: 0 })).error).toContain('empty');
  });

  test('offers one optional photo or flyer with image-only camera and library options', () => {
    expect(addIdeaSource).toContain('<FieldLabel title="Photo or flyer" />');
    expect(addIdeaSource).toContain("source: 'library' | 'camera'");
    expect(addIdeaSource).toContain("mediaTypes: ['images']");
    expect(addIdeaSource).toContain('allowsMultipleSelection: false');
    expect(addIdeaSource).toContain('ImagePicker.launchCameraAsync(options)');
    expect(addIdeaSource).toContain('ImagePicker.launchImageLibraryAsync(options)');
    expect(addIdeaSource).toContain('persistDraft({ photo: null, pickerPending: false });');
    expect(addIdeaSource).toContain('Photo attached');
    expect(addIdeaSource).not.toMatch(/video-camera|IdeaVideoPreview|capture-idea-video|Photo \/ video|photo or video/);
    expect(addIdeaSource).toContain('disabled={!hasRequiredText(title) || photoBusy || pickerBusy}');
    expect(addIdeaSource).toContain('photoOperation.current || pickerBusy');
  });

  test('keeps validated Android pending picker recovery and canceled selection handling', () => {
    expect(addIdeaSource).toContain('useNativeMediaPicker(');
    expect(addIdeaSource).toContain('launchNativeMediaPicker(');
    expect(addIdeaSource).toContain('await photoDraft?.update({ title, form: formSnapshot, pickerPending: true });');
    expect(addIdeaSource).toContain('const validationError = prepareIdeaAttachment(asset).error;');
    expect(addIdeaSource).toContain('acceptPhotoAsset(asset);');
    expect(addIdeaSource).toContain('draftSession: sessionId.current');
    expect(addIdeaSource).toContain(':${sessionId.current}`');
  });

  test('retains the same saved idea and photo for partial upload retries', () => {
    expect(addIdeaSource).toMatch(/if \(savedIdeaId\) \{\s+if \(savedAsset.current\) await uploadIdeaImage\(savedIdeaId, savedAsset.current\);\s+await photoDraft\?\.clear\(\);\s+return savedIdeaId;/);
    expect(addIdeaSource).toContain('savedAsset.current = photoDraft?.value.photo ?? photoAsset;');
    expect(addIdeaSource).toMatch(/setSavedIdeaId\(created.id\);\s+await photoDraft\?\.update\(\{ savedIdeaId: created.id \}\);\s+if \(savedAsset.current\) await uploadIdeaImage\(created.id, savedAsset.current\);/);
    expect(addIdeaSource).toContain("savedIdeaId ? 'Retry attachment'");
  });
});
