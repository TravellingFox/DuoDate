import type { MediaPickerStorage } from './media-picker-lifecycle';

export interface MediaJournal {
  read(key: string): { value: string | null } | null;
  write(key: string, value: string | null): void;
}

// The document journal is the commit. AsyncStorage is only a best-effort
// replica: a stalled native bridge must not hold the picker receipt queue.
export function createJournaledMediaStorage(journal: MediaJournal, replica: MediaPickerStorage): MediaPickerStorage {
  const replicate = (operation: () => Promise<void>) => {
    void Promise.resolve().then(operation).catch(() => {});
  };
  return {
    async getItem(key) {
      const record = journal.read(key);
      return record ? record.value : replica.getItem(key);
    },
    async setItem(key, value) {
      journal.write(key, value);
      replicate(() => replica.setItem(key, value));
    },
    async removeItem(key) {
      journal.write(key, null);
      replicate(() => replica.removeItem(key));
    },
  };
}
