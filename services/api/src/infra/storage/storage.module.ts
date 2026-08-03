import { Global, Module } from "@nestjs/common";
import { S3ObjectStore, type ObjectStore } from "@repo/storage";
import { AppConfig } from "../../config/app.config";

/**
 * Object storage, or nothing.
 *
 * The token resolves to `null` when storage is not configured. That is
 * deliberate: an API that refuses to boot without MinIO takes down login,
 * goals and executions — none of which need it — because one optional feature
 * has no credentials. The upload endpoint checks and answers 503; everything
 * else carries on.
 */
export const OBJECT_STORE = Symbol("OBJECT_STORE");

@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORE,
      inject: [AppConfig],
      useFactory: (config: AppConfig): ObjectStore | null => {
        const options = config.storage;
        if (!options) return null;

        return new S3ObjectStore({
          endpoint: options.url,
          publicEndpoint: options.publicUrl,
          region: options.region,
          bucket: options.bucket,
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
          // MinIO on localhost: virtual-host addressing would resolve
          // `bucket.localhost`, which does not exist.
          forcePathStyle: true,
        });
      },
    },
  ],
  exports: [OBJECT_STORE],
})
export class StorageModule {}
