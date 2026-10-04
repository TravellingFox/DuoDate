import { createMediaPickerLifecycle } from './media-picker-lifecycle';
import { writeMediaDraft, readMediaDraft } from './media-draft-journal';

function fixture() {
  const values = new Map<string, string>();
  let fail = '';
  const storage = {
    async getItem(key: string) { return values.get(key) ?? null; },
    async setItem(key: string, value: string) { if (key.includes(fail) && fail) throw new Error('disk full'); values.set(key, value); },
    async removeItem(key: string) { if (key.includes(fail) && fail) throw new Error('disk full'); values.delete(key); },
  };
  return { values, storage, fail(key: string) { fail = key; }, create: () => createMediaPickerLifecycle<string>(storage) };
}

describe('Shared native media lifecycle', () => {
  test('one slot prevents Add Idea and Memory from stealing each other’s pending results', async () => {
    const f = fixture(); const picker = f.create();
    await picker.begin({ id: 'photo', owner: 'idea:session-a' });
    await expect(picker.begin({ id: 'video', owner: 'memory:1' })).rejects.toThrow('previous');
    await picker.recover(async () => 'photo file');
    expect(picker.receiptsFor('memory:1')).toEqual([]);
    expect(picker.receiptsFor('idea:session-a')).toHaveLength(1);
    expect(picker.receiptsFor('idea:session-b')).toEqual([]);
  });
  test('recreation recovers only the same operation and null is not cancellation', async () => {
    const f = fixture(); await f.create().begin({ id: 'photo', owner: 'idea:a' });
    const recreated = f.create(); await recreated.recover(async () => null);
    expect(recreated.busy).toBe(true);
    await recreated.recover(async () => 'file');
    expect(recreated.receiptsFor('idea:a')[0]?.id).toBe('photo');
  });
  test('live and recovery returns are acknowledged once even after restart', async () => {
    const f = fixture(); const picker = f.create(); const operation = { id: 'a', owner: 'memory' };
    await picker.begin(operation); await picker.deliver(operation, 'file');
    await picker.acknowledge('a'); await picker.deliver(operation, 'file');
    expect(picker.receiptsFor('memory')).toEqual([]);
    const recreated = f.create(); await recreated.deliver(operation, 'file');
    expect(recreated.receiptsFor('memory')).toEqual([]);
  });
  test('failed receipt writes retain the file in memory and can safely retry', async () => {
    const f = fixture(); const picker = f.create(); const operation = { id: 'a', owner: 'memory' };
    await picker.begin(operation); f.fail('receipts');
    await expect(picker.deliver(operation, 'retained-file')).rejects.toThrow('disk full');
    expect(picker.receiptsFor('memory')).toHaveLength(1);
    await expect(picker.acknowledge('a')).rejects.toThrow();
    f.fail(''); await picker.acknowledge('a');
    expect(picker.busy).toBe(false);
    expect(picker.receiptsFor('memory')).toEqual([]);
  });
  test('failed acknowledgment cleanup survives restart without duplicate delivery', async () => {
    const f = fixture(); const picker = f.create(); const operation = { id: 'a', owner: 'memory' };
    await picker.begin(operation); await picker.deliver(operation, 'file');
    f.fail('receipts'); await expect(picker.acknowledge('a')).rejects.toThrow();
    f.fail(''); await picker.acknowledge('a');
    const recreated = f.create(); await recreated.initialize();
    expect(recreated.receiptsFor('memory')).toEqual([]);
  });
  test('a failed marker cleanup is retried even after the receipt owner has navigated away', async () => {
    const f = fixture(); const picker = f.create(); const op = { id: 'a', owner: 'idea:old' };
    await picker.begin(op); f.fail('pending');
    await expect(picker.deliver(op, 'file')).rejects.toThrow();
    expect(picker.busy).toBe(true);
    f.fail(''); const recreated = f.create();
    await recreated.recover(async () => { throw new Error('must not consume another result'); });
    expect(recreated.busy).toBe(false);
    expect(recreated.receiptsFor('idea:old')).toHaveLength(1);
    await recreated.begin({ id: 'next', owner: 'memory:new' });
  });

  test('Photo, Video, cancellation, and the next Photo settle independently', async () => {
    const picker = fixture().create();
    for (const id of ['photo', 'video', 'cancel', 'next']) {
      const op = { id, owner: 'memory' }; await picker.begin(op);
      if (id === 'cancel') await picker.cancel(op);
      else { await picker.deliver(op, id); await picker.acknowledge(id); }
      expect(picker.busy).toBe(false);
    }
  });
  test('an orphan canceled after recreation does not poison a later launch', async () => {
    const f = fixture(); await f.create().begin({ id: 'old', owner: 'old' });
    const picker = f.create(); await picker.initialize(); await picker.cancelOrphan();
    await picker.begin({ id: 'new', owner: 'new' }); expect(picker.owner).toBe('new');
  });
  test('one recovery export is shared and cannot be canceled while decoding', async () => {
    const picker = fixture().create(); await picker.begin({ id: 'a', owner: 'memory' });
    let resolve!: (value: string) => void; let calls = 0;
    const pending = new Promise<string>((done) => { resolve = done; });
    const first = picker.recover(() => { calls++; return pending; });
    const second = picker.recover(() => { calls++; return pending; });
    await Promise.resolve(); await picker.cancelOrphan(); resolve('file'); await Promise.all([first, second]);
    expect(calls).toBe(1); expect(picker.receiptsFor('memory')).toHaveLength(1);
  });
  test('journal writes recover after failure and replacement screens wait for queued writes', async () => {
    const f = fixture(); f.fail('draft');
    await expect(writeMediaDraft(f.storage, 'draft', 'old')).rejects.toThrow();
    f.fail(''); const write = writeMediaDraft(f.storage, 'draft', 'new');
    expect(await readMediaDraft(f.storage, 'draft')).toBe('new'); await write;
  });
});
