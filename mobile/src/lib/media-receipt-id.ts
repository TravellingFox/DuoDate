// Preserve all 122 random UUID bits by adding the asset index instead of
// replacing suffix bits; a replay produces exactly the same contribution ID.
export function receiptAssetId(receiptId: string, index: number): string {
  const suffix = Number.parseInt(receiptId.slice(-8), 16);
  return `${receiptId.slice(0, -8)}${((suffix + index) >>> 0).toString(16).padStart(8, '0')}`;
}
