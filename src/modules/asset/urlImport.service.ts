import { randomUUID } from 'crypto';
import { rm, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import { BadRequestError, UnsupportedMediaTypeError } from '../../utils/AppError';
import { AssetService, AssetView } from './asset.service';
import { extractPageMedia } from './openGraph';
import { readText, safeGet, saveToFile, SafeFetchOptions } from './safeFetch';

export const importUrlSchema = z.object({
  url: z.string().trim().min(1).max(2048),
});

export interface UrlImportOptions {
  maxMediaBytes: number;
  maxPageBytes?: number;
  timeoutMs?: number;
  allowPrivateNetwork?: boolean;
  tempDir?: string;
}

const MAX_CANDIDATES = 3;

function isMediaType(contentType: string): boolean {
  return contentType.startsWith('video/') || contentType.startsWith('image/') || contentType === 'application/octet-stream';
}

function isHtml(contentType: string): boolean {
  return contentType === 'text/html' || contentType === 'application/xhtml+xml';
}

function nameFromUrl(url: URL): string {
  const base = decodeURIComponent(path.posix.basename(url.pathname)).trim();
  return base || url.hostname;
}

export class UrlImportService {
  constructor(
    private readonly assets: AssetService,
    private readonly options: UrlImportOptions,
  ) {}

  async importFromUrl(userId: string, input: unknown): Promise<AssetView> {
    const { url } = importUrlSchema.parse(input);
    const fetchOptions = (maxBytes: number, accept: string): SafeFetchOptions => ({
      maxBytes,
      accept,
      timeoutMs: this.options.timeoutMs,
      allowPrivateNetwork: this.options.allowPrivateNetwork,
    });

    const first = await safeGet(url, fetchOptions(this.options.maxMediaBytes, 'text/html,video/*,image/*;q=0.9,*/*;q=0.5'));
    if (isMediaType(first.head.contentType)) {
      return this.ingest(userId, url, first, undefined);
    }
    if (!isHtml(first.head.contentType)) {
      first.response.destroy();
      first.close();
      throw new UnsupportedMediaTypeError('The URL is not a web page, video or image');
    }

    let html: string;
    try {
      html = await readText(first.response, this.options.maxPageBytes ?? 2 * 1024 * 1024);
    } finally {
      first.close();
    }

    const page = extractPageMedia(html, first.head.url);
    if (page.candidates.length === 0) {
      throw new BadRequestError('No video or image was found on that page');
    }

    let lastError: unknown;
    for (const candidate of page.candidates.slice(0, MAX_CANDIDATES)) {
      try {
        const media = await safeGet(candidate, fetchOptions(this.options.maxMediaBytes, 'video/*,image/*'));
        if (!isMediaType(media.head.contentType)) {
          media.response.destroy();
          media.close();
          continue;
        }
        return await this.ingest(userId, url, media, page.title);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new UnsupportedMediaTypeError('The media on that page is not a supported video or image');
  }

  private async ingest(
    userId: string,
    sourceUrl: string,
    fetched: Awaited<ReturnType<typeof safeGet>>,
    title: string | undefined,
  ): Promise<AssetView> {
    const tempPath = path.join(this.options.tempDir ?? os.tmpdir(), `url-${randomUUID()}`);
    try {
      await saveToFile(fetched.response, tempPath, this.options.maxMediaBytes);
    } catch (err) {
      await rm(tempPath, { force: true });
      throw err;
    } finally {
      fetched.close();
    }
    const { size } = await stat(tempPath);
    return this.assets.ingestFile({
      userId,
      tempPath,
      originalName: nameFromUrl(fetched.head.url),
      size,
      source: 'url',
      sourceUrl,
      title,
    });
  }
}
