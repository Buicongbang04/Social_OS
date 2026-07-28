import { Global, Module } from "@nestjs/common";
import { buildGatewayFromEnv, type ProviderGateway } from "@repo/ai";

/**
 * The Provider Gateway, or nothing.
 *
 * Null when no AI provider is configured, and the API still boots. Login,
 * workspaces, goals and documents do not need a model, and refusing to start
 * without a paid credential would make most of the platform unreachable to
 * anyone who has not bought one. The chat endpoint checks and says so.
 *
 * Built from the same `buildGatewayFromEnv` the runtime uses: a chain that
 * differed between the two processes would mean the same workspace got
 * different answers depending on which one served the request.
 */
export const AI_GATEWAY = Symbol("AI_GATEWAY");

@Global()
@Module({
  providers: [
    {
      provide: AI_GATEWAY,
      useFactory: (): ProviderGateway | null =>
        buildGatewayFromEnv()?.gateway ?? null,
    },
  ],
  exports: [AI_GATEWAY],
})
export class AiModule {}
