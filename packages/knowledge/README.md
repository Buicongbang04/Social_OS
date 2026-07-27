# @repo/knowledge

Chunking, embedding and vector search over a workspace's documents.
See `docs/data/08_VECTOR_DATABASE.md`.

```
document text
   → chunkText()           boundaries a reader would recognise, with overlap
   → ProviderGateway.embed()  whichever provider in the chain can embed
   → VectorStore            Qdrant in production, in-memory in tests
```

## Two rules the design enforces rather than documents

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

## Testing

```bash
pnpm --filter @repo/knowledge test        # no network, no containers
docker compose up -d qdrant
pnpm --filter @repo/knowledge test:int    # real Qdrant on :6333
```

The unit suite runs against `InMemoryVectorStore`, which is not a mock: it runs
the same isolation filter, dimension check and similarity function, and being
exhaustive rather than approximate it is also the reference the Qdrant
implementation is checked against.

The integration suite exists for what the in-memory store cannot have — the
point-ID format the server accepts (Qdrant takes only integers and UUIDs, while
the client's TypeScript type says `string`), the filter syntax, and write
visibility. Every test there caught something the unit suite could not see.
