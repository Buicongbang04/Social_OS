import type { ProviderGateway } from "@repo/ai";
import { KnowledgeService } from "./service";
import { QdrantVectorStore } from "./store/qdrant-store";

/**
 * Build the search half of Knowledge from the environment, or return null.
 *
 * Shared by the runtime, which also indexes, and the API, which only searches.
 * They must agree on the embedding model and the Qdrant instance: a collection
 * belongs to exactly one model, so an API configured differently from the
 * indexer would search a collection the documents are not in and find nothing —
 * with no error anywhere to say why.
 */
export function buildKnowledgeFromEnv(input: {
  gateway: ProviderGateway | null;
  env?: NodeJS.ProcessEnv;
}): KnowledgeService | null {
  const env = input.env ?? process.env;
  const qdrantUrl = text(env.QDRANT_URL);

  if (!input.gateway || !qdrantUrl) return null;

  return new KnowledgeService({
    gateway: input.gateway,
    store: new QdrantVectorStore({
      url: qdrantUrl,
      ...(text(env.QDRANT_API_KEY) ? { apiKey: text(env.QDRANT_API_KEY) } : {}),
    }),
    ...(text(env.AI_EMBEDDING_MODEL)
      ? { model: text(env.AI_EMBEDDING_MODEL) }
      : {}),
  });
}

/** See the note in @repo/ai's from-env: a blank variable is not a value. */
function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}
