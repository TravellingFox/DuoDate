export function newIdeaDraftSession(): string {
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
