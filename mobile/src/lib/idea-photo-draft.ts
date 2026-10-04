import type { ImagePickerAsset } from 'expo-image-picker';
import { selectedPickerAsset, type PickerResultLike } from './form-state';
import { prepareIdeaAttachment } from './idea-attachment';

interface DraftStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface IdeaPhotoDraft {
  title: string;
  photo: ImagePickerAsset | null;
  pickerPending: boolean;
  clientRequestId: string;
  savedIdeaId: string | null;
  form?: Record<string, unknown>;
}

// Queue across screen instances as well as within one instance. A late write
// from the old activity must not resurrect a removed photo or a saved draft.
const storageWrites = new WeakMap<DraftStorage, Map<string, Promise<void>>>();
function writesFor(storage: DraftStorage) {
  let writes = storageWrites.get(storage);
  if (!writes) {
    writes = new Map();
    storageWrites.set(storage, writes);
  }
  return writes;
}
function enqueue(storage: DraftStorage, key: string, operation: () => Promise<void>): Promise<void> {
  const writes = writesFor(storage);
  const next = (writes.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  writes.set(key, next);
  void next.finally(() => {
    if (writes.get(key) === next) writes.delete(key);
  }).catch(() => {});
  return next;
}

interface SharedDraft {
  draft: IdeaPhotoDraft;
  closed: boolean;
  revision: number;
  recovery: Promise<void> | null;
}

// Recreated screens must see a result still being decoded by their predecessor.
// Storage identity also isolates independent stores using the same draft key.
const storageDrafts = new WeakMap<DraftStorage, Map<string, SharedDraft>>();

export function ideaPhotoDraftKey(
  householdId: string,
  userId: string,
  context: { spaceId?: string; destinationId?: string; tripId?: string },
): string {
  return `duodate:add-idea-photo:v1:${JSON.stringify([householdId, userId, context.spaceId ?? null, context.destinationId ?? null, context.tripId ?? null])}`;
}

export function createIdeaPhotoDraft(
  storage: DraftStorage,
  key: string,
  initial: IdeaPhotoDraft,
  normalizeAsset: (asset: ImagePickerAsset) => ImagePickerAsset = (asset) => asset,
) {
  let drafts = storageDrafts.get(storage);
  if (!drafts) {
    drafts = new Map();
    storageDrafts.set(storage, drafts);
  }
  const existing = drafts.get(key);
  const shared: SharedDraft = existing && !existing.closed ? existing : {
    draft: initial, closed: false, revision: 0, recovery: null,
  };
  drafts.set(key, shared);
  return {
    get value() { return shared.draft; },
    async restore(): Promise<IdeaPhotoDraft> {
      // Do not let a storage read overwrite an edit or recovery completed while
      // that read was pending, including one made by another screen instance.
      const revision = shared.revision;
      await (writesFor(storage).get(key) ?? Promise.resolve()).catch(() => {});
      if (shared.closed) return shared.draft;
      const raw = await storage.getItem(key);
      if (!raw || shared.closed || shared.revision !== revision) return shared.draft;
      try {
        const stored = JSON.parse(raw) as Partial<IdeaPhotoDraft>;
        if (typeof stored.title !== 'string') return shared.draft;
        const photo = stored.photo && typeof stored.photo.uri === 'string'
          ? normalizeAsset(stored.photo)
          : null;
        shared.draft = {
          title: stored.title,
          photo: photo && typeof photo.uri === 'string' && photo.uri.length > 0 && !prepareIdeaAttachment(photo).error ? photo : null,
          pickerPending: stored.pickerPending === true,
          clientRequestId: typeof stored.clientRequestId === 'string' ? stored.clientRequestId : initial.clientRequestId,
          savedIdeaId: typeof stored.savedIdeaId === 'string' ? stored.savedIdeaId : null,
          ...(stored.form && typeof stored.form === 'object' ? { form: stored.form } : {}),
        };
      } catch {
        // Bad drafts must not block the form or be deleted during hydration.
      }
      return shared.draft;
    },
    update(patch: Partial<IdeaPhotoDraft>): Promise<void> {
      if (shared.closed) return Promise.resolve();
      shared.revision++;
      shared.draft = { ...shared.draft, ...patch };
      const serialized = JSON.stringify(shared.draft);
      return enqueue(storage, key, () => storage.setItem(key, serialized));
    },
    clear(): Promise<void> {
      shared.closed = true;
      return enqueue(storage, key, () => storage.removeItem(key));
    },
    recover(
      getPendingResult: () => Promise<PickerResultLike<ImagePickerAsset> | null>,
      onAsset: (asset: ImagePickerAsset) => void,
      onError: (message: string) => void,
    ): Promise<void> {
      // Pending results belong to the last native picker, not a route. Only
      // consume one when this idea draft launched it; never steal Memory media.
      if (shared.closed || !shared.draft.pickerPending) return Promise.resolve();
      if (shared.recovery) return shared.recovery;
      shared.recovery = (async () => {
        try {
          // Defer invocation so even a synchronous throw clears the installed
          // shared recovery promise rather than leaving a settled lock behind.
          const result = await Promise.resolve().then(getPendingResult);
          // Null means no fallback result is ready, not that it was cancelled.
          if (!result || shared.closed || !shared.draft.pickerPending) return;
          const selected = selectedPickerAsset(result);
          const asset = selected ? normalizeAsset(selected) : null;
          if ('code' in result) onError('The selected image could not be restored. Please choose it again.');
          else if (asset) {
            const error = prepareIdeaAttachment(asset).error;
            if (error) onError(error);
            else {
              onAsset(asset);
              // Persist and share even if the old screen unmounted during decode.
              await this.update({ photo: asset, pickerPending: false });
              return;
            }
          }
          await this.update({ pickerPending: false });
        } catch {
          if (!shared.closed) {
            // A real recovery error must not leave every later action locked.
            try {
              onError('The selected image could not be restored. Please choose it again.');
            } finally {
              await this.update({ pickerPending: false });
            }
          }
        } finally {
          shared.recovery = null;
        }
      })();
      return shared.recovery;
    },
  };
}
