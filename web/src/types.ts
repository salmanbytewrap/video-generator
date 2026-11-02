export type Platform = 'instagram' | 'tiktok' | 'youtube';
export type FitMode = 'crop' | 'blur';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface AuthResult {
  user: User;
  token: string;
}

export interface Preset {
  platform: Platform;
  format: string;
  label: string;
  aspectRatio: string;
  width: number;
  height: number;
  maxDurationSeconds: number;
}

export type PresetCatalog = Record<Platform, Preset[]>;

export interface MediaMetadata {
  width: number;
  height: number;
  durationSeconds?: number;
  hasAudio?: boolean;
}

export interface Asset {
  id: string;
  kind: 'video' | 'image';
  mimeType: string;
  originalName: string;
  size: number;
  source: 'upload' | 'url' | 'generated';
  sourceUrl?: string;
  title?: string;
  metadata: MediaMetadata;
  url: string;
}

export interface JobAsset {
  id: string;
  kind: 'video' | 'image';
  mimeType: string;
  originalName: string;
  width: number;
  height: number;
  durationSeconds?: number;
  url: string;
}

export interface Job {
  id: string;
  status: JobStatus;
  progress: number;
  stage: string;
  platform: Platform;
  format: string;
  preset: Pick<Preset, 'label' | 'aspectRatio' | 'width' | 'height' | 'maxDurationSeconds'>;
  options: { fit: FitMode; trimStartSeconds: number; generateCaption: boolean };
  attempts: number;
  maxAttempts: number;
  error?: { code: string; message: string; retryable: boolean };
  caption?: { text: string; hashtags: string[]; simulated: boolean };
  input?: JobAsset;
  output?: JobAsset & { downloadUrl: string; size: number };
  thumbnailUrl?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface JobPage {
  items: Job[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateJobInput {
  inputAssetId: string;
  platform: Platform;
  format: string;
  options: { fit: FitMode; trimStartSeconds: number; generateCaption: boolean };
}

export const ACTIVE_STATUSES: JobStatus[] = ['queued', 'processing'];
