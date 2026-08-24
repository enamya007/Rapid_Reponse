import { ConfigType, registerAs } from '@nestjs/config';
import { getValidatedEnv } from './env.validation';

export const storageConfig = registerAs('storage', () => {
  const env = getValidatedEnv();

  return {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    publicUrl: env.S3_PUBLIC_URL,
    uploadMaxSizeBytes: env.UPLOAD_MAX_SIZE_BYTES,
    // Kept as the raw comma-separated string, like CORS_ORIGINS on app.config.ts:
    // splitting/trimming into a list is left to whichever consumer needs it.
    uploadAllowedMimeTypes: env.UPLOAD_ALLOWED_MIME_TYPES,
  };
});

export type StorageConfig = ConfigType<typeof storageConfig>;
