// Keep native handoffs outside render state: foreground events and picker
// promises can settle the same operation, or an older promise can settle late.
export function createContributionOperation() {
  let sequence = 0;
  let current: number | null = null;
  return {
    get busy() { return current !== null; },
    begin(): number | null {
      if (current !== null) return null;
      current = ++sequence;
      return current;
    },
    finish(token: number): boolean {
      if (current !== token) return false;
      current = null;
      return true;
    },
  };
}
