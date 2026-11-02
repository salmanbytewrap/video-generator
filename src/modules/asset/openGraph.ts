export interface PageMedia {
  title?: string;
  candidates: string[];
}

const VIDEO_KEYS = ['og:video:secure_url', 'og:video:url', 'og:video', 'twitter:player:stream'];
const IMAGE_KEYS = ['og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src'];

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'" };

function decodeEntities(value: string): string {
  return value.replace(/&(#?\w+);/g, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[3] ?? match[4] ?? match[5] ?? '');
  }
  return attrs;
}

/** Extracts OpenGraph/Twitter media URLs from a page, videos first, resolved against the page URL. */
export function extractPageMedia(html: string, pageUrl: URL): PageMedia {
  const meta = new Map<string, string[]>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(tag);
    const key = (attrs.property ?? attrs.name)?.toLowerCase();
    if (!key || !attrs.content) continue;
    meta.set(key, [...(meta.get(key) ?? []), attrs.content.trim()]);
  }

  const candidates: string[] = [];
  for (const key of [...VIDEO_KEYS, ...IMAGE_KEYS]) {
    for (const value of meta.get(key) ?? []) {
      try {
        const resolved = new URL(value, pageUrl).toString();
        if (!candidates.includes(resolved)) candidates.push(resolved);
      } catch {
        // ignore unparseable URLs
      }
    }
  }

  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
  const title = (meta.get('og:title')?.[0] ?? meta.get('twitter:title')?.[0] ?? (titleTag && decodeEntities(titleTag)))
    ?.replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  return { title: title || undefined, candidates };
}
