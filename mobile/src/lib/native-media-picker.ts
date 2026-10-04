import { mediaStorage } from '@/lib/media-storage';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { createMediaPickerLifecycle, type MediaPickerOperation } from './media-picker-lifecycle';
import { mediaPickerLog } from './media-picker-log';
import { nativePickerAsset } from './native-picker-asset';

type Result = ImagePicker.ImagePickerResult | ImagePicker.ImagePickerErrorResult;
export const nativeMediaPicker = createMediaPickerLifecycle<Result>(mediaStorage);
const live = new Set<string>();
const claims = new Map<string, Promise<void>>();

export function retainMediaFile(uri: string, id: string, name: string): string {
  if (Platform.OS === 'web') return uri;
  const directory = new Directory(Paths.document, 'retained-media');
  directory.create({ idempotent: true, intermediates: true });
  const extension = name.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1] ?? 'bin';
  const destination = new File(directory, `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.${extension}`);
  const source = new File(uri);
  if (!destination.exists || destination.size === 0 || (source.exists && source.size !== destination.size)) {
    if (destination.exists) destination.delete();
    source.copy(destination);
  }
  return destination.uri;
}

function retainResult(result: Result, operation: MediaPickerOperation): Result {
  if ('code' in result || result.canceled) return result;
  return {
    ...result,
    assets: result.assets.map((selected, index) => {
      const asset = nativePickerAsset(selected);
      const uri = retainMediaFile(asset.uri, `${operation.id}-${index}`, asset.fileName ?? asset.uri.split(/[?#]/)[0]!);
      return nativePickerAsset({ ...asset, uri });
    }),
  };
}

export async function launchNativeMediaPicker(owner: string, launch: () => Promise<ImagePicker.ImagePickerResult>) {
  const operation = { owner, id: randomUUID() };
  await nativeMediaPicker.begin(operation);
  live.add(operation.id);
  let unsubscribe = () => {};
  const recovered = new Promise<void>((resolve) => {
    unsubscribe = nativeMediaPicker.subscribe(() => {
      if (nativeMediaPicker.receiptsFor(owner).some((receipt) => receipt.id === operation.id)) resolve();
    });
  });
  const launched = (async () => {
    let returned = false;
    try {
      mediaPickerLog('launch', operation.id, owner);
      const result = await launch();
      mediaPickerLog('native-return', operation.id, owner);
      returned = true;
      // Receipt first: failed retention must not consume the only exported URI.
      await nativeMediaPicker.deliver(operation, result);
    } catch (error) {
      if (!returned) await nativeMediaPicker.cancel(operation);
      throw error;
    }
  })();
  try { await Promise.race([launched, recovered]); }
  finally { unsubscribe(); live.delete(operation.id); }
}

export function useNativeMediaPicker(owner: string, accept: (id: string, result: Result) => Promise<void>, onError: (message: string) => void) {
  const [busy, setBusy] = useState<boolean>(false);
  useEffect(() => {
    let active = true;
    let claiming = false;
    let orphanSince: number | null = null;
    const claim = async () => {
      if (!active || claiming) return;
      claiming = true;
      try {
        for (const receipt of nativeMediaPicker.receiptsFor(owner)) {
          const existing = claims.get(receipt.id);
          if (existing) { await existing; continue; }
          const pending = (async () => {
            mediaPickerLog('owner-delivery', receipt.id, owner);
            const retained = retainResult(receipt.result, receipt);
            await nativeMediaPicker.retainReceipt(receipt.id, retained);
            await accept(receipt.id, retained);
            mediaPickerLog('asset-accepted', receipt.id, owner);
            await nativeMediaPicker.acknowledge(receipt.id);
          })();
          claims.set(receipt.id, pending);
          try { await pending; } finally { claims.delete(receipt.id); }
        }
      } catch (error) {
        mediaPickerLog('owner-delivery-failed', owner);
        if (active) onError(error instanceof Error ? error.message : 'Your returned media could not be backed up. It is kept for retry.');
      } finally {
        claiming = false;
        if (active) setBusy(nativeMediaPicker.busy);
      }
    };
    const recover = async () => {
      if (!active || AppState.currentState !== 'active') return;
      try {
        await nativeMediaPicker.initialize();
        if (Platform.OS === 'android') await nativeMediaPicker.recover(() => ImagePicker.getPendingResultAsync());
        await claim();
        // Expo does not store canceled results after activity destruction. Only
        // retire a foreground orphan after recovery has finished (never during
        // an export or while this runtime still owns the launch promise).
        if (!nativeMediaPicker.busy || live.size) orphanSince = null;
        else if (orphanSince === null) orphanSince = Date.now();
        else if (Date.now() - orphanSince >= 5000) {
          await nativeMediaPicker.cancelOrphan();
          orphanSince = null;
        }
        if (active) setBusy(nativeMediaPicker.busy);
      } catch (error) {
        if (active) onError(error instanceof Error ? error.message : 'Media recovery could not be read. Please try again.');
      }
    };
    const unsubscribe = nativeMediaPicker.subscribe(() => { if (active) { setBusy(nativeMediaPicker.busy); void claim(); } });
    void recover();
    const timer = Platform.OS === 'android' ? setInterval(() => { void recover(); }, 1000) : undefined;
    const subscription = AppState.addEventListener('change', (state) => { orphanSince = null; if (state === 'active') void recover(); });
    const focus = Platform.OS === 'android' ? AppState.addEventListener('focus', () => { void recover(); }) : null;
    return () => { active = false; unsubscribe(); clearInterval(timer); subscription.remove(); focus?.remove(); };
  }, [owner, accept, onError]);
  return busy;
}
