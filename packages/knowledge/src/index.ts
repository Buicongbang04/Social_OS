/**
 * @repo/knowledge — documents in, retrievable answers out.
 *
 * Chunking, embedding through the Provider Gateway, and vector search with
 * workspace isolation enforced by the store rather than by convention.
 * See docs/data/08_VECTOR_DATABASE.md.
 */
export * from "./chunking/chunk";
export * from "./store/types";
export * from "./store/memory-store";
export * from "./store/qdrant-store";
export * from "./service";
export * from "./capability";
export * from "./indexer";
