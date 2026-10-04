import { readFileSync } from 'node:fs';
import { QueryClient, MutationObserver } from '@tanstack/react-query';

const captureSource = readFileSync(new URL('../app/memory/[id].tsx', import.meta.url).pathname, 'utf8');
import { createContributionOperation } from './contribution-operation';
import { canCompleteMemory } from './memory-completion';

const valid = {
  hasSavedContent: true, text: '', title: 'Our memory', draftReady: true,
  uploads: [], mutationPending: false, recording: false, voiceBusy: false, mediaBusy: false,
};

describe('native contribution state and Memory completion', () => {
  test('the live handoff locks immediately and rejects duplicate launches', () => {
    const operation = createContributionOperation();
    const token = operation.begin()!;
    expect(operation.busy).toBe(true);
    expect(operation.begin()).toBeNull();
    expect(operation.finish(token)).toBe(true);
    expect(operation.busy).toBe(false);
  });

  test('recovery releases once and an old promise cannot unlock the next video', () => {
    const operation = createContributionOperation();
    const photo = operation.begin()!;
    expect(operation.finish(photo)).toBe(true);
    const video = operation.begin()!;
    expect(operation.finish(photo)).toBe(false);
    expect(operation.busy).toBe(true);
    expect(operation.finish(video)).toBe(true);
  });

  test('any real content allows Save, including after a cancelled picker or failed optional upload', () => {
    expect(canCompleteMemory(valid)).toBe(true);
    expect(canCompleteMemory({ ...valid, uploads: [{ phase: 'error' }] })).toBe(true);
    expect(canCompleteMemory({ ...valid, hasSavedContent: false, text: ' A moment ' })).toBe(true);
    expect(canCompleteMemory({ ...valid, hasSavedContent: false, uploads: [{ phase: 'error' }] })).toBe(false);
    expect(canCompleteMemory({ ...valid, hasSavedContent: false, text: '  ' })).toBe(false);
  });

  test('active media, immediate recording/preparation, incomplete hydration, and empty title block completion', () => {
    for (const patch of [
      { uploads: [{ phase: 'preparing' as const }] }, { uploads: [{ phase: 'uploading' as const }] },
      { recording: true }, { voiceBusy: true }, { mediaBusy: true },
      { mutationPending: true }, { draftReady: false }, { title: ' ' },
    ]) expect(canCompleteMemory({ ...valid, ...patch })).toBe(false);
  });

  test('all contribution mutations share the scope and late picker cleanup checks ownership', () => {
    for (const name of ['addText', 'upload', 'caption', 'reorder', 'cover', 'remove']) {
      expect(captureSource).toContain(`const ${name} = useMutation({\n    scope: contributionScope,`);
    }
    expect(captureSource.match(/Platform.OS === 'android' && pickerSettlement.current === settlement/g)).toHaveLength(4);
    expect(captureSource).toContain('const ownsReturn = () => active && !draftClosed.current;');
    expect(captureSource).toContain('if (pickerSettlement.current === settlement) clearPickerTarget();');
    expect(captureSource).toContain("quality: Platform.OS === 'android' ? 1 : 0.85");
    expect(captureSource).toContain('if (draftClosed.current || saveMemory.isPending) return;');
  });

  test('the shared mutation scope serializes separate upload batches and text responses', async () => {
    const client = new QueryClient();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const events: string[] = [];
    const first = new MutationObserver(client, {
      scope: { id: 'memory-contributions:one' },
      mutationFn: async () => { events.push('photo'); await pending; return 'photo'; },
      onSuccess: () => { events.push('photo accepted'); },
    });
    const second = new MutationObserver(client, {
      scope: { id: 'memory-contributions:one' },
      mutationFn: async () => { events.push('voice'); return 'voice'; },
      onSuccess: () => { events.push('voice accepted'); },
    });
    const a = first.mutate();
    const b = second.mutate();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual(['photo']);
    release();
    await Promise.all([a, b]);
    expect(events).toEqual(['photo', 'photo accepted', 'voice', 'voice accepted']);
    client.clear();
  });
});
