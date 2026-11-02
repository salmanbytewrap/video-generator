import { DragEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { MediaPreview } from '../components/MediaPreview';
import { aspectStyle, formatBytes, formatDuration, PLATFORM_LABELS } from '../format';
import type { Asset, FitMode, Platform, Preset } from '../types';

const ACCEPT = 'video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp';

function UploadStep({ asset, onAsset }: { asset: Asset | null; onAsset: (asset: Asset | null) => void }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const upload = async (file: File) => {
    setError(null);
    setProgress(0);
    onAsset(null);
    abortRef.current = new AbortController();
    try {
      onAsset(await api.uploadFile(file, setProgress, abortRef.current.signal));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  };

  return (
    <section className="card">
      <h2>1. Source media</h2>
      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
        {progress !== null ? (
          <div className="stack">
            <span>Uploading… {Math.round(progress * 100)}%</span>
            <div className="progress">
              <div style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        ) : (
          <span>
            <strong>Drop a video or image</strong> or click to browse
            <br />
            <small className="muted">MP4, MOV, WebM, JPG, PNG or WebP</small>
          </span>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {asset && (
        <div className="asset-summary">
          <div className="asset-thumb">
            <MediaPreview
              kind={asset.kind}
              url={asset.url}
              width={asset.metadata.width}
              height={asset.metadata.height}
              label={asset.originalName}
            />
          </div>
          <div className="stack small-gap">
            <strong className="truncate">{asset.title ?? asset.originalName}</strong>
            <span className="muted">
              {asset.metadata.width}×{asset.metadata.height} · {formatBytes(asset.size)}
              {asset.kind === 'video' && ` · ${formatDuration(asset.metadata.durationSeconds)}`}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function PresetPicker({
  presets,
  platform,
  format,
  onChange,
}: {
  presets: Record<Platform, Preset[]>;
  platform: Platform;
  format: string;
  onChange: (platform: Platform, format: string) => void;
}) {
  return (
    <>
      <div className="platforms">
        {(Object.keys(presets) as Platform[]).map((p) => (
          <button
            key={p}
            type="button"
            className={`platform platform-${p}${p === platform ? ' active' : ''}`}
            onClick={() => onChange(p, presets[p][0].format)}
          >
            {PLATFORM_LABELS[p]}
          </button>
        ))}
      </div>
      <div className="formats">
        {presets[platform].map((preset) => (
          <button
            key={preset.format}
            type="button"
            className={`format${preset.format === format ? ' active' : ''}`}
            onClick={() => onChange(platform, preset.format)}
          >
            <span className="format-shape" style={aspectStyle(preset.width, preset.height)} />
            <span className="stack small-gap">
              <strong>{preset.label}</strong>
              <small className="muted">
                {preset.aspectRatio} · {preset.width}×{preset.height} · max {preset.maxDurationSeconds}s
              </small>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

export function CreatePage() {
  const navigate = useNavigate();
  const presetsQuery = useQuery({ queryKey: ['presets'], queryFn: api.presets, staleTime: Infinity });
  const [asset, setAsset] = useState<Asset | null>(null);
  const [platform, setPlatform] = useState<Platform>('instagram');
  const [format, setFormat] = useState('reel');
  const [fit, setFit] = useState<FitMode>('crop');
  const [trimStart, setTrimStart] = useState(0);
  const [generateCaption, setGenerateCaption] = useState(true);
  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    idempotencyKey.current = crypto.randomUUID();
  }, [asset?.id, platform, format, fit, trimStart, generateCaption]);

  const create = useMutation({
    mutationFn: () =>
      api.createJob(
        {
          inputAssetId: asset!.id,
          platform,
          format,
          options: { fit, trimStartSeconds: asset?.kind === 'video' ? trimStart : 0, generateCaption },
        },
        idempotencyKey.current,
      ),
    onSuccess: (job) => navigate(`/jobs/${job.id}`),
  });

  const presets = presetsQuery.data;
  const selected = presets?.[platform].find((p) => p.format === format);
  const duration = asset?.metadata.durationSeconds ?? 0;

  return (
    <div className="create-grid">
      <UploadStep asset={asset} onAsset={setAsset} />

      <section className="card">
        <h2>2. Platform & format</h2>
        {presetsQuery.isLoading && <p className="muted">Loading formats…</p>}
        {presetsQuery.error && <p className="error">{presetsQuery.error.message}</p>}
        {presets && (
          <PresetPicker
            presets={presets}
            platform={platform}
            format={format}
            onChange={(p, f) => {
              setPlatform(p);
              setFormat(f);
            }}
          />
        )}

        <h3>Options</h3>
        <div className="options">
          <label className="inline">
            Fit
            <select value={fit} onChange={(e) => setFit(e.target.value as FitMode)}>
              <option value="crop">Fill (crop to frame)</option>
              <option value="blur">Fit (blurred background)</option>
            </select>
          </label>
          {asset?.kind === 'video' && (
            <label className="inline">
              Start at (s)
              <input
                type="number"
                min={0}
                max={Math.max(0, Math.floor(duration) - 1)}
                step={0.5}
                value={trimStart}
                onChange={(e) => setTrimStart(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
          )}
          <label className="inline checkbox">
            <input type="checkbox" checked={generateCaption} onChange={(e) => setGenerateCaption(e.target.checked)} />
            Generate AI caption & hashtags
          </label>
        </div>
        {selected && asset?.kind === 'video' && duration - trimStart > selected.maxDurationSeconds && (
          <p className="muted">
            Output will be trimmed to {selected.maxDurationSeconds}s, the {selected.label} limit.
          </p>
        )}

        {create.error && <p className="error">{create.error.message}</p>}
        <button
          className="btn primary wide"
          disabled={!asset || !selected || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'Queuing…' : asset ? `Generate ${selected?.label ?? ''}` : 'Upload media to continue'}
        </button>
      </section>
    </div>
  );
}
