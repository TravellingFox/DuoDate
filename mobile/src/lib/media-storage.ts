import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { createJournaledMediaStorage } from './journaled-media-storage';

type RecordValue = { revision: number; value: string | null };
function slots(key: string): File[] {
  const directory = new Directory(Paths.document, 'media-journal');
  directory.create({ intermediates: true, idempotent: true });
  const chunks = encodeURIComponent(key).match(/.{1,100}/g) ?? ['empty'];
  const parent = new Directory(directory, ...chunks.slice(0, -1));
  parent.create({ intermediates: true, idempotent: true });
  return [0, 1].map((slot) => new File(parent, `${chunks[chunks.length - 1]}.${slot}.json`));
}
function readSlot(file: File): RecordValue | null {
  try {
    const value = JSON.parse(file.textSync()) as RecordValue;
    return Number.isSafeInteger(value.revision) && (value.value === null || typeof value.value === 'string') ? value : null;
  } catch { return null; }
}
function current(key: string) {
  const files = slots(key);
  const records = files.map(readSlot);
  const index = (records[1]?.revision ?? -1) > (records[0]?.revision ?? -1) ? 1 : 0;
  return { files, index, record: records[index] };
}
function write(key: string, value: string | null) {
  const { files, index, record } = current(key);
  // Never truncate the committed slot. A torn replacement is ignored on read.
  const target = files[1 - index]!;
  const next = { revision: (record?.revision ?? 0) + 1, value };
  target.write(JSON.stringify(next));
  if (readSlot(target)?.revision !== next.revision) throw new Error('Media journal could not be committed.');
}

// Private document journal is authoritative; AsyncStorage is a secondary copy.
// Tombstones keep failed cleanup from resurrecting an older attachment.
export const mediaStorage = Platform.OS === 'web' ? AsyncStorage : createJournaledMediaStorage({
  read: (key) => current(key).record,
  write,
}, AsyncStorage);
