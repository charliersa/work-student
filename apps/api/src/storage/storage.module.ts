import { Global, Module } from '@nestjs/common';
import { env } from '../config/env';
import { StorageController } from './storage.controller';
import { LocalDiskStorage, S3Storage, StorageDriver } from './storage.service';

@Global()
@Module({
  controllers: [StorageController],
  providers: [
    {
      provide: StorageDriver,
      useFactory: (): StorageDriver =>
        env.storageDriver === 's3' ? new S3Storage() : new LocalDiskStorage(),
    },
  ],
  exports: [StorageDriver],
})
export class StorageModule {}
