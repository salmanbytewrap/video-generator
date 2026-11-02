import { getPreset, PLATFORM_PRESETS, PLATFORMS, presetsByPlatform } from '../../../src/modules/generation/platformPresets';

describe('platformPresets', () => {
  it('PLATFORM_PRESETS_EveryPreset_HasEvenDimensionsMatchingAspectRatio', () => {
    for (const preset of PLATFORM_PRESETS) {
      const [w, h] = preset.aspectRatio.split(':').map(Number);
      expect(preset.width % 2).toBe(0);
      expect(preset.height % 2).toBe(0);
      expect(preset.width / preset.height).toBeCloseTo(w / h, 2);
      expect(preset.maxDurationSeconds).toBeGreaterThan(0);
    }
  });

  it('PLATFORM_PRESETS_FormatIds_AreUniquePerPlatform', () => {
    const ids = PLATFORM_PRESETS.map((p) => `${p.platform}/${p.format}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getPreset_ForTikTokVertical_Returns1080x1920', () => {
    expect(getPreset('tiktok', 'vertical')).toMatchObject({ width: 1080, height: 1920, aspectRatio: '9:16' });
  });

  it('getPreset_WithFormatFromAnotherPlatform_ReturnsUndefined', () => {
    expect(getPreset('tiktok', 'landscape')).toBeUndefined();
    expect(getPreset('myspace', 'vertical')).toBeUndefined();
  });

  it('presetsByPlatform_GroupsEveryPlatform', () => {
    const grouped = presetsByPlatform();
    expect(Object.keys(grouped)).toEqual([...PLATFORMS]);
    expect(grouped.youtube.map((p) => p.format)).toEqual(['short', 'landscape']);
  });
});
