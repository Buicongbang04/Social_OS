import { Global, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { ModuleRef } from "@nestjs/core";
import {
  DrizzleOrganizationMembershipRepository,
  DrizzleOrganizationRepository,
  DrizzleSessionRepository,
  DrizzleUserRepository,
  DrizzleWorkspaceMembershipRepository,
  DrizzleWorkspaceRepository,
  closeDbClient,
  createDbClient,
  type DatabaseClient,
} from "@repo/database";
import { AppConfig } from "../../config/app.config";

export const DATABASE_CLIENT = Symbol("DATABASE_CLIENT");

/**
 * Injection tokens for the repository ports declared in @repo/domain. Services
 * depend on the interface via these tokens, never on the Drizzle class, so a
 * unit test can bind a fake without a database.
 */
export const USER_REPOSITORY = Symbol("USER_REPOSITORY");
export const ORGANIZATION_REPOSITORY = Symbol("ORGANIZATION_REPOSITORY");
export const WORKSPACE_REPOSITORY = Symbol("WORKSPACE_REPOSITORY");
export const WORKSPACE_MEMBERSHIP_REPOSITORY = Symbol("WORKSPACE_MEMBERSHIP_REPOSITORY");
export const ORGANIZATION_MEMBERSHIP_REPOSITORY = Symbol("ORGANIZATION_MEMBERSHIP_REPOSITORY");
export const SESSION_REPOSITORY = Symbol("SESSION_REPOSITORY");

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_CLIENT,
      inject: [AppConfig],
      useFactory: (config: AppConfig): DatabaseClient =>
        createDbClient(config.databaseUrl, {
          maxConnections: config.isProduction ? 20 : 5,
          debug: false,
        }),
    },
    {
      provide: USER_REPOSITORY,
      inject: [DATABASE_CLIENT],
      useFactory: (db: DatabaseClient) => new DrizzleUserRepository(db),
    },
    {
      provide: ORGANIZATION_REPOSITORY,
      inject: [DATABASE_CLIENT],
      useFactory: (db: DatabaseClient) => new DrizzleOrganizationRepository(db),
    },
    {
      provide: WORKSPACE_REPOSITORY,
      inject: [DATABASE_CLIENT],
      useFactory: (db: DatabaseClient) => new DrizzleWorkspaceRepository(db),
    },
    {
      provide: WORKSPACE_MEMBERSHIP_REPOSITORY,
      inject: [DATABASE_CLIENT],
      useFactory: (db: DatabaseClient) => new DrizzleWorkspaceMembershipRepository(db),
    },
    {
      provide: ORGANIZATION_MEMBERSHIP_REPOSITORY,
      inject: [DATABASE_CLIENT],
      useFactory: (db: DatabaseClient) => new DrizzleOrganizationMembershipRepository(db),
    },
    {
      provide: SESSION_REPOSITORY,
      inject: [DATABASE_CLIENT],
      useFactory: (db: DatabaseClient) => new DrizzleSessionRepository(db),
    },
  ],
  exports: [
    DATABASE_CLIENT,
    USER_REPOSITORY,
    ORGANIZATION_REPOSITORY,
    WORKSPACE_REPOSITORY,
    WORKSPACE_MEMBERSHIP_REPOSITORY,
    ORGANIZATION_MEMBERSHIP_REPOSITORY,
    SESSION_REPOSITORY,
  ],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(private readonly moduleRef: ModuleRef) {}

  /** Drain the connection pool so a rolling deploy does not leak connections. */
  async onApplicationShutdown(): Promise<void> {
    const db = this.moduleRef.get<DatabaseClient>(DATABASE_CLIENT, { strict: false });
    if (db) await closeDbClient(db);
  }
}
