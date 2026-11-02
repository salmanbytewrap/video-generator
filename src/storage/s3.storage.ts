import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, createWriteStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { assertValidKey, DownloadUrlOptions, StorageProvider } from './storage.types';

export interface S3StorageOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  defaultTtlSeconds: number;
}

export class S3Storage implements StorageProvider {
  private readonly client: S3Client;

  constructor(private readonly options: S3StorageOptions) {
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: Boolean(options.endpoint),
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async putFile(key: string, sourcePath: string, contentType: string): Promise<void> {
    assertValidKey(key);
    const { size } = await stat(sourcePath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: createReadStream(sourcePath),
        ContentType: contentType,
        ContentLength: size,
      }),
    );
  }

  async downloadToFile(key: string, destinationPath: string): Promise<void> {
    assertValidKey(key);
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }));
    if (!result.Body) throw new Error(`Empty object body for ${key}`);
    await pipeline(result.Body as Readable, createWriteStream(destinationPath));
  }

  async getDownloadUrl(key: string, options: DownloadUrlOptions = {}): Promise<string> {
    assertValidKey(key);
    const command = new GetObjectCommand({
      Bucket: this.options.bucket,
      Key: key,
      ResponseContentType: options.contentType,
      ResponseContentDisposition: options.downloadName
        ? `attachment; filename="${options.downloadName.replace(/"/g, '')}"`
        : undefined,
    });
    return getSignedUrl(this.client, command, {
      expiresIn: options.expiresInSeconds ?? this.options.defaultTtlSeconds,
    });
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }
}
