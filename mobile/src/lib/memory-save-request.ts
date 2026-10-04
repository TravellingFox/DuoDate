// Retry only read/idempotent Memory save stages. An uncertain text POST must
// keep its request ID, so a committed write with a lost response cannot duplicate.
export async function memorySaveRequest<T>(
  stage: string,
  memoryId: string,
  run: (nativeTransport: boolean) => Promise<T>,
  canRetry: (error: unknown) => boolean,
): Promise<T> {
  for (const nativeTransport of [false, true]) {
    console.info('[Memory save]', stage, memoryId, nativeTransport ? 'retry' : 'started');
    try {
      const result = await run(nativeTransport);
      console.info('[Memory save]', stage, memoryId, 'acknowledged');
      return result;
    } catch (error) {
      console.warn('[Memory save]', stage, memoryId, 'unacknowledged');
      if (nativeTransport || !canRetry(error)) throw error;
    }
  }
  throw new Error('Memory save could not finish');
}
