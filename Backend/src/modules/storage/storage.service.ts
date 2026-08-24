import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { storageConfig } from '../../config/storage.config';
import type { StorageConfig } from '../../config/storage.config';
import { STORAGE_S3_CLIENT } from './storage.constants';
import { StoredObject, UploadInput } from './storage.types';

const DEFAULT_KEY_PREFIX = 'uploads';
const DEFAULT_PRESIGNED_URL_EXPIRES_IN_SECONDS = 900;

// Anything outside this set (including path separators, which would otherwise let a crafted
// `originalName` escape the generated key's prefix, e.g. `../../etc/passwd`) is replaced with
// '-'. The file extension survives untouched because '.' is itself part of the allowed set.
const UNSAFE_FILENAME_CHARS = /[^a-zA-Z0-9._-]/g;

function sanitizeFileName(originalName: string): string {
  const baseName = originalName.split(/[/\\]/).pop() ?? originalName;
  const sanitized = baseName.replace(UNSAFE_FILENAME_CHARS, '-');
  return sanitized.length > 0 ? sanitized : 'file';
}

@Injectable()
export class StorageService {
  constructor(
    @Inject(STORAGE_S3_CLIENT) private readonly s3Client: S3Client,
    @Inject(storageConfig.KEY) private readonly config: StorageConfig,
  ) {}

  async upload(input: UploadInput): Promise<StoredObject> {
    const { buffer, mimeType, size, originalName, keyPrefix } = input;

    if (size > this.config.uploadMaxSizeBytes) {
      throw new PayloadTooLargeException(
        `File size ${size} bytes exceeds the maximum allowed size of ${this.config.uploadMaxSizeBytes} bytes`,
      );
    }

    const allowedMimeTypes = this.config.uploadAllowedMimeTypes
      .split(',')
      .map((mime) => mime.trim())
      .filter(Boolean);

    if (!allowedMimeTypes.includes(mimeType)) {
      throw new UnsupportedMediaTypeException(
        `MIME type "${mimeType}" is not allowed. Allowed types: ${allowedMimeTypes.join(', ')}`,
      );
    }

    const key = `${keyPrefix ?? DEFAULT_KEY_PREFIX}/${randomUUID()}-${sanitizeFileName(originalName)}`;

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ContentLength: size,
      }),
    );

    return {
      key,
      bucket: this.config.bucket,
      mimeType,
      size,
    };
  }

  async getPresignedDownloadUrl(
    key: string,
    expiresInSeconds?: number,
  ): Promise<string> {
    return getSignedUrl(
      this.s3Client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      {
        expiresIn: expiresInSeconds ?? DEFAULT_PRESIGNED_URL_EXPIRES_IN_SECONDS,
      },
    );
  }

  async delete(key: string): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }
}
