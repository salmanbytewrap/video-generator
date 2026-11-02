import { aspectStyle } from '../format';

interface Props {
  kind: 'video' | 'image';
  url: string;
  width: number;
  height: number;
  poster?: string;
  label?: string;
}

export function MediaPreview({ kind, url, width, height, poster, label }: Props) {
  return (
    <div className="media-frame" style={aspectStyle(width, height)}>
      {kind === 'video' ? (
        <video src={url} poster={poster} controls playsInline preload="metadata" aria-label={label} />
      ) : (
        <img src={url} alt={label ?? 'Preview'} />
      )}
    </div>
  );
}
