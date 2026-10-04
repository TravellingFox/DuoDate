import { readFileSync } from 'node:fs';
import { pickerFileMetadata } from './picker-file-metadata';
import { prepareIdeaAttachment } from './idea-attachment';
import { prepareMemoryPickerAssets } from './memory-capture';
import { createIdeaPhotoDraft } from './idea-photo-draft';
import type { ImagePickerAsset } from 'expo-image-picker';

const photo: ImagePickerAsset = {
  uri: 'file:///camera/photo.jpg', type: 'image', mimeType: 'image/jpeg',
  fileSize: 0, width: 1200, height: 900,
};

describe('Android returned picker file metadata', () => {
  test('validates actual photo bytes rather than the empty camera-provider size', () => {
    const normalized = pickerFileMetadata(photo, () => 4096);
    expect(photo.fileSize).toBe(0);
    expect(normalized.fileSize).toBe(4096);
    expect(prepareIdeaAttachment(normalized).error).toBeNull();
    expect(prepareMemoryPickerAssets([normalized], 'PHOTO', 0).inputs).toHaveLength(1);
  });

  test('prepares video from its real local size and retains duration', () => {
    const video = { ...photo, type: 'video' as const, mimeType: 'video/mp4', uri: 'file:///camera/video.mp4', duration: 5012.5 };
    const normalized = pickerFileMetadata(video, () => 8192);
    const prepared = prepareMemoryPickerAssets([normalized], 'VIDEO', 2);
    expect(prepared.errors).toEqual([]);
    expect(prepared.inputs[0]).toMatchObject({ kind: 'VIDEO', uri: video.uri, durationMs: 5013, sortOrder: 2 });
  });

  test('still rejects truly empty and oversized files, with safe inaccessible-file fallback', () => {
    expect(prepareIdeaAttachment(pickerFileMetadata(photo, () => 0)).error).toContain('empty');
    expect(prepareIdeaAttachment(pickerFileMetadata(photo, () => 21 * 1024 * 1024)).error).toContain('20 MB');
    expect(pickerFileMetadata(photo, () => null)).toBe(photo);
    expect(pickerFileMetadata(photo, () => Number.NaN)).toBe(photo);
  });

  test('normalizes recovered and restored Idea photos before validation', async () => {
    let raw: string | null = null;
    const storage = {
      getItem: async () => raw,
      setItem: async (_key: string, value: string) => { raw = value; },
      removeItem: async () => { raw = null; },
    };
    const create = () => createIdeaPhotoDraft(storage, 'metadata-test', {
      title: 'Photo idea', photo: null, pickerPending: false, clientRequestId: 'request', savedIdeaId: null,
    }, (asset) => pickerFileMetadata(asset, () => 4096));
    const draft = create();
    await draft.update({ pickerPending: true });
    const accepted: ImagePickerAsset[] = [];
    const errors: string[] = [];
    await draft.recover(async () => ({ canceled: false, assets: [photo] }), (asset) => accepted.push(asset), (error) => errors.push(error));
    expect(errors).toEqual([]);
    expect(accepted[0]?.fileSize).toBe(4096);
    expect((await create().restore()).photo?.fileSize).toBe(4096);
    await draft.update({ photo });
    expect((await create().restore()).photo?.fileSize).toBe(4096);
  });

  test('normalization is wired into both live and recovered capture flows', () => {
    const idea = readFileSync(new URL('../app/add-idea.tsx', import.meta.url).pathname, 'utf8');
    const memory = readFileSync(new URL('../app/memory/[id].tsx', import.meta.url).pathname, 'utf8');
    expect(idea).toContain('const asset = nativePickerAsset(selected)');
    expect(idea).toContain('}, nativePickerAsset)');
    expect(memory).toContain('.map(nativePickerAsset)');
    expect(memory).toContain('else if (!result.canceled) recoverPickerAssets.current(result.assets);');
    expect(memory).toContain('release: () => finishPicker(token)');
    expect(memory).toContain('if (settlement) settlement.deliver(result);');
  });
});
