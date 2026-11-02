import { createHash } from 'crypto';
import { Platform } from './platformPresets';

export interface CaptionContext {
  platform: Platform;
  format: string;
  title?: string;
  originalName: string;
  durationSeconds?: number;
}

export interface GeneratedCaption {
  text: string;
  hashtags: string[];
  simulated: boolean;
}

export interface CaptionGenerator {
  generate(context: CaptionContext): Promise<GeneratedCaption>;
}

const TEMPLATES: Record<Platform, string[]> = {
  instagram: [
    'Meet {topic}. Designed to stand out in your feed and in real life. Tap the link in bio to learn more.',
    '{topic}, but make it effortless. Save this post for later and share it with someone who needs it.',
    'Your new favourite: {topic}. Double tap if you would use this every day.',
  ],
  tiktok: [
    'POV: you just discovered {topic} and there is no going back',
    'Things I wish I knew sooner: {topic} edition. Wait for the end!',
    'Rating {topic} so you do not have to. Would you try it?',
  ],
  youtube: [
    '{topic} in under a minute: what it is, why it matters, and who it is for.',
    'Everything you need to know about {topic}. Subscribe for more quick breakdowns.',
    'Is {topic} worth it? Here is our honest take.',
  ],
};

const PLATFORM_TAGS: Record<Platform, string[]> = {
  instagram: ['#instagood', '#reels', '#explore'],
  tiktok: ['#fyp', '#tiktokmademebuyit', '#viral'],
  youtube: ['#shorts', '#youtube', '#review'],
};

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'img', 'vid', 'video', 'image', 'final', 'copy', 'new', 'edit']);

export function extractTopic(title: string | undefined, originalName: string): { topic: string; keywords: string[] } {
  const source = title?.trim() || originalName.replace(/\.[^.]+$/, '');
  const words = source
    .replace(/[_\-.]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^\d+$/.test(w) && !STOP_WORDS.has(w.toLowerCase()));
  const keywords = [...new Set(words.map((w) => w.toLowerCase()))].slice(0, 3);
  const topic = words.slice(0, 6).join(' ') || 'this product';
  return { topic, keywords };
}

/**
 * Deterministic, template-based stand-in for an LLM caption service.
 * Swap with a real implementation of CaptionGenerator to use an AI provider.
 */
export class SimulatedCaptionGenerator implements CaptionGenerator {
  async generate(context: CaptionContext): Promise<GeneratedCaption> {
    const { topic, keywords } = extractTopic(context.title, context.originalName);
    const templates = TEMPLATES[context.platform];
    const seed = createHash('sha256').update(`${context.platform}:${topic}`).digest()[0];
    const text = templates[seed % templates.length].replace('{topic}', topic);
    const hashtags = [...keywords.map((k) => `#${k}`), ...PLATFORM_TAGS[context.platform]];
    return { text, hashtags, simulated: true };
  }
}
