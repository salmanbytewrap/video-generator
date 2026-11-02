import type { JobStatus, Platform } from './types';

export const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

export const STATUS_LABELS: Record<JobStatus, string> = {
  queued: 'Queued',
  processing: 'Processing',
  completed: 'Ready',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(seconds?: number): string {
  if (seconds === undefined) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function aspectStyle(width: number, height: number) {
  return { aspectRatio: `${width} / ${height}` };
}
