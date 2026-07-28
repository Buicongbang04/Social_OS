import {
  canPublish,
  findConnector,
  publishToFacebook,
  type PostDraft,
} from "@repo/connectors";
import type { Metadata, WorkspaceId } from "@repo/core";
import type {
  SocialAccount,
  SocialAccountRepository,
  SecretRepository,
} from "@repo/domain";
import { RuntimeError, type CapabilityImplementation } from "@repo/runtime";
import type { Keyring } from "@repo/secrets";

/**
 * Publishing, for real.
 *
 * This is the first thing in the system that reaches somebody's audience, and
 * the only one whose mistakes cannot be undone by re-running it. Everything
 * below is written around that: it refuses far more than it accepts, and where
 * it is unsure which account was meant, it stops rather than guessing.
 */
export type SocialPublisherDeps = {
  accounts: SocialAccountRepository;
  secrets: SecretRepository;
  keyring: Keyring;
};

/** The shape sealed in the vault by both the OAuth and the paste-a-token path. */
type StoredTokens = { accessToken: string; refreshToken: string | null };

export function buildSocialPublish(
  deps: SocialPublisherDeps,
): CapabilityImplementation {
  return {
    descriptor: {
      id: "social.publish",
      name: "Publish to Social",
      description:
        "Đăng nội dung đã có lên kênh mạng xã hội đã kết nối. Luôn phụ thuộc vào bước tạo nội dung.",
      version: "1.0.0",
      category: "Social",
      supportedWorkers: ["FUNCTION"],
      permissions: ["workspace.workflow.execute"],
    },
    handler: async (context) => {
      const targets = await resolveTargets(
        deps.accounts,
        context.workspaceId,
        context.inputs,
      );

      const draft = draftFrom(context.inputs, context.previous);
      const posted: Metadata[] = [];

      // One at a time, deliberately. Publishing in parallel would mean a
      // failure halfway through leaves an unknown subset already posted, and
      // the retry would repost to the ones that succeeded.
      for (const account of targets) {
        const token = await openToken(deps, context.workspaceId, account);
        const result = await publishToFacebook(
          { externalId: account.externalId, accessToken: token },
          draft,
        );

        posted.push({
          account: account.displayName,
          connectorId: account.connectorId,
          postId: result.externalId,
          url: result.url,
        });
      }

      return {
        published: true,
        posts: posted,
        // Named accounts rather than a count, because "3 posts" in a run log
        // does not say which audiences saw it.
        platform: targets.map((account) => account.connectorId),
      };
    },
  };
}

/**
 * Decide which connected accounts this post goes to.
 *
 * The rule, in order: what the plan asked for; failing that, the only
 * connection there is; failing that, stop. With several accounts connected and
 * nothing said, "post it" is a sentence missing its object, and choosing one
 * would be the platform picking somebody's audience for them — a mistake with
 * no undo.
 */
async function resolveTargets(
  repository: SocialAccountRepository,
  workspaceId: WorkspaceId,
  inputs: Metadata,
): Promise<SocialAccount[]> {
  const connected = (await repository.list(workspaceId)).filter((account) => {
    if (account.status !== "ACTIVE") return false;
    const connector = findConnector(account.connectorId);
    // A connected account on a platform this build cannot post to is not a
    // target. Including it would fail deep inside the publish call with a
    // message about the wrong thing.
    return connector !== null && canPublish(connector);
  });

  if (connected.length === 0) {
    throw new RuntimeError(
      "VALIDATION",
      "Workspace chưa kết nối kênh nào đăng được. Vào phần Kênh mạng xã hội để nối.",
      { retryable: false },
    );
  }

  const wanted = namesFrom(inputs);
  if (wanted.length === 0) {
    if (connected.length === 1) return connected;

    throw new RuntimeError(
      "VALIDATION",
      `Có ${connected.length} kênh đang nối nên cần nói rõ đăng lên kênh nào: ${connected
        .map((account) => account.displayName)
        .join(", ")}.`,
      { retryable: false },
    );
  }

  const matched = connected.filter((account) =>
    wanted.some(
      (name) =>
        name === account.externalId ||
        name === account.id ||
        name.toLowerCase() === account.displayName.toLowerCase(),
    ),
  );

  if (matched.length === 0) {
    // Not a near-match, and not the first connection either. A plan that names
    // a page this workspace has not connected is a plan built on a wrong
    // assumption, and publishing somewhere else is not a recovery.
    throw new RuntimeError(
      "VALIDATION",
      `Không tìm thấy kênh nào tên "${wanted.join('", "')}". Đang nối: ${connected
        .map((account) => account.displayName)
        .join(", ")}.`,
      { retryable: false },
    );
  }

  return matched;
}

/** Account names or ids the plan asked for, however it phrased them. */
function namesFrom(inputs: Metadata): string[] {
  const raw = inputs.accounts ?? inputs.account ?? inputs.pages ?? inputs.page;

  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

/**
 * The post itself, from the plan or from whatever produced the content.
 *
 * Reads the upstream step rather than requiring the planner to copy the text
 * into the inputs — a model asked to repeat a long body into a JSON field
 * paraphrases it, and the thing published would not be the thing that was
 * reviewed.
 */
function draftFrom(
  inputs: Metadata,
  previous: Readonly<Record<string, Metadata>>,
): PostDraft {
  const content = previous["content.generate"];

  const message =
    text(inputs.message) ??
    text(inputs.content) ??
    joined(content?.title, content?.body) ??
    "";

  return { message, link: text(inputs.link) ?? null };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function joined(title: unknown, body: unknown): string | null {
  const parts = [text(title), text(body)].filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * Open the account's access token.
 *
 * Read at publish time rather than held anywhere: a token cached in memory
 * keeps working after the connection is removed, which is the difference
 * between revoking access and asking politely.
 */
async function openToken(
  deps: SocialPublisherDeps,
  workspaceId: WorkspaceId,
  account: SocialAccount,
): Promise<string> {
  const secret = await deps.secrets.findByName(
    workspaceId,
    "WORKSPACE",
    account.secretName,
  );
  const version = secret ? await deps.secrets.activeVersion(secret.id) : null;

  if (!version) {
    throw new RuntimeError(
      "SECURITY",
      `Không còn credential cho ${account.displayName}. Hãy kết nối lại kênh này.`,
      { retryable: false, context: { account: account.id } },
    );
  }

  const stored = JSON.parse(deps.keyring.open(version)) as StoredTokens;
  if (!stored.accessToken) {
    throw new RuntimeError(
      "SECURITY",
      `Credential của ${account.displayName} không đọc được.`,
      { retryable: false, context: { account: account.id } },
    );
  }

  return stored.accessToken;
}
