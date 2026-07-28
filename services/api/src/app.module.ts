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
import { PermissionGuard } from "./common/guards/permission.guard";
import { ScopedThrottlerGuard } from "./common/guards/scoped-throttler.guard";
import { ResponseEnvelopeInterceptor } from "./common/interceptors/response-envelope.interceptor";
import { CorrelationIdMiddleware } from "./common/middleware/correlation-id.middleware";
import { HealthController } from "./health/health.controller";
import { DatabaseModule } from "./infra/database/database.module";
import { RedisModule } from "./infra/redis/redis.module";
import { StorageModule } from "./infra/storage/storage.module";
import { AiModule } from "./infra/ai/ai.module";
import { KnowledgeModule } from "./infra/knowledge/knowledge.module";
import { SecretsInfraModule } from "./infra/secrets/secrets.module";
import { AuthModule } from "./modules/auth/auth.module";
import { AuthorizationModule } from "./modules/authorization/authorization.module";
import { ChatModule } from "./modules/chat/chat.module";
import { MemoryModule } from "./modules/memory/memory.module";
import { ConnectionsModule } from "./modules/connections/connections.module";
import { SecretsModule } from "./modules/secrets/secrets.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { GoalsModule } from "./modules/goals/goals.module";
import { OrganizationsModule } from "./modules/organizations/organizations.module";
import { UsersModule } from "./modules/users/users.module";
import { WorkspacesModule } from "./modules/workspaces/workspaces.module";

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        // Every throttler listed here applies to EVERY route. A stricter
        // "auth" entry must therefore not live in this list — it would cap the
        // whole API at the login limit. Endpoints that need a tighter bound
        // override the named throttler instead, e.g.
        // `@Throttle({ user: { limit: 5, ttl: 60_000 } })` on login.
        throttlers: [
          { name: "user", limit: config.rateLimitUserPerMinute, ttl: 60_000 },
          {
            name: "workspace",
            limit: config.rateLimitWorkspacePerHour,
            ttl: 3_600_000,
          },
        ],
      }),
    }),
    DatabaseModule,
    RedisModule,
    StorageModule,
    AiModule,
    KnowledgeModule,
    SecretsInfraModule,
    AuthorizationModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    WorkspacesModule,
    GoalsModule,
    DocumentsModule,
    ChatModule,
    MemoryModule,
    SecretsModule,
    ConnectionsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters and is the registration order: JwtAuthGuard establishes
    // the principal, the throttler keys on it, and PermissionGuard authorizes
    // last — it needs both the principal and a decided rate-limit outcome.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ScopedThrottlerGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }
}
