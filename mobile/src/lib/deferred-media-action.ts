// Android Modal has no onDismiss callback. Wait for its fade-out before presenting
// another native activity; keep the selected action even after the sheet closes.
export function deferMediaAction(action: () => void, delayMs = 350): () => void {
  const timer = setTimeout(action, delayMs);
  return () => clearTimeout(timer);
}
