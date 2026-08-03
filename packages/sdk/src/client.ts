import { ApiError } from "./error";
import type {
  ApiErrorBody,
  AuthResult,
  AuthTokens,
  ChatMessage,
  ChatStreamEvent,
  Citation,
  ToolRun,
  Conversation,
  CreateGoalInput,
  DocumentSummary,
  Envelope,
  Execution,
  ExecutionUsage,
  Goal,
  Organization,
  PublicUser,
  Task,
  UploadedDocument,
  Campaign,
  CampaignStatus,
  ConnectorSummary,
  ManageablePage,
  ContentChannel,
  ContentLength,
  ContentPiece,
  ContentPieceStatus,
  ContentTone,
  TrendItem,
  TrendSourceName,
  Inbox,
  RevisedContent,
  SeoContent,
  SpendReport,
  WrittenContent,
  PostStatsReport,
  ProviderKeyStatus,
  SocialConnection,
  StoredSecret,
  WorkspaceMemory,
  Workspace,
} from "./types";

export type TokenStore = {
  read(): AuthTokens | null;
  write(tokens: AuthTokens | null): void;
};

/** Keeps tokens for the lifetime of the object. The browser app swaps in storage. */
export function inMemoryTokenStore(
  initial: AuthTokens | null = null,
): TokenStore {
  let tokens = initial;
  return {
    read: () => tokens,
    write: (next) => {
      tokens = next;
    },
  };
}

export type ClientOptions = {
  baseUrl: string;
  tokens?: TokenStore;
  /** Sent as `x-workspace-id` on workspace-scoped calls. */
  workspaceId?: string | null;
  fetch?: typeof fetch;
  /** Called when refresh fails and the session is gone for good. */
  onSignedOut?: () => void;
};

const WORKSPACE_HEADER = "x-workspace-id";

