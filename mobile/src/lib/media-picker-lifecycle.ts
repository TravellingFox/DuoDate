import { mediaPickerLog } from './media-picker-log';

export interface MediaPickerStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
export interface MediaPickerOperation { id: string; owner: string }
export interface MediaPickerReceipt<T> extends MediaPickerOperation { result: T }
const pendingKey = 'duodate.media-picker.pending.v2';
const receiptKey = 'duodate.media-picker.receipts.v2';
const completedKey = 'duodate.media-picker.completed.v2';

// Expo has one application-wide pending slot. Serialized receipts are replayed
// until the owner has durably accepted them; acknowledgments prevent a live
// promise and recovery from claiming the same operation twice.
export function createMediaPickerLifecycle<T>(storage: MediaPickerStorage) {
  let pending: MediaPickerOperation | null = null;
  let receipts: MediaPickerReceipt<T>[] = [];
  let completed: string[] = [];
  let loaded = false;
  let queue: Promise<unknown> = Promise.resolve();
  let recovering: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const serialize = <R>(action: () => Promise<R>): Promise<R> => {
    const next = queue.catch(() => {}).then(action);
    queue = next;
    return next;
  };
  const load = async () => {
    if (loaded) return;
    const [rawPending, rawReceipts, rawCompleted] = await Promise.all([
      storage.getItem(pendingKey), storage.getItem(receiptKey), storage.getItem(completedKey),
    ]);
    pending = rawPending ? JSON.parse(rawPending) : null;
    completed = rawCompleted ? JSON.parse(rawCompleted) : [];
    receipts = (rawReceipts ? JSON.parse(rawReceipts) : []).filter((item: MediaPickerReceipt<T>) => !completed.includes(item.id));
    loaded = true;
  };
  const storeReceipts = () => storage.setItem(receiptKey, JSON.stringify(receipts));
  const deliver = (operation: MediaPickerOperation, result: T) => serialize(async () => {
    await load();
    if (completed.includes(operation.id)) return;
    if (!receipts.some((receipt) => receipt.id === operation.id)) {
      receipts.push({ ...operation, result });
      mediaPickerLog('receipt-created', operation.id, operation.owner);
    }
    notify();
    await storeReceipts();
    if (pending?.id === operation.id) {
      await storage.removeItem(pendingKey);
      pending = null;
      mediaPickerLog('busy-released', operation.id, operation.owner);
      notify();
    }
  });
  const cancel = (operation: MediaPickerOperation) => serialize(async () => {
    await load();
    if (pending?.id !== operation.id || receipts.some((receipt) => receipt.id === operation.id)) return;
    await storage.removeItem(pendingKey);
    pending = null;
    mediaPickerLog('busy-released-cancel', operation.id, operation.owner);
    notify();
  });
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    get busy() { return pending !== null; },
    get owner() { return pending?.owner ?? null; },
    initialize: () => serialize(load),
    receiptsFor(owner: string) { return receipts.filter((receipt) => receipt.owner === owner); },
    begin(operation: MediaPickerOperation): Promise<void> {
      return serialize(async () => {
        await load();
        if (pending) throw new Error('The previous media selection is still returning. Please wait for it to finish.');
        await storage.setItem(pendingKey, JSON.stringify(operation));
        pending = operation;
        notify();
      });
    },
    deliver,
    retainReceipt(id: string, result: T): Promise<void> {
      return serialize(async () => {
        await load();
        receipts = receipts.map((receipt) => receipt.id === id ? { ...receipt, result } : receipt);
        await storeReceipts();
      });
    },
    async recover(read: () => Promise<T | null>): Promise<void> {
      if (recovering) return recovering;
      recovering = (async () => {
        await serialize(load);
        const operation = pending;
        if (!operation) return;
        const receipt = receipts.find((item) => item.id === operation.id);
        if (receipt) {
          // A prior receipt commit may have succeeded before marker cleanup
          // failed. Settle that marker without consuming another native result
          // or requiring the original screen to still be mounted.
          await deliver(operation, receipt.result);
          return;
        }
        const result = await read();
        if (result !== null) {
          mediaPickerLog('native-return-recovery', operation.id, operation.owner);
          await deliver(operation, result);
        }
      })().finally(() => { recovering = null; });
      return recovering;
    },
    acknowledge(id: string): Promise<void> {
      return serialize(async () => {
        await load();
        await storeReceipts();
        if (pending?.id === id) {
          await storage.removeItem(pendingKey);
          pending = null;
          mediaPickerLog('busy-released-ack', id);
        }
        const nextCompleted = completed.includes(id) ? completed : [...completed, id];
        await storage.setItem(completedKey, JSON.stringify(nextCompleted));
        completed = nextCompleted;
        const remaining = receipts.filter((receipt) => receipt.id !== id);
        await storage.setItem(receiptKey, JSON.stringify(remaining));
        receipts = remaining;
        mediaPickerLog('acknowledged', id);
        notify();
      });
    },
    cancel,
    async cancelOrphan(): Promise<void> {
      if (recovering || !pending) return;
      await cancel(pending);
    },
  };
}
