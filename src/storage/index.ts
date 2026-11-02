import config from '../config';
import { LocalStorage } from './local.storage';
import { S3Storage } from './s3.storage';
import { StorageProvider } from './storage.types';

export function createStorage(): StorageProvider {
  if (config.STORAGE_DRIVER === 's3') {
    return new S3Storage({
      bucket: config.S3_BUCKET!,
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      accessKeyId: config.S3_ACCESS_KEY_ID!,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
      defaultTtlSeconds: config.SIGNED_URL_TTL_SECONDS,
    });
  }
  return new LocalStorage(
    config.LOCAL_STORAGE_DIR,
    config.JWT_SECRET,
    config.SIGNED_URL_TTL_SECONDS,
    config.PUBLIC_BASE_URL ?? '',
  );
}

export { LocalStorage } from './local.storage';
export { S3Storage } from './s3.storage';
export type { DownloadUrlOptions, StorageProvider } from './storage.types';
