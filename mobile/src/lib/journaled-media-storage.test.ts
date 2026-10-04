import { createJournaledMediaStorage } from './journaled-media-storage';
import { createMediaPickerLifecycle } from './media-picker-lifecycle';
import { createIdeaPhotoDraft } from './idea-photo-draft';
import type { ImagePickerAsset } from 'expo-image-picker';

function fixture() {
  const records = new Map<string, { value: string | null }>();
  const never = new Promise<void>(() => {});
  const replica = {
    getItem: async () => null,
    setItem: () => never,
    removeItem: () => never,
  };
  const storage = createJournaledMediaStorage({
    read: (key) => records.get(key) ?? null,
    write: (key, value) => { records.set(key, { value }); },
  }, replica);
  return { records, storage };
}

async function mustSettle<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Transition waited for the secondary storage bridge')), 100);
    })]);
  } finally { clearTimeout(timer); }
}

describe('Native return with a stalled AsyncStorage replica', () => {
  test('journal commits and tombstones never await the secondary bridge', async () => {
    const { storage } = fixture();
    await mustSettle(storage.setItem('draft', 'photo'));
    expect(await storage.getItem('draft')).toBe('photo');
    await mustSettle(storage.removeItem('draft'));
    expect(await storage.getItem('draft')).toBeNull();
  });

  test('native photo -> receipt -> owner -> preview/draft -> acknowledgment -> next Memory picker', async () => {
    const { storage } = fixture();
    const picker = createMediaPickerLifecycle<ImagePickerAsset>(storage);
    const photo = { uri: 'file:///retained/photo.jpg', width: 100, height: 100, fileSize: 1000, type: 'image' as const };
    const owner = 'idea:session-a';
    const draft = createIdeaPhotoDraft(storage, owner, {
      title: 'Photo idea', photo: null, pickerPending: false, clientRequestId: 'idea-a', savedIdeaId: null,
    });
    await mustSettle(draft.update({ pickerPending: true }));
    await mustSettle(picker.begin({ id: 'photo-a', owner }));
    let preview: ImagePickerAsset | null = null;
    let delivery: Promise<void> | undefined;
    const unsubscribe = picker.subscribe(() => {
      const receipt = picker.receiptsFor(owner)[0];
      if (!receipt || delivery) return;
      delivery = (async () => {
        await picker.retainReceipt(receipt.id, receipt.result);
        preview = receipt.result;
        await draft.update({ photo: receipt.result, pickerPending: false });
        await picker.acknowledge(receipt.id);
      })();
    });
    await mustSettle(picker.deliver({ id: 'photo-a', owner }, photo));
    await mustSettle(delivery!);
    expect(preview).toEqual(photo);
    expect(draft.value).toMatchObject({ photo, pickerPending: false });
    expect(picker.busy).toBe(false);
    expect(picker.receiptsFor(owner)).toEqual([]);
    await mustSettle(picker.begin({ id: 'memory-video', owner: 'memory:1' }));
    await mustSettle(picker.cancel({ id: 'memory-video', owner: 'memory:1' }));
    expect(picker.busy).toBe(false);
    unsubscribe();
  });

  test('a canceled native return settles without changing the existing photo', async () => {
    const { storage } = fixture();
    const picker = createMediaPickerLifecycle<{ canceled: boolean }>(storage);
    const op = { id: 'cancel-a', owner: 'idea:a' };
    await mustSettle(picker.begin(op));
    await mustSettle(picker.deliver(op, { canceled: true }));
    expect(picker.receiptsFor(op.owner)[0]?.result.canceled).toBe(true);
    await mustSettle(picker.acknowledge(op.id));
    expect(picker.busy).toBe(false);
    await mustSettle(picker.begin({ id: 'next', owner: 'memory:1' }));
  });

  test('a real authoritative write failure still rejects instead of acknowledging lost media', async () => {
    const storage = createJournaledMediaStorage({
      read: () => null, write: () => { throw new Error('document volume full'); },
    }, { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} });
    await expect(storage.setItem('receipt', 'file')).rejects.toThrow('document volume full');
  });
});
