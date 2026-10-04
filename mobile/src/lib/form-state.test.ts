import { hasRequiredText, selectedPickerAsset } from './form-state';

describe('shared form state', () => {
  test('enables create actions only when required text contains visible content', () => {
    expect(hasRequiredText('')).toBe(false);
    expect(hasRequiredText('   ')).toBe(false);
    expect(hasRequiredText('Outdoor cinema')).toBe(true);
  });

  test('keeps the selected attachment from direct and recovered picker results', () => {
    const asset = { uri: 'file:///flyer.jpg', fileName: 'flyer.jpg' };

    expect(selectedPickerAsset({ canceled: false, assets: [asset] })).toEqual(asset);
    expect(selectedPickerAsset({ canceled: true, assets: null })).toBeNull();
    expect(selectedPickerAsset({ code: 'E_PICKER', message: 'Picker failed' })).toBeNull();
    expect(selectedPickerAsset(null)).toBeNull();
  });
});
