# @repo/knowledge

Chunking, embedding and vector search over a workspace's documents.
See `docs/data/08_VECTOR_DATABASE.md`.

```
document text
   → chunkText()              boundaries a reader would recognise, with overlap
   → ProviderGateway.embed()  whichever provider in the chain can embed
   → VectorStore              Qdrant in production, in-memory in tests
```

`DocumentIndexer` drives that pipeline in the background; `knowledge.search` is
the capability a Goal uses to read the result.

## Three rules the design enforces rather than documents

**A collection belongs to one embedding model.** Two models place the same
sentence in unrelated coordinate systems, so the cosine between their vectors
is a number with no meaning — and nothing at query time can detect it. The
model is therefore part of the collection's identity (`collectionNameFor`), and
changing models means a new collection and a re-index, never a silent mixture.

**Every search is scoped to a workspace.** `SearchQuery.workspaceId` is
required, not optional: the one catastrophic failure of a shared vector
database is returning another company's private material, and it happens by
omission. The filter is applied inside the query Qdrant runs, so it constrains
the nearest-neighbour search itself rather than trimming its results.

**Retrieval that is not used is not retrieval.** `knowledge.search` returns
passages with their source; `content.generate` puts them in the prompt and says
`usedKnowledge` in its output. Without that last step the pipeline pays for the
expensive half of RAG and writes from the model's imagination anyway — and the
result looks equally confident either way.

## Indexing

Uploads land as `PENDING`. The runtime claims them by compare-and-swap, indexes
them, and records `READY` with the chunk count and the model, or `FAILED` with
a reason. It is a background loop rather than part of the upload request
because embedding a long document is many provider round trips, and a user
watching a spinner for two minutes would reasonably conclude it had hung.

## Testing

```bash
pnpm --filter @repo/knowledge test        # no network, no containers
docker compose up -d qdrant
pnpm --filter @repo/knowledge test:int    # real Qdrant on :6333
```

The unit suite runs against `InMemoryVectorStore` and a `FakeDocumentRepository`
that enforces the same version CAS and the same transition whitelist as the
Drizzle one. Neither is a mock that agrees with whatever it is asked: a fake
repository that always succeeded would have let through the off-by-one that
marked documents READY with a stale version — silently, since the repository
returns null instead of throwing.

The integration suite exists for what the in-memory store cannot have — the
point-ID format the server accepts (Qdrant takes only integers and UUIDs, while
the client's TypeScript type says `string`), the filter syntax, and write
visibility.
