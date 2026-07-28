import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import Redis from "ioredis";
import request from "supertest";
import { truncateTenantData } from "@repo/database";
import { AppModule } from "../app.module";
import { WorkspaceGatewayFactory } from "../infra/ai/workspace-gateway";
import { DATABASE_CLIENT } from "../infra/database/database.module";
import { REDIS_CLIENT } from "../infra/redis/redis.module";

/**
 * Boots the real application against the real Postgres and Redis from
 * docker/docker-compose.yml. Nothing is mocked: an isolation test that stubs
 * the database proves nothing about isolation.
 */
export type TestApp = {
  app: INestApplication;
  http: () => request.Agent;
  reset: () => Promise<void>;
  close: () => Promise<void>;
};

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix(process.env.API_PREFIX ?? "api/v1", {
    exclude: ["health", "metrics"],
  });
  await app.init();

  const db = app.get(DATABASE_CLIENT);
  const gateways = app.get(WorkspaceGatewayFactory);
  const redis = app.get<Redis>(REDIS_CLIENT);

  return {
    app,
    http: () => request(app.getHttpServer()),

    /**
     * Truncates tenant data between tests. The permission catalog and role
     * matrix (seeded system data) are left intact — they are configuration,
     * not test fixtures.
     */
    async reset() {
      await truncateTenantData(db);
      // Redis holds the permission cache and the session denylist; leaving
      // them would let one test's authorization decisions bleed into the next.
      await redis.flushdb();
      // In-process too: resolved provider keys are cached in memory, and an
      // entry outliving the rows it was built from is exactly the bleed the
      // truncate above is meant to prevent.
      gateways.clear();
    },

    async close() {
      await app.close();
    },
  };
}

export type RegisteredUser = {
  userId: string;
  email: string;
  accessToken: string;
};

/** Registers a user through the public API and returns their bearer token. */
export async function registerUser(
  testApp: TestApp,
  email: string,
): Promise<RegisteredUser> {
  const response = await testApp
    .http()
    .post("/api/v1/auth/register")
    .send({ email, password: "integration-test-password" })
    .expect(201);

  return {
    userId: response.body.data.user.id,
    email,
    accessToken: response.body.data.tokens.accessToken,
  };
}

/** Creates an organization plus a workspace owned by `user`. */
export async function createTenant(
  testApp: TestApp,
  user: RegisteredUser,
  slug: string,
): Promise<{ organizationId: string; workspaceId: string }> {
  const org = await testApp
    .http()
    .post("/api/v1/organizations")
    .set("Authorization", `Bearer ${user.accessToken}`)
    .send({ name: `Org ${slug}`, slug: `org-${slug}` })
    .expect(201);

  const workspace = await testApp
    .http()
    .post("/api/v1/workspaces")
    .set("Authorization", `Bearer ${user.accessToken}`)
    .send({
      name: `Workspace ${slug}`,
      slug: `ws-${slug}`,
      organizationId: org.body.data.id,
    })
    .expect(201);

  return {
    organizationId: org.body.data.id,
    workspaceId: workspace.body.data.id,
  };
}
