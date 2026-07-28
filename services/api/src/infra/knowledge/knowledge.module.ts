import { Global, Module } from "@nestjs/common";
import type { ProviderGateway } from "@repo/ai";
import { buildKnowledgeFromEnv, type KnowledgeService } from "@repo/knowledge";
import { AI_GATEWAY } from "../ai/ai.module";

/**
 * Document search, or nothing.
 *
 * Null when Qdrant or an AI provider is missing, and chat still works — it
 * simply answers without opening the workspace's documents, which is what it
 * did before this existed. What it must not do is claim to have read them.
 */
export const KNOWLEDGE_SERVICE = Symbol("KNOWLEDGE_SERVICE");

@Global()
@Module({
  providers: [
    {
      provide: KNOWLEDGE_SERVICE,
      inject: [AI_GATEWAY],
      useFactory: (gateway: ProviderGateway | null): KnowledgeService | null =>
        buildKnowledgeFromEnv({ gateway }),
    },
  ],
  exports: [KNOWLEDGE_SERVICE],
})
export class KnowledgeModule {}
