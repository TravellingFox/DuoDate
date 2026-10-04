import { createPickerSettlement } from './picker-settlement';
import { createContributionOperation } from './contribution-operation';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('native picker return settlement', () => {
  test('normal return releases immediately without awaiting marker cleanup and deduplicates recovery', () => {
    const events: string[] = [];
    const picker = createPickerSettlement({ accept: (value: string) => events.push(value),
      release: () => events.push('released'), interrupted: () => events.push('interrupted') });
    picker.launch(); picker.background(); picker.foreground();
    expect(picker.deliver('photo')).toBe(true);
    expect(picker.deliver('photo')).toBe(false);
    expect(events).toEqual(['photo', 'released']);
  });

  test('missing cancellation result frees later actions, while a late photo still appears once', async () => {
    const operation = createContributionOperation();
    const photo = operation.begin()!;
    const events: string[] = [];
    const picker = createPickerSettlement({ accept: (value: string) => events.push(value),
      release: () => { operation.finish(photo); }, interrupted: () => events.push('interrupted'), delayMs: 10 });
    picker.launch(); picker.background(); picker.foreground();
    await wait(25);
    expect(operation.busy).toBe(false);
    const video = operation.begin()!;
    picker.deliver('late photo'); picker.deliver('late photo');
    expect(events).toEqual(['interrupted', 'late photo']);
    expect(operation.busy).toBe(true);
    expect(operation.finish(video)).toBe(true);
  });

  test('time in camera and permission dialogs does not expire a live action', async () => {
    let releases = 0;
    const picker = createPickerSettlement({ accept: () => {}, release: () => { releases++; }, interrupted: () => {}, delayMs: 10 });
    picker.background(); picker.foreground();
    await wait(20);
    picker.launch(); picker.background();
    await wait(20);
    expect(releases).toBe(0);
    picker.foreground(); picker.background();
    await wait(20);
    expect(releases).toBe(0);
    picker.deliver({ canceled: true });
    expect(releases).toBe(1);
  });

  test('slow consumed recovery is kept after a newer operation starts without clearing its marker', async () => {
    const operation = createContributionOperation();
    const firstToken = operation.begin()!;
    const events: string[] = [];
    const first = createPickerSettlement({ accept: (result: string) => events.push(result),
      release: () => { operation.finish(firstToken); }, interrupted: () => {}, delayMs: 5 });
    let current = first;
    const original = current;
    let deliver!: (result: string) => void;
    const pending = new Promise<string>((resolve) => { deliver = resolve; });
    const recovery = pending.then((result) => {
      original.deliver(result);
      if (current === original) events.push('clear marker');
    });
    first.launch(); first.background(); first.foreground();
    await wait(15);
    const next = operation.begin()!;
    current = createPickerSettlement({ accept: () => {}, release: () => { operation.finish(next); }, interrupted: () => {} });
    deliver('recovered photo'); await recovery;
    expect(events).toEqual(['recovered photo']);
    expect(operation.busy).toBe(true);
    operation.finish(next);
  });

  test('recovery result and normal return race settle one contribution', () => {
    let accepted = 0;
    let released = 0;
    const picker = createPickerSettlement({ accept: () => { accepted++; }, release: () => { released++; }, interrupted: () => {} });
    picker.deliver('recovery'); picker.deliver('normal'); picker.fail();
    expect(accepted).toBe(1); expect(released).toBe(1);
  });
});
