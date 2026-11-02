import { createHmac, timingSafeEqual } from 'crypto';
import { copyFile, mkdir, rm } from 'fs/promises';
import path from 'path';
import { assertValidKey, DownloadUrlOptions, StorageProvider } from './storage.types';

export interface SignedFileParams {
  key: string;
  expires: number;
  name?: string;
  type?: string;
}

export class LocalStorage implements StorageProvider {
  readonly rootDir: string;

  constructor(
    rootDir: string,
    private readonly signingSecret: string,
    private readonly defaultTtlSeconds: number,
    private readonly baseUrl = '',
  ) {
    this.rootDir = path.resolve(rootDir);
  }

  resolvePath(key: string): string {
    assertValidKey(key);
    const fullPath = path.resolve(this.rootDir, key);
    if (!fullPath.startsWith(this.rootDir + path.sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return fullPath;
  }

  async putFile(key: string, sourcePath: string): Promise<void> {
    const destination = this.resolvePath(key);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(sourcePath, destination);
  }

  async downloadToFile(key: string, destinationPath: string): Promise<void> {
    await copyFile(this.resolvePath(key), destinationPath);
  }

  async getDownloadUrl(key: string, options: DownloadUrlOptions = {}): Promise<string> {
    this.resolvePath(key);
    const params: SignedFileParams = {
      key,
      expires: Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? this.defaultTtlSeconds),
      name: options.downloadName,
      type: options.contentType,
    };
    const query = new URLSearchParams({ key, expires: String(params.expires) });
    if (params.name) query.set('name', params.name);
    if (params.type) query.set('type', params.type);
    query.set('sig', this.sign(params));
    return `${this.baseUrl}/api/files?${query.toString()}`;
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolvePath(key), { force: true });
  }

  verify(params: SignedFileParams, signature: string): boolean {
    if (!Number.isFinite(params.expires) || params.expires < Math.floor(Date.now() / 1000)) {
      return false;
    }
    const expected = Buffer.from(this.sign(params));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private sign({ key, expires, name = '', type = '' }: SignedFileParams): string {
    return createHmac('sha256', this.signingSecret)
      .update([key, expires, name, type].join('\n'))
      .digest('base64url');
  }
}
