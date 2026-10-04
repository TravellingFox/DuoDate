import type { MediaPickerStorage } from './media-picker-lifecycle';

const queues = new WeakMap<MediaPickerStorage, Map<string, Promise<void>>>();
export async function readMediaDraft(storage: MediaPickerStorage, key: string): Promise<string | null> {
  await (queues.get(storage)?.get(key) ?? Promise.resolve()).catch(() => {});
  return storage.getItem(key);
}
export function writeMediaDraft(storage: MediaPickerStorage, key: string, value: string): Promise<void> {
  let keys = queues.get(storage);
  if (!keys) { keys = new Map(); queues.set(storage, keys); }
  const next = (keys.get(key) ?? Promise.resolve()).catch(() => {}).then(() => storage.setItem(key, value));
  keys.set(key, next);
  return next;
}
