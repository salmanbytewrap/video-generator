export interface DownloadUrlOptions {
  expiresInSeconds?: number;
  downloadName?: string;
  contentType?: string;
}

export interface StorageProvider {
  putFile(key: string, sourcePath: string, contentType: string): Promise<void>;
  downloadToFile(key: string, destinationPath: string): Promise<void>;
  getDownloadUrl(key: string, options?: DownloadUrlOptions): Promise<string>;
  delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;

export function assertValidKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}
