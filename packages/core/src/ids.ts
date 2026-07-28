import { ulid } from "ulid";

/**
 * Prefixed identifiers, per docs/data/02_DATA_MODEL.md:
 * IDs are application-generated (never DB auto-increment) and carry a
 * type prefix so an ID is self-describing in logs, URLs and error messages.
 *
 *   usr_01HX8ZQ7P9K2M4N6R8T0V2W4Y6
 */
export const ID_PREFIXES = {
  user: "usr",
  organization: "org",
  workspace: "wsp",
  membership: "mbr",
  session: "ses",
  role: "rol",
  request: "req",
  idempotency: "idm",
  // Runtime (docs/kernel/): a Goal is the user's objective, an Execution is
  // one run of it, and a Task is one node of that run's plan.
  goal: "gol",
  execution: "exe",
  task: "tsk",
  event: "evt",
  worker: "wrk",
  /** One metered AI provider call (docs/platform/24_BILLING_METERING.md). */
  aiUsage: "aiu",
  // Knowledge (docs/data/08_VECTOR_DATABASE.md): a Document is what was
  // uploaded, a Chunk is one retrievable piece of it.
  document: "doc",
  chunk: "chk",
  // Chat (docs/ai/06_AGENT_MEMORY.md): a Conversation is one thread, a
  // Message is one turn in it.
  conversation: "cnv",
  message: "msg",
  /** One durable fact about a workspace (docs/ai/06_AGENT_MEMORY.md). */
  workspaceMemory: "mem",
  /** A stored credential (docs/platform/12_SECRET_MANAGER.md). */
  secret: "sec",
  secretVersion: "sev",
  /**
   * A social platform account a workspace has connected
   * (docs/03_DOMAIN_MODEL.md, Integration Domain).
   */
  socialAccount: "sac",
} as const;

export type IdPrefixName = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[IdPrefixName];

const PREFIX_VALUES = new Set<string>(Object.values(ID_PREFIXES));
const SEPARATOR = "_";
/** Crockford base32, as produced by ULID. */
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Branded ID types — a WorkspaceId cannot be passed where a UserId is
 * expected, which is the main defence against wiring the wrong tenant
 * identifier into a query.
 */
declare const brand: unique symbol;
type Branded<TName extends IdPrefixName> = string & { readonly [brand]: TName };

export type UserId = Branded<"user">;
export type OrganizationId = Branded<"organization">;
export type WorkspaceId = Branded<"workspace">;
export type MembershipId = Branded<"membership">;
export type SessionId = Branded<"session">;
export type RoleId = Branded<"role">;
export type RequestId = Branded<"request">;
export type IdempotencyId = Branded<"idempotency">;
export type GoalId = Branded<"goal">;
export type ExecutionId = Branded<"execution">;
export type TaskId = Branded<"task">;
export type EventId = Branded<"event">;
export type WorkerId = Branded<"worker">;
export type AiUsageId = Branded<"aiUsage">;
export type DocumentId = Branded<"document">;
export type ChunkId = Branded<"chunk">;
export type ConversationId = Branded<"conversation">;
export type MessageId = Branded<"message">;
export type WorkspaceMemoryId = Branded<"workspaceMemory">;
export type SecretId = Branded<"secret">;
export type SecretVersionId = Branded<"secretVersion">;
export type SocialAccountId = Branded<"socialAccount">;

export type IdOf<TName extends IdPrefixName> = Branded<TName>;

/** Generate a new prefixed ULID, e.g. `newId("workspace")` → `wsp_01HX...`. */
export function newId<TName extends IdPrefixName>(name: TName): IdOf<TName> {
  return `${ID_PREFIXES[name]}${SEPARATOR}${ulid()}` as IdOf<TName>;
}

export type ParsedId = {
  prefix: IdPrefix;
  value: string;
};

/** Split a prefixed ID, or return null when it is malformed/unknown. */
export function parseId(id: string): ParsedId | null {
  const separatorIndex = id.indexOf(SEPARATOR);
  if (separatorIndex <= 0) return null;

  const prefix = id.slice(0, separatorIndex);
  const value = id.slice(separatorIndex + 1);

  if (!PREFIX_VALUES.has(prefix)) return null;
  if (!ULID_PATTERN.test(value)) return null;

  return { prefix: prefix as IdPrefix, value };
}

/** Type guard: does `id` look like a well-formed ID of this entity type? */
export function isId<TName extends IdPrefixName>(
  name: TName,
  id: string,
): id is IdOf<TName> {
  const parsed = parseId(id);
  return parsed !== null && parsed.prefix === ID_PREFIXES[name];
}

/**
 * Assert-and-narrow an untrusted string (route param, request body) into a
 * branded ID. Throws so callers cannot silently proceed with a bad tenant key.
 */
export function assertId<TName extends IdPrefixName>(
  name: TName,
  id: string,
): IdOf<TName> {
  if (!isId(name, id)) {
    throw new TypeError(
      `Invalid ${name} id: expected prefix "${ID_PREFIXES[name]}_", got "${id}"`,
    );
  }
  return id;
}