/**
 * Typed client for the Runtime API.
 *
 * Two things it takes off every caller: attaching the workspace header — the
 * API authorises against it, so forgetting it turns a valid request into a
 * confusing 400 — and refreshing an expired access token. Refresh is
 * single-flight: several requests expiring together produce one refresh, not
 * one each, and since refresh tokens are one-time-use, racing them would
 * invalidate the session outright.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly tokens: TokenStore;
  private readonly doFetch: typeof fetch;
  private readonly onSignedOut: (() => void) | undefined;
  private workspaceId: string | null;
  private refreshing: Promise<AuthTokens | null> | null = null;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.tokens = options.tokens ?? inMemoryTokenStore();
    this.doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.workspaceId = options.workspaceId ?? null;
    this.onSignedOut = options.onSignedOut;
  }

  setWorkspace(workspaceId: string | null): void {
    this.workspaceId = workspaceId;
  }

  getWorkspace(): string | null {
    return this.workspaceId;
  }

  currentTokens(): AuthTokens | null {
    return this.tokens.read();
  }

  isAuthenticated(): boolean {
    return this.tokens.read() !== null;
  }

  // --- Auth -----------------------------------------------------------------

  async register(input: {
    email: string;
    /** At least 12 characters — the API's policy, enforced server-side too. */
    password: string;
    fullName?: string;
    username?: string;
  }): Promise<AuthResult> {
    const result = await this.request<AuthResult>("POST", "/auth/register", {
      body: input,
      anonymous: true,
    });
    this.tokens.write(result.tokens);
    return result;
  }

  async login(input: { email: string; password: string }): Promise<AuthResult> {
    const result = await this.request<AuthResult>("POST", "/auth/login", {
      body: input,
      anonymous: true,
    });
    this.tokens.write(result.tokens);
    return result;
  }

  async logout(): Promise<void> {
    try {
      await this.request<void>("POST", "/auth/logout");
    } finally {
      // Cleared even if the call failed: leaving a token the server may have
      // already revoked would keep the UI pretending to be signed in.
      this.tokens.write(null);
      this.workspaceId = null;
    }
  }

  async me(): Promise<PublicUser> {
    return this.request<PublicUser>("GET", "/users/me");
  }

  // --- Tenancy --------------------------------------------------------------

  async listOrganizations(): Promise<Organization[]> {
    return this.request<Organization[]>("GET", "/organizations");
  }

  async createOrganization(input: {
    name: string;
    slug: string;
  }): Promise<Organization> {
    return this.request<Organization>("POST", "/organizations", {
      body: input,
    });
  }

  async listWorkspaces(organizationId: string): Promise<Workspace[]> {
    return this.request<Workspace[]>(
      "GET",
      `/workspaces?organizationId=${encodeURIComponent(organizationId)}`,
    );
  }

  async createWorkspace(input: {
    organizationId: string;
    name: string;
    slug: string;
  }): Promise<Workspace> {
    return this.request<Workspace>("POST", "/workspaces", { body: input });
  }

  // --- Goals ----------------------------------------------------------------

  async createGoal(input: CreateGoalInput): Promise<Goal> {
    return this.request<Goal>("POST", "/goals", {
      body: input,
      workspaceScoped: true,
    });
  }

  async listGoals(): Promise<Goal[]> {
    return this.request<Goal[]>("GET", "/goals", { workspaceScoped: true });
  }

  async getGoal(goalId: string): Promise<Goal> {
    return this.request<Goal>("GET", `/goals/${goalId}`, {
      workspaceScoped: true,
    });
  }

  /** Accepted, not finished — the runtime plans and runs it asynchronously. */
  /**
   * Stop a Goal from running again.
   *
   * The row stays — an archived Goal keeps its history — but its schedule is
   * cleared, so a recurring Goal fires no more.
   */
  async archiveGoal(goalId: string): Promise<Goal> {
    return this.request<Goal>("DELETE", `/goals/${goalId}`, {
      workspaceScoped: true,
    });
  }

  async submitGoal(goalId: string): Promise<Execution> {
    return this.request<Execution>("POST", `/goals/${goalId}/executions`, {
      workspaceScoped: true,
    });
  }

  // --- Executions -----------------------------------------------------------

  async listExecutions(): Promise<Execution[]> {
    return this.request<Execution[]>("GET", "/executions", {
      workspaceScoped: true,
    });
  }

  async getExecution(executionId: string): Promise<Execution> {
    return this.request<Execution>("GET", `/executions/${executionId}`, {
      workspaceScoped: true,
    });
  }

  async listTasks(executionId: string): Promise<Task[]> {
    return this.request<Task[]>("GET", `/executions/${executionId}/tasks`, {
      workspaceScoped: true,
    });
  }

  async getUsage(executionId: string): Promise<ExecutionUsage> {
    return this.request<ExecutionUsage>(
      "GET",
      `/executions/${executionId}/usage`,
      { workspaceScoped: true },
    );
  }

  /**
   * Approve or reject a run parked waiting for a person.
   *
   * Rejecting cancels the run, not just the step: "do not publish this" has to
   * mean the steps after it do not happen either.
   */
  async decideApproval(
    executionId: string,
    decision: "APPROVED" | "REJECTED",
    note?: string,
  ): Promise<Execution> {
    return this.request<Execution>(
      "POST",
      `/executions/${executionId}/approval`,
      {
        body: { decision, ...(note === undefined ? {} : { note }) },
        workspaceScoped: true,
      },
    );
  }

  async cancelExecution(executionId: string): Promise<Execution> {
    return this.request<Execution>(
      "POST",
      `/executions/${executionId}/cancel`,
      { workspaceScoped: true },
    );
  }

  // --- Documents ------------------------------------------------------------

  /**
   * Upload a file for the workspace to search over.
   *
   * Takes a `File` rather than bytes so the browser supplies the name and the
   * type; both are checked server-side, since neither can be trusted.
   */
  async uploadDocument(file: File): Promise<UploadedDocument> {
    const form = new FormData();
    form.append("file", file);

    return this.request<UploadedDocument>("POST", "/documents", {
      rawBody: form,
      workspaceScoped: true,
    });
  }

  async listDocuments(): Promise<DocumentSummary[]> {
    return this.request<DocumentSummary[]>("GET", "/documents", {
      workspaceScoped: true,
    });
  }

  async getDocument(documentId: string): Promise<DocumentSummary> {
    return this.request<DocumentSummary>("GET", `/documents/${documentId}`, {
      workspaceScoped: true,
    });
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.request<void>("DELETE", `/documents/${documentId}`, {
      workspaceScoped: true,
    });
  }

  async documentDownloadUrl(documentId: string): Promise<string> {
    const result = await this.request<{ url: string }>(
      "GET",
      `/documents/${documentId}/download-url`,
      { workspaceScoped: true },
    );
    return result.url;
  }

  // --- Workspace memory -----------------------------------------------------

  async listMemory(): Promise<WorkspaceMemory[]> {
    return this.request<WorkspaceMemory[]>("GET", "/memory", {
      workspaceScoped: true,
    });
  }

  /** Idempotent: the key is the identity, so saying it twice replaces it. */
  async rememberFact(key: string, value: string): Promise<WorkspaceMemory> {
    return this.request<WorkspaceMemory>("PUT", "/memory", {
      body: { key, value },
      workspaceScoped: true,
    });
  }

  async forgetFact(id: string): Promise<void> {
    await this.request<void>("DELETE", `/memory/${id}`, {
      workspaceScoped: true,
    });
  }

  // --- Secrets --------------------------------------------------------------

  async listSecrets(): Promise<StoredSecret[]> {
    return this.request<StoredSecret[]>("GET", "/secrets", {
      workspaceScoped: true,
    });
  }

  /**
   * Which keys this workspace's AI requests actually run on.
   *
   * Worth asking after saving one: no route returns a value, so a key that was
   * stored but never picked up looks exactly like one that works.
   */
  async providerKeys(): Promise<ProviderKeyStatus> {
    return this.request<ProviderKeyStatus>("GET", "/secrets/providers", {
      workspaceScoped: true,
    });
  }

  /**
   * Store a credential. Saying the same name twice writes a new version and
   * points the secret at it, rather than overwriting — so a bad rotation is a
   * rollback, not an outage.
   */
  async putSecret(input: {
    name: string;
    value: string;
    description?: string;
  }): Promise<StoredSecret> {
    return this.request<StoredSecret>("PUT", "/secrets", {
      body: input,
      workspaceScoped: true,
    });
  }

  async rollbackSecret(id: string, version: number): Promise<StoredSecret> {
    return this.request<StoredSecret>("POST", `/secrets/${id}/rollback`, {
      body: { version },
      workspaceScoped: true,
    });
  }

  async deleteSecret(id: string): Promise<void> {
    await this.request<void>("DELETE", `/secrets/${id}`, {
      workspaceScoped: true,
    });
  }

  /**
   * What this workspace has spent on AI, and on which models.
   *
   * The ledger has been written since Phase 2 and had no way out until now — a
   * record nobody can read is a record nobody trusts.
   */
  async spend(days = 30): Promise<SpendReport> {
    return this.request<SpendReport>("GET", `/usage?days=${days}`, {
      workspaceScoped: true,
    });
  }

  // --- Trend discovery ------------------------------------------------------

  /**
   * What people are searching for, or watching.
   *
   * `google` needs nothing. `youtube` needs a key — the workspace's own under
   * the name `sources/youtube`, or the operator's `YOUTUBE_API_KEY` — and says
   * which is missing when there is none.
   */
  async listTrends(
    filter: {
      source?: TrendSourceName;
      geo?: string;
      limit?: number;
    } = {},
  ): Promise<TrendItem[]> {
    const query = new URLSearchParams(
      Object.entries(filter)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    ).toString();

    return this.request<TrendItem[]>(
      "GET",
      `/trends${query ? `?${query}` : ""}`,
      { workspaceScoped: true },
    );
  }

  // --- Campaigns and the calendar -------------------------------------------

  async listCampaigns(): Promise<Campaign[]> {
    return this.request<Campaign[]>("GET", "/campaigns", {
      workspaceScoped: true,
    });
  }

  async createCampaign(input: {
    name: string;
    objective?: string;
    startsAt?: string;
    endsAt?: string;
  }): Promise<Campaign> {
    return this.request<Campaign>("POST", "/campaigns", {
      body: input,
      workspaceScoped: true,
    });
  }

  async updateCampaign(
    id: string,
    input: {
      name?: string;
      objective?: string | null;
      status?: CampaignStatus;
      startsAt?: string | null;
      endsAt?: string | null;
    },
  ): Promise<Campaign> {
    return this.request<Campaign>("PATCH", `/campaigns/${id}`, {
      body: input,
      workspaceScoped: true,
    });
  }

  async archiveCampaign(id: string): Promise<void> {
    await this.request<void>("DELETE", `/campaigns/${id}`, {
      workspaceScoped: true,
    });
  }

  /**
   * The calendar.
   *
   * `from`/`to` are instants. Without them everything comes back, scheduled
   * first and undated last.
   */
  async listContentPieces(
    filter: {
      campaignId?: string;
      from?: string;
      to?: string;
    } = {},
  ): Promise<ContentPiece[]> {
    const query = new URLSearchParams(
      Object.entries(filter).filter(([, value]) => value !== undefined) as [
        string,
        string,
      ][],
    ).toString();

    return this.request<ContentPiece[]>(
      "GET",
      `/content-pieces${query ? `?${query}` : ""}`,
      { workspaceScoped: true },
    );
  }

  async createContentPiece(input: {
    campaignId?: string;
    socialAccountId?: string;
    title: string;
    body: string;
    hashtags?: string[];
    channel: string;
    scheduledAt?: string;
  }): Promise<ContentPiece> {
    return this.request<ContentPiece>("POST", "/content-pieces", {
      body: input,
      workspaceScoped: true,
    });
  }

  async updateContentPiece(
    id: string,
    input: {
      campaignId?: string | null;
      socialAccountId?: string | null;
      title?: string;
      body?: string;
      hashtags?: string[];
      channel?: string;
      scheduledAt?: string | null;
      status?: ContentPieceStatus;
    },
  ): Promise<ContentPiece> {
    return this.request<ContentPiece>("PATCH", `/content-pieces/${id}`, {
      body: input,
      workspaceScoped: true,
    });
  }

  async archiveContentPiece(id: string): Promise<void> {
    await this.request<void>("DELETE", `/content-pieces/${id}`, {
      workspaceScoped: true,
    });
  }

  // --- Content studio -------------------------------------------------------

  /**
   * Write a draft.
   *
   * The workspace's remembered brand voice is applied server-side — the caller
   * does not pass it, so a screen cannot forget to.
   */
  async writeContent(input: {
    brief: string;
    channel: ContentChannel;
    tone: ContentTone;
    length: ContentLength;
    language?: string;
  }): Promise<WrittenContent> {
    return this.request<WrittenContent>("POST", "/content/write", {
      body: input,
      workspaceScoped: true,
    });
  }

  /** Change how something is said. Never what it says — see `notes`. */
  async rewriteContent(input: {
    original: string;
    instruction: string;
    language?: string;
  }): Promise<RevisedContent> {
    return this.request<RevisedContent>("POST", "/content/rewrite", {
      body: input,
      workspaceScoped: true,
    });
  }

  async translateContent(input: {
    original: string;
    targetLanguage: string;
  }): Promise<RevisedContent> {
    return this.request<RevisedContent>("POST", "/content/translate", {
      body: input,
      workspaceScoped: true,
    });
  }

  async suggestSeo(input: { content: string }): Promise<SeoContent> {
    return this.request<SeoContent>("POST", "/content/seo", {
      body: input,
      workspaceScoped: true,
    });
  }

  // --- Social connections ---------------------------------------------------

  async listConnections(): Promise<SocialConnection[]> {
    return this.request<SocialConnection[]>("GET", "/connections", {
      workspaceScoped: true,
    });
  }

  /** The platforms on offer, and which of them can actually be connected. */
  async connectorCatalog(): Promise<ConnectorSummary[]> {
    return this.request<ConnectorSummary[]>("GET", "/connections/catalog", {
      workspaceScoped: true,
    });
  }

  /**
   * Begin connecting a platform.
   *
   * Returns the URL to send the person to. The browser has to go there itself —
   * the platform's consent screen is the whole point, and nothing about it can
   * be done on their behalf.
   */
  async startConnection(connectorId: string): Promise<{ url: string }> {
    return this.request<{ url: string }>(
      "POST",
      `/connections/${connectorId}/start`,
      { workspaceScoped: true },
    );
  }

  /**
   * Attach a Page with a token you already hold.
   *
   * Beside `startConnection`, not instead of it. OAuth is what a tenant should
   * use — they never hand a credential over. This exists because getting an app
   * approved takes weeks, and someone with a Page token should not be blocked
   * from using their own Page until then.
   */
  /**
   * Every Page a user access token can manage.
   *
   * A POST though it reads: the token travels in the body, because a query
   * string carrying a live credential ends up in access logs and history.
   */
  async listManageablePages(
    connectorId: string,
    userAccessToken: string,
  ): Promise<ManageablePage[]> {
    return this.request<ManageablePage[]>(
      "POST",
      `/connections/${connectorId}/pages`,
      { body: { userAccessToken }, workspaceScoped: true },
    );
  }

  /** Connect the chosen Pages; each that could not be is named. */
  async attachPages(
    connectorId: string,
    input: { userAccessToken: string; externalIds: string[] },
  ): Promise<{
    connected: SocialConnection[];
    failed: { externalId: string; reason: string }[];
  }> {
    return this.request("POST", `/connections/${connectorId}/pages/attach`, {
      body: input,
      workspaceScoped: true,
    });
  }

  async attachConnection(
    connectorId: string,
    input: { externalId: string; accessToken: string },
  ): Promise<SocialConnection> {
    return this.request<SocialConnection>(
      "POST",
      `/connections/${connectorId}/token`,
      { body: input, workspaceScoped: true },
    );
  }

  /**
   * Messages waiting on the workspace's channels.
   *
   * Read from the platform on every call rather than from a cache: a copy would
   * be wrong the moment somebody replies from the Facebook app, and a customer
   * waiting for an answer is the last thing that should be stale.
   */
  async inbox(): Promise<Inbox> {
    return this.request<Inbox>("GET", "/connections/inbox", {
      workspaceScoped: true,
    });
  }

  /** How recent posts have done on each connected channel. */
  async postStats(): Promise<PostStatsReport> {
    return this.request<PostStatsReport>("GET", "/connections/stats", {
      workspaceScoped: true,
    });
  }

  /** Disconnect. The stored credential goes with it. */
  async disconnect(id: string): Promise<void> {
    await this.request<void>("DELETE", `/connections/${id}`, {
      workspaceScoped: true,
    });
  }

  // --- Chat -----------------------------------------------------------------

  async createConversation(title?: string): Promise<Conversation> {
    return this.request<Conversation>("POST", "/chat/conversations", {
      body: title === undefined ? {} : { title },
      workspaceScoped: true,
    });
  }

  async listConversations(): Promise<Conversation[]> {
    return this.request<Conversation[]>("GET", "/chat/conversations", {
      workspaceScoped: true,
    });
  }

  async listChatMessages(conversationId: string): Promise<ChatMessage[]> {
    return this.request<ChatMessage[]>(
      "GET",
      `/chat/conversations/${conversationId}/messages`,
      { workspaceScoped: true },
    );
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/chat/conversations/${conversationId}`,
      { workspaceScoped: true },
    );
  }

  /**
   * Send a turn and yield the answer as it arrives.
   *
   * `fetch` rather than `EventSource`, which cannot send a POST body, cannot
   * set the Authorization or workspace headers, and cannot be aborted. What is
   * lost is EventSource's automatic reconnection — deliberately: reconnecting
   * mid-answer would replay the request and charge for a second answer, which
   * is the same reason the Gateway refuses to fall back mid-stream.
   */
  async *streamMessage(
    conversationId: string,
    content: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent, void, undefined> {
    const headers: Record<string, string> = {
      accept: "text/event-stream",
      "content-type": "application/json",
    };
    const token = this.tokens.read()?.accessToken;
    if (token) headers.authorization = `Bearer ${token}`;
    if (this.workspaceId) headers[WORKSPACE_HEADER] = this.workspaceId;

    const response = await this.doFetch(
      `${this.baseUrl}/chat/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ content }),
        ...(signal ? { signal } : {}),
      },
    );

    if (!response.ok || !response.body) {
      // Before the first byte the server can still answer normally, so an
      // error here is a status code and is surfaced as one.
      throw new ApiError(response.status, await this.readErrorBody(response));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // A network read is not an event. One read can carry half an event, or
        // three and a half — so everything up to the last blank line is
        // complete and the remainder stays buffered. Parsing per read instead
        // drops whatever straddles the boundary, which shows up as text going
        // missing from the middle of long answers.
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const event = parseSseBlock(block);
          if (event) yield event;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // --- Transport ------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      /**
       * Sent as-is, with no content-type header of our own.
       *
       * For multipart: the boundary is part of the content type and only the
       * runtime knows it, so setting `multipart/form-data` by hand produces a
       * header the server cannot parse the body against.
       */
      rawBody?: BodyInit;
      anonymous?: boolean;
      workspaceScoped?: boolean;
    } = {},
  ): Promise<T> {
    const wire = {
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(options.rawBody === undefined ? {} : { rawBody: options.rawBody }),
      ...(options.anonymous === undefined
        ? {}
        : { anonymous: options.anonymous }),
      ...(options.workspaceScoped === undefined
        ? {}
        : { workspaceScoped: options.workspaceScoped }),
    };

    const response = await this.send(method, path, wire);

    if (response.status === 401 && !options.anonymous) {
      const refreshed = await this.refresh();
      if (refreshed) {
        // Exactly one retry, and it is structural rather than a flag: the
        // replay calls `send` directly, so there is no path back into this
        // method and no way to loop. A second 401 on a freshly minted token is
        // a real authorisation failure and is surfaced as one.
        return this.unwrap<T>(await this.send(method, path, wire));
      }
    }

    return this.unwrap<T>(response);
  }

  private async send(
    method: string,
    path: string,
    options: {
      body?: unknown;
      rawBody?: BodyInit;
      anonymous?: boolean;
      workspaceScoped?: boolean;
    },
  ): Promise<Response> {
    const headers: Record<string, string> = { accept: "application/json" };

    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (!options.anonymous) {
      const token = this.tokens.read()?.accessToken;
      if (token) headers.authorization = `Bearer ${token}`;
    }
    if (options.workspaceScoped && this.workspaceId) {
      headers[WORKSPACE_HEADER] = this.workspaceId;
    }

    return this.doFetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(options.rawBody === undefined
        ? options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }
        : { body: options.rawBody }),
    });
  }

  /**
   * Refresh, at most one in flight.
   *
   * Refresh tokens are one-time-use with rotation, and the API treats a reused
   * one as theft and kills the whole session. Two concurrent refreshes would
   * therefore not merely waste a call — they would log the user out.
   */
  private async refresh(): Promise<AuthTokens | null> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<AuthTokens | null> {
    const refreshToken = this.tokens.read()?.refreshToken;
    if (!refreshToken) return null;

    const response = await this.send("POST", "/auth/refresh", {
      body: { refreshToken },
      anonymous: true,
    });

    if (!response.ok) {
      this.tokens.write(null);
      this.onSignedOut?.();
      return null;
    }

    const tokens = (await this.readEnvelope<AuthTokens>(response)) ?? null;
    this.tokens.write(tokens);
    return tokens;
  }

  private async unwrap<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T;

    if (!response.ok) {
      throw new ApiError(response.status, await this.readErrorBody(response));
    }

    const data = await this.readEnvelope<T>(response);
    if (data === undefined) {
      throw new ApiError(response.status, {
        code: "MALFORMED_RESPONSE",
        message: "The API returned a body this client could not read.",
        requestId: "unknown",
        timestamp: new Date().toISOString(),
      });
    }
    return data;
  }

  private async readEnvelope<T>(response: Response): Promise<T | undefined> {
    try {
      const json = (await response.json()) as Envelope<T> | T;
      return json && typeof json === "object" && "data" in json
        ? (json as Envelope<T>).data
        : (json as T);
    } catch {
      return undefined;
    }
  }

  private async readErrorBody(response: Response): Promise<ApiErrorBody> {
    try {
      const body = (await response.json()) as Partial<ApiErrorBody>;
      return {
        code: body.code ?? `HTTP_${response.status}`,
        message: body.message ?? response.statusText,
        requestId: body.requestId ?? "unknown",
        timestamp: body.timestamp ?? new Date().toISOString(),
        ...(body.details ? { details: body.details } : {}),
      };
    } catch {
      // A gateway timeout or a proxy error page is not JSON. Losing the status
      // here would leave the UI with nothing to show.
      return {
        code: `HTTP_${response.status}`,
        message: response.statusText || "The request failed.",
        requestId: "unknown",
        timestamp: new Date().toISOString(),
      };
    }
  }
}

/**
 * One SSE block into an event.
 *
 * Returns null for anything unrecognised rather than throwing: a server that
 * adds an event type this client does not know must not break a conversation
 * that is otherwise working.
 */
function parseSseBlock(block: string): ChatStreamEvent | null {
  const name = /^event: (.*)$/m.exec(block)?.[1]?.trim();
  const raw = /^data: (.*)$/m.exec(block)?.[1];
  if (!name || raw === undefined) return null;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (name === "delta") {
    return {
      type: "delta",
      text: String((data as { text?: string }).text ?? ""),
    };
  }
  if (name === "tool") {
    return { type: "tool", run: data as ToolRun };
  }
  if (name === "sources") {
    const body = data as { citations?: Citation[] };
    return { type: "sources", citations: body.citations ?? [] };
  }
  if (name === "done") {
    return { type: "done", message: data as ChatMessage };
  }
  if (name === "error") {
    const body = data as { message?: string; partial?: ChatMessage | null };
    return {
      type: "error",
      message: body.message ?? "Lỗi không rõ.",
      partial: body.partial ?? null,
    };
  }
  return null;
}
