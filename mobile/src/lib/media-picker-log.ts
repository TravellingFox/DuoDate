export function mediaPickerLog(stage: string, id: string, owner?: string): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info('[Media picker lifecycle]', stage, id, owner ?? '');
  }
}
