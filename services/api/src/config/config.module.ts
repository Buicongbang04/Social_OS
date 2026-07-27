import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppConfig } from "./app.config";
import { validateEnv } from "./env.schema";

/**
 * Global so that async module factories (ThrottlerModule, DatabaseModule,
 * RedisModule) can inject AppConfig without each re-importing this module.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // One .env at the repo root, shared by every service.
      envFilePath: ["../../.env"],
    }),
  ],
  providers: [AppConfig],
  exports: [AppConfig],
})
export class AppConfigModule {}
