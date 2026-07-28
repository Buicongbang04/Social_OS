import type { ProviderGateway } from "@repo/ai";
import type { DocumentRepository } from "@repo/domain";
import {
  DocumentIndexer,
  buildKnowledgeFromEnv,
  createKnowledgeCapabilities,
} from "@repo/knowledge";
import { S3ObjectStore } from "@repo/storage";
import type { CapabilityImplementation } from "@repo/runtime";

export type KnowledgeStack = {
  indexer: DocumentIndexer;
  capabilities: readonly CapabilityImplementation[];
  /** For the startup log: which vector database and which storage endpoint. */
  qdrantUrl: string;
  storageEndpoint: string;
};

/**
 * Assemble the knowledge stack, or return null.
 *
 * Null when Qdrant, MinIO or an AI provider is missing, and the runtime starts
 * anyway without document search. That mirrors the AI engines: a platform that
 * refuses to boot because one optional subsystem has no credentials is a
 * platform most people never see working at all. What it must not do is start
 * and pretend — hence the startup log, and hence documents that stay PENDING
 * rather than being marked READY with nothing behind them.
 */
export function buildKnowledgeStack(input: {
  gateway: ProviderGateway | null;
  documents: DocumentRepository;
  env?: NodeJS.ProcessEnv;
  onError?: (error: unknown, document: { id: string }) => void;
}): KnowledgeStack | null {
  const env = input.env ?? process.env;

  // Every one of these goes through `text`, because a `.env` that declares a
  // variable and leaves it blank hands the process an empty string rather than
  // nothing — and an empty bucket name or access key fails much later, with an
  // error that names neither.
  const qdrantUrl = text(env.QDRANT_URL);
  const storageEndpoint = text(env.MINIO_URL);
  const accessKeyId = text(env.MINIO_ROOT_USER);
  const secretAccessKey = text(env.MINIO_ROOT_PASSWORD);

  if (
    !input.gateway ||
    !qdrantUrl ||
    !storageEndpoint ||
    !accessKeyId ||
    !secretAccessKey
  ) {
    return null;
  }

  // Same builder services/api uses. They have to agree on the embedding model
  // and the Qdrant instance: a collection belongs to one model, so an API
  // configured differently would search a collection the documents are not in
  // and find nothing, with no error to say why.
  const knowledge = buildKnowledgeFromEnv({ gateway: input.gateway, env });
  if (!knowledge) {
    throw new Error(
      "Qdrant and a gateway were both present but the knowledge service did not build.",
    );
  }

  const storage = new S3ObjectStore({
    endpoint: storageEndpoint,
    region: text(env.MINIO_REGION) ?? "us-east-1",
    bucket: text(env.MINIO_BUCKET) ?? "ai-social-os",
    accessKeyId,
    secretAccessKey,
    forcePathStyle: true,
  });

  return {
    indexer: new DocumentIndexer({
      documents: input.documents,
      storage,
      knowledge,
      ...(input.onError ? { onError: input.onError } : {}),
    }),
    capabilities: createKnowledgeCapabilities({ knowledge }),
    qdrantUrl,
    storageEndpoint,
  };
}

/** See the note on `text` in ai-engines.ts: a blank variable is not a value. */
function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}
