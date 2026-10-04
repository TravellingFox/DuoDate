import { memorySaveRequest } from './memory-save-request';
import { withRequestDeadline } from './request-deadline';

describe('Memory save connection recovery', () => {
  test('a hanging read releases by deadline and retries through the alternate transport', async () => {
    const attempts: boolean[] = [];
    const saved = await memorySaveRequest('read', 'memory', (native) => {
      attempts.push(native);
      return withRequestDeadline(async () => native ? 'saved' : new Promise<string>(() => {}), 10);
    }, () => true);
    expect(saved).toBe('saved'); expect(attempts).toEqual([false, true]);
  });

  test('a committed text request with lost response retries the same key only', async () => {
    const contributions = new Map<string, string>();
    const key = 'stable-request';
    let requests = 0;
    const result = await memorySaveRequest('text', 'memory', async () => {
      requests++;
      if (!contributions.has(key)) contributions.set(key, 'our moment');
      if (requests === 1) throw new Error('SocketTimeoutException');
      return contributions.get(key);
    }, () => true);
    expect(result).toBe('our moment'); expect(contributions.size).toBe(1);
  });

  test('validation errors are not retried and two connection failures remain visible', async () => {
    let attempts = 0;
    await expect(memorySaveRequest('text', 'memory', async () => { attempts++; throw new Error('validation'); }, () => false)).rejects.toThrow('validation');
    expect(attempts).toBe(1);
    await expect(memorySaveRequest('read', 'memory', async () => { attempts++; throw new Error('offline'); }, () => true)).rejects.toThrow('offline');
    expect(attempts).toBe(3);
  });

  test('deadline aborts transport and resolves immediately for an acknowledged response', async () => {
    let signal: AbortSignal | undefined;
    await expect(withRequestDeadline(async (value) => { signal = value; return new Promise(() => {}); }, 10)).rejects.toThrow('connection timed out');
    expect(signal?.aborted).toBe(true);
    expect(await withRequestDeadline(async () => 'acknowledged', 50)).toBe('acknowledged');
  });
});
