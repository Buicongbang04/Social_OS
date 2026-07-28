import { Global, Module } from "@nestjs/common";
import { buildGatewayFromEnv, type ProviderGateway } from "@repo/ai";
import { SecretsModule } from "../../modules/secrets/secrets.module";
import { AI_GATEWAY } from "./ai.tokens";
import { WorkspaceGatewayFactory } from "./workspace-gateway";

@Global()
@Module({
  imports: [SecretsModule],
  providers: [
    {
      provide: AI_GATEWAY,
      useFactory: (): ProviderGateway | null =>
        buildGatewayFromEnv()?.gateway ?? null,
    },
    WorkspaceGatewayFactory,
  ],
  exports: [AI_GATEWAY, WorkspaceGatewayFactory],
})
export class AiModule {}
