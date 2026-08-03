import {
  canPublish,
  fetchInbox,
  findConnector,
  findRecentPost,
  publishToFacebook,
  type PostDraft,
  type PublishedPost,
} from "@repo/connectors";
import type { Metadata, WorkspaceId } from "@repo/core";
import type {
  SocialAccount,
  SocialAccountRepository,
  SecretRepository,
} from "@repo/domain";
import type { Metrics } from "@repo/observability";
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
  /**
   * Whether a run nobody started may post.
   *
   * Off by default, and this is not caution for its own sake — it is a thing
   * that has already happened here. Connecting a channel changes what every
   * Goal already in the system does the next time it runs, and a recurring Goal
   * fires at three in the morning with nobody watching. The first time live
   * publishing was switched on, a scheduled run put marketing copy on a real
   * Page minutes after the verification finished.
   */
  allowUnattended: boolean;
  /**
   * Where publishes are counted. Optional: the capability must work without
   * it, because a missing counter is not a reason to stop posting.
   */
  metrics?: Metrics;
};

/**
 * What is needed to read a connection and open its credential.
 *
 * Narrower than `SocialPublisherDeps` because the helpers below only read —
 * asking for the publish switch as well would let a change to publishing
 * ripple into code that has nothing to do with it.
 */
export type VaultAccess = Pick<
  SocialPublisherDeps,
  "accounts" | "secrets" | "keyring"
