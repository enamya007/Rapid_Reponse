import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { storageConfig, StorageConfig } from '../../config/storage.config';
import { STORAGE_S3_CLIENT } from './storage.constants';
import { StorageService } from './storage.service';

// Registered locally (not via app.module.ts's global ConfigModule.forRoot `load`), so this
// namespace only becomes available where StorageModule is actually imported. Wiring it into
// the rest of the app is deferred to P4, when a real consumer exists.
@Module({
  imports: [ConfigModule.forFeature(storageConfig)],
  providers: [
    StorageService,
    {
      provide: STORAGE_S3_CLIENT,
      inject: [storageConfig.KEY],
      useFactory: (config: StorageConfig) =>
        new S3Client({
          region: config.region,
          endpoint: config.endpoint,
          forcePathStyle: config.forcePathStyle,
          credentials: {
            accessKeyId: config.accessKey,
            secretAccessKey: config.secretKey,
          },
        }),
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
