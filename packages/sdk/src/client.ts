import { ApiError } from "./error";
import type {
  ApiErrorBody,
  AuthResult,
  AuthTokens,
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