>;

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
      // `trigger`, not `ownerId`. An earlier version of this check read
      // `ownerId === null` and never fired once: a scheduled Execution inherits
      // the Goal's owner, so it looks exactly like a person pressing a button.
      // The unit test passed because it constructed the context by hand — it
      // tested the assumption rather than the system, and a cron run published
      // to a real Page while the check sat there looking correct.
      //
      // It refuses rather than parking for approval, also deliberately.
      // Approving a waiting task marks it SUCCESS without re-running the
      // handler, so a publish step that asked for approval would report
      // COMPLETED to whoever approved it and post nothing at all.
      if (context.trigger === "SCHEDULE" && !deps.allowUnattended) {
        throw new RuntimeError(
          "VALIDATION",
          "Lịch tự chạy không được đăng bài khi không có người duyệt. " +
            "Chạy lại Goal này bằng tay, hoặc bật SOCIAL_PUBLISH_UNATTENDED nếu thật sự muốn nền tảng tự đăng.",
          { retryable: false, context: { executionId: context.executionId } },
        );
      }

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
        const target = {
          externalId: account.externalId,
          accessToken: token,
        };

        const result = await publishOnce(
          deps,
          account,
          target,
          draft,
          context.attempt,
        ).catch((error: unknown) => {
          // Counted before rethrowing. A failed publish is the event somebody
          // watching most wants to see, and only counting the successes makes
          // the graph look best when the platform is worst.
          deps.metrics?.publishes.inc({
            connector: account.connectorId,
            outcome: "failed",
          });
          throw error;
        });

        deps.metrics?.publishes.inc({
          connector: account.connectorId,
          // Apart from a fresh post, because a retry recognising an earlier
          // attempt is not another thing reaching an audience — counting it as
          // one would overstate what went out.
          outcome: result.alreadyPosted ? "duplicate" : "ok",
        });

        posted.push({
          account: account.displayName,
          connectorId: account.connectorId,
          postId: result.post.externalId,
          url: result.post.url,
          // Recorded rather than hidden. A run that says it published when it
          // only found an earlier attempt is telling a different story, and
          // whoever reads the log later needs the real one.
          alreadyPosted: result.alreadyPosted,
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
 * Read the inbox of every connected channel.
 *
 * Read-only, and that is the whole design. It reports who wrote, when, and a
 * trimmed snippet — enough for a Goal to say "three people are waiting on a
 * reply about shipping" — and it cannot answer anybody. Replying on somebody's
 * behalf to their customers is a much larger decision than reading, and
 * bundling the two would mean granting one to get the other.
 *
 * Worth saying plainly: this puts customers' messages into a model's context.
 * That is what makes summarising them possible, and it is also a thing a
 * workspace should know it has switched on.
 */
export function buildSocialInbox(deps: VaultAccess): CapabilityImplementation {
  return {
    descriptor: {
      id: "social.inbox",
      name: "Read Social Inbox",
      description:
        "Đọc tin nhắn khách gửi tới các kênh đã kết nối. CHỈ ĐỌC — không trả lời được.",
      version: "1.0.0",
      category: "Social",
      supportedWorkers: ["FUNCTION"],
      permissions: ["workspace.workflow.execute"],
    },
    handler: async (context) => {
      const accounts = (await deps.accounts.list(context.workspaceId)).filter(
        (account) => {
          if (account.status !== "ACTIVE") return false;
          const connector = findConnector(account.connectorId);
          return connector !== null && canPublish(connector);
        },
      );

      if (accounts.length === 0) {
        throw new RuntimeError(
          "VALIDATION",
          "Workspace chưa kết nối kênh nào để đọc tin nhắn.",
          { retryable: false },
        );
      }

      const limit = Number(context.inputs.limit) || 20;
      const threads: Metadata[] = [];

      // Every channel, unlike publishing. Reading from the wrong inbox tells
      // someone something they already had a right to see; posting to the
      // wrong audience cannot be taken back. The asymmetry is the reason these
      // two capabilities resolve their targets differently.
      for (const account of accounts) {
        const token = await openToken(deps, context.workspaceId, account);
        const inbox = await fetchInbox(
          { externalId: account.externalId, accessToken: token },
          { limit },
        ).catch(async (error: unknown) => {
          await markIfCredentialDead(deps, account, error);
          throw error;
        });

        for (const thread of inbox) {
          threads.push({ ...thread, account: account.displayName });
        }
      }

      return {
        threads,
        total: threads.length,
        unread: threads.filter((thread) => thread.unread === true).length,
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
 * Publish, or recognise that a previous attempt already did.
 *
 * A dropped connection is retryable because the request may never have arrived
 * — but it may equally have arrived and been accepted, with only the answer
 * lost. Retrying blindly is how one post becomes two on somebody's real
 * audience, and there is no undo for that.
 *
 * The check runs only from the second attempt onwards. On the first there is
 * by definition nothing to find, and a feed read before every post would spend
 * a round trip to learn nothing.
 */
export async function publishOnce(
  deps: VaultAccess,
  account: SocialAccount,
  target: { externalId: string; accessToken: string },
  draft: PostDraft,
  attempt: number,
): Promise<{ post: PublishedPost; alreadyPosted: boolean }> {
  if (attempt > 0) {
    const existing = await findRecentPost(target, draft.message).catch(
      async (error: unknown) => {
        await markIfCredentialDead(deps, account, error);
        throw error;
      },
    );

    // Found: the earlier attempt did land. Returning it rather than posting
    // again, and rather than failing — the Goal asked for the post to exist,
    // and it exists.
    if (existing) return { post: existing, alreadyPosted: true };
  }

  const post = await publishToFacebook(target, draft).catch(
    async (error: unknown) => {
      await markIfCredentialDead(deps, account, error);
      throw error;
    },
  );

  return { post, alreadyPosted: false };
}

/**
 * Record that a credential has stopped working, when that is what happened.
 *
 * Without this the connection sits at ACTIVE while every publish fails, and the
 * only way to find out is to read a task's error text. The status column and
 * its EXPIRED value existed before this and nothing ever wrote them — an enum
 * value that is never set reads like a boundary the system enforces, which is
 * worse than not having it.
 *
 * The marking is best-effort on purpose: it must not turn a publish failure the
 * caller can act on into a different failure about bookkeeping.
 */
async function markIfCredentialDead(
  deps: VaultAccess,
  account: SocialAccount,
  error: unknown,
): Promise<void> {
  if (!(error instanceof RuntimeError)) return;

  const verdict = error.context?.credential;
  if (verdict !== "EXPIRED" && verdict !== "REVOKED") return;

  try {
    await deps.accounts.updateStatus(account.id, verdict, null);
  } catch {
    // Swallowed deliberately. The publish already failed with a message that
    // says what to do; failing again over a status write would replace it.
  }
}

/**
 * Open the account's access token.
 *
 * Read at publish time rather than held anywhere: a token cached in memory
 * keeps working after the connection is removed, which is the difference
 * between revoking access and asking politely.
 */
export async function openToken(
  deps: VaultAccess,
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
