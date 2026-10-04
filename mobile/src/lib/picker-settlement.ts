// A foreground watchdog releases only the UI handoff, not the native result.
// Slow Android exports may still deliver after recovery returned null.
export function createPickerSettlement<T>({
  accept, release, interrupted, delayMs = 5000,
}: {
  accept: (result: T) => void;
  release: () => void;
  interrupted: () => void;
  delayMs?: number;
}) {
  let delivered = false;
  let released = false;
  let leftApp = false;
  let launched = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const finish = () => {
    clear();
    if (released) return;
    released = true;
    release();
  };
  return {
    launch() { launched = true; },
    background() { if (launched) { leftApp = true; clear(); } },
    foreground() {
      if (!leftApp || delivered || released || timer) return;
      timer = setTimeout(() => { interrupted(); finish(); }, delayMs);
    },
    deliver(result: T): boolean {
      if (delivered) return false;
      delivered = true;
      try { accept(result); } finally { finish(); }
      return true;
    },
    fail() { finish(); },
    dispose() { clear(); },
  };
}
