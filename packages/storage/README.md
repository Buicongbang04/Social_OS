# @repo/storage

S3-compatible object storage. MinIO in development, S3 or R2 in production —
one implementation for both, which is why this uses the AWS SDK rather than
MinIO's own client. See `docs/data/06_OBJECT_STORAGE.md`.

```ts
const store = new S3ObjectStore({ endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle: true });
await store.put({ workspaceId, folder: "documents", name, body, contentType, fileName });
const url = await store.presignGet({ workspaceId, folder: "documents", name });
```

## Keys are built, never accepted

`keyFor` puts the workspace at the front of every key and sanitises the name.
A caller passes a folder and a name; it cannot pass a whole key. That is the
difference between a name of `../../documents/<other tenant>/doc` addressing
someone else's file and addressing a file called `.._.._documents_...`.

## Testing

```bash
pnpm --filter @repo/storage test       # key layout, no network
docker compose up -d minio
pnpm --filter @repo/storage test:int   # real MinIO on :9000
```

The integration suite is where the real bugs showed up. Two worth knowing:

- **SigV4 signs header bytes.** A file called `báo cáo.txt` went straight into
  `Content-Disposition` and every upload failed with `SignatureDoesNotMatch` —
  an error that names neither headers nor file names. Fixed by RFC 6266:
  an ASCII `filename` plus `filename*=UTF-8''…`.
- **A presigned URL is a bearer credential.** The only way to prove one works
  is to fetch it with no credentials, which is what the suite does.
