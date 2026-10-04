import { recoverPickerReturn } from './picker-return';
import { createContributionOperation } from './contribution-operation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('Android picker return ownership', () => {
  test('null recovery does not cancel a live export or erase its target', async () => {
    const operation = createContributionOperation();
    const token = operation.begin()!;
    const events: string[] = [];
    const recovered = await recoverPickerReturn({
      read: async () => null,
      ownsReturn: () => operation.busy,
      accept: () => events.push('preview'),
      complete: async () => { events.push('clear'); operation.finish(token); },
    });
    expect(recovered).toBe(false);
    expect(operation.busy).toBe(true);
    expect(events).toEqual([]);
    // A normal promise can still return after several empty recovery checks.
    for (let i = 0; i < 6; i++) {
      await recoverPickerReturn({ read: async () => null, ownsReturn: () => true,
        accept: () => events.push('preview'), complete: async () => { operation.finish(token); } });
    }
    expect(operation.busy).toBe(true);
    expect(operation.finish(token)).toBe(true);
    expect(operation.begin()).not.toBeNull();
  });

  test.each([null, { canceled: false, assets: ['photo'] }])('late recovery %p cannot clear a newer picker target', async (result) => {
    const pending = deferred<typeof result>();
    let current = 1;
    let clears = 0;
    let accepted = 0;
    const recovery = recoverPickerReturn({
      read: () => pending.promise,
      ownsReturn: () => current === 1,
      accept: () => { accepted++; },
      complete: async () => { clears++; },
    });
    current = 2;
    pending.resolve(result);
    expect(await recovery).toBe(false);
    expect(accepted).toBe(0);
    expect(clears).toBe(0);
  });

  test('accepts recovered photo before releasing the video/voice handoff lock', async () => {
    const operation = createContributionOperation();
    const token = operation.begin()!;
    const cleanup = deferred<void>();
    const events: string[] = [];
    const recovery = recoverPickerReturn({
      read: async () => ({ assets: ['photo'] }),
      ownsReturn: () => operation.busy,
      accept: () => events.push('preview'),
      complete: async () => { await cleanup.promise; operation.finish(token); events.push('released'); },
    });
    await Promise.resolve();
    expect(events).toEqual(['preview']);
    expect(operation.begin()).toBeNull();
    cleanup.resolve();
    expect(await recovery).toBe(true);
    expect(events).toEqual(['preview', 'released']);
    expect(operation.begin()).not.toBeNull();
  });
});
