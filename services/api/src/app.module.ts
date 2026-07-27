import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { AppConfig } from "./config/app.config";
import { AppConfigModule } from "./config/config.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { ScopedThrottlerGuard } from "./common/guards/scoped-throttler.guard";
import { ResponseEnvelopeInterceptor } from "./common/interceptors/response-envelope.interceptor";
import { CorrelationIdMiddleware } from "./common/middleware/correlation-id.middleware";
import { HealthController } from "./health/health.controller";
import { DatabaseModule } from "./infra/database/database.module";
import { RedisModule } from "./infra/redis/redis.module";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          { name: "user", limit: config.rateLimitUserPerMinute, ttl: 60_000 },
          {
            name: "workspace",
            limit: config.rateLimitWorkspacePerHour,
            ttl: 3_600_000,
          },
          // Per-endpoint override used by @Throttle({ auth: ... }) on login.
          { name: "auth", limit: 5, ttl: 60_000 },
        ],
      }),
    }),
    DatabaseModule,
    RedisModule,
    AuthModule,
    UsersModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: authentication resolves the principal before the
    // throttler keys on it, and before any permission check can run.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ScopedThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }
}
