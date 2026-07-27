/**
 * Universal entity metadata required on every persisted entity, per
 * docs/data/02_DATA_MODEL.md. `version` backs optimistic locking
 * (compare-and-swap) per docs/data/04_TRANSACTION_MODEL.md.
 */
export type AuditMetadata = {
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  /** Incremented on every write; a stale value must fail the update. */
  version: number;
};

/**
 * Soft delete is the default per docs/data/02_DATA_MODEL.md. Operational
 * tables (sessions, idempotency keys) are a deliberate exception — they
 * expire rather than being retained.
 */
export type SoftDeletable = {
  deletedAt: Date | null;
  deletedBy: string | null;
};

export type BaseEntity<TId extends string = string> = {
  id: TId;
} & AuditMetadata;

export type SoftDeletableEntity<TId extends string = string> = BaseEntity<TId> &
  SoftDeletable;

/** Arbitrary per-entity extension bag; every entity in the docs carries one. */
export type Metadata = Record<string, unknown>;
