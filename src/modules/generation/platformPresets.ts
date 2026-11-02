export const PLATFORMS = ['instagram', 'tiktok', 'youtube'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const FIT_MODES = ['crop', 'blur'] as const;
export type FitMode = (typeof FIT_MODES)[number];

export interface PlatformPreset {
  platform: Platform;
  format: string;
  label: string;
  aspectRatio: string;
  width: number;
  height: number;
  fps: number;
  maxDurationSeconds: number;
  /** Duration of the clip generated from a still image. */
  imageClipSeconds: number;
  videoCodec: 'libx264';
  audioCodec: 'aac';
  audioBitrate: string;
  crf: number;
  maxBitrate: string;
}

type PresetSpec = Pick<PlatformPreset, 'format' | 'label' | 'aspectRatio' | 'width' | 'height' | 'maxDurationSeconds'>;

const COMMON = {
  fps: 30,
  imageClipSeconds: 6,
  videoCodec: 'libx264',
  audioCodec: 'aac',
  audioBitrate: '128k',
  crf: 23,
  maxBitrate: '8M',
} as const;

const SPECS: Record<Platform, PresetSpec[]> = {
  instagram: [
    { format: 'reel', label: 'Reel (9:16)', aspectRatio: '9:16', width: 1080, height: 1920, maxDurationSeconds: 90 },
    { format: 'square', label: 'Feed square (1:1)', aspectRatio: '1:1', width: 1080, height: 1080, maxDurationSeconds: 60 },
    { format: 'portrait', label: 'Feed portrait (4:5)', aspectRatio: '4:5', width: 1080, height: 1350, maxDurationSeconds: 60 },
  ],
  tiktok: [
    { format: 'vertical', label: 'TikTok video (9:16)', aspectRatio: '9:16', width: 1080, height: 1920, maxDurationSeconds: 180 },
  ],
  youtube: [
    { format: 'short', label: 'Short (9:16)', aspectRatio: '9:16', width: 1080, height: 1920, maxDurationSeconds: 60 },
    { format: 'landscape', label: 'Video (16:9)', aspectRatio: '16:9', width: 1920, height: 1080, maxDurationSeconds: 180 },
  ],
};

export const PLATFORM_PRESETS: readonly PlatformPreset[] = PLATFORMS.flatMap((platform) =>
  SPECS[platform].map((spec) => ({ ...COMMON, ...spec, platform })),
);

export function getPreset(platform: string, format: string): PlatformPreset | undefined {
  return PLATFORM_PRESETS.find((p) => p.platform === platform && p.format === format);
}

export function presetsByPlatform(): Record<Platform, PlatformPreset[]> {
  return Object.fromEntries(
    PLATFORMS.map((platform) => [platform, PLATFORM_PRESETS.filter((p) => p.platform === platform)]),
  ) as Record<Platform, PlatformPreset[]>;
}
