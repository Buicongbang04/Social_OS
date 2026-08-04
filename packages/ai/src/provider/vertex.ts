import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Talking to Vertex AI, which is not the same door as the Gemini API.
 *
 * Same models, two doors, and they take different keys:
 *
 * - `generativelanguage.googleapis.com` takes an AI Studio key as `?key=`.
 *   Free tier, and the image models have had a zero daily quota on it since
 *   December 2025.
 * - `{region}-aiplatform.googleapis.com` takes OAuth minted from a service
 *   account. No free tier — it bills — and the image models work.
 *
 * A service account sent to the first door answers "insufficient
 * authentication scopes", which reads like a permissions problem and is
 * actually the wrong door. Written down because it cost an hour to work out.
 */
export type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
};

export type VertexConfig = {
  serviceAccount: ServiceAccount;
  /**
   * Where the model runs.
   *
   * `us-central1` because that is where the image models are; a region without
   * them answers NOT_FOUND for the model rather than for the region, which
   * sends the reader looking for a typo in the model name.
   */
  location?: string;
  fetchImpl?: typeof fetch;
  /** For tests: pretend it is this moment. */
  now?: () => number;
};

const TOKEN_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_LOCATION = "us-central1";

/**
 * An access token, kept until shortly before it expires.
 *
 * Minting one is a signature plus a round trip, and an image call would
 * otherwise pay for it every time. The refresh happens a minute early: a token
 * that expires between being checked and being used fails a request that had
 * nothing wrong with it.
 */
export class VertexAuth {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: VertexConfig) {}

  private get now(): number {
    return this.config.now ? this.config.now() : Date.now();
  }

  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now + 60_000) {
      return this.token.value;
    }

    const sa = this.config.serviceAccount;
    const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
    const issued = Math.floor(this.now / 1000);

    const encode = (value: unknown): string =>
      Buffer.from(
        typeof value === "string" ? value : JSON.stringify(value),
      ).toString("base64url");

    const unsigned = [
      encode({ alg: "RS256", typ: "JWT" }),
      encode({
        iss: sa.client_email,
        scope: TOKEN_SCOPE,
        aud: tokenUri,
        exp: issued + 3600,
        iat: issued,
      }),
    ].join(".");

    const signature = createSign("RSA-SHA256")
      .update(unsigned)
      .sign(sa.private_key, "base64url");

    const call = this.config.fetchImpl ?? fetch;
    const response = await call(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`,
      }).toString(),
    });

    const payload = (await response.json()) as {
      access_token?: string;
      error_description?: string;
      error?: string;
    };

    if (!payload.access_token) {
      throw new Error(
        `Không đổi được khoá service account thành access token: ${
          payload.error_description ?? payload.error ?? "không rõ lý do"
        }`,
      );
    }

    this.token = {
      value: payload.access_token,
      // Google returns expires_in, but a fixed hour matches what it issues and
      // avoids trusting a field to decide when a credential dies.
      expiresAt: this.now + 3600_000,
    };
    return this.token.value;
  }
}

export type GeneratedImage = {
  /** The bytes. */
  data: Buffer;
  mimeType: string;
  /** What the model said alongside the picture, if anything. */
  note: string | null;
  /**
   * What it cost, in tokens.
   *
   * Carried because every other AI call in this platform lands in the ledger,
   * and an image is the most expensive single call it makes — roughly 1,290
   * output tokens each. One unmetered operation is how a bill stops matching
   * the spend view.
   */
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
};

/**
 * Draw a picture from a description.
 *
 * Returns bytes rather than writing them anywhere: where an image belongs is a
 * question about storage and workspaces, and this module knows about neither.
 */
export async function generateVertexImage(
  config: VertexConfig,
  prompt: string,
  options: { model?: string; auth?: VertexAuth } = {},
): Promise<GeneratedImage> {
  const location = config.location ?? DEFAULT_LOCATION;
  const model = options.model ?? "gemini-2.5-flash-image";
  const auth = options.auth ?? new VertexAuth(config);
  const call = config.fetchImpl ?? fetch;

  const token = await auth.accessToken();
  const url =
    `https://${location}-aiplatform.googleapis.com/v1/projects/` +
    `${config.serviceAccount.project_id}/locations/${location}` +
    `/publishers/google/models/${model}:generateContent`;

  const response = await call(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      // Asked for explicitly. Without it the model is free to answer with
      // words about the picture it would have drawn, which is a 200 that
      // contains no image.
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Vertex trả về ${response.status}: ${errorOf(text)}`);
  }

  const payload = JSON.parse(text) as {
    candidates?: {
      content?: {
        parts?: {
          text?: string;
          inlineData?: { data?: string; mimeType?: string };
        }[];
      };
      finishReason?: string;
    }[];
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };

  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const image = parts.find((part) => part.inlineData?.data);

  if (!image?.inlineData?.data) {
    // A refusal comes back as a 200 with words instead of a picture. Reporting
    // it as an empty image would leave the caller looking for a bug in the
    // decoding.
    const said = parts.find((part) => part.text)?.text;
    throw new Error(
      said
        ? `Model không vẽ ảnh mà trả lời bằng chữ: ${said.slice(0, 200)}`
        : `Model trả về 200 nhưng không có ảnh (finishReason: ${
            payload.candidates?.[0]?.finishReason ?? "không rõ"
          }).`,
    );
  }

  const used = payload.usageMetadata ?? {};
  const inputTokens = used.promptTokenCount ?? 0;
  const outputTokens = used.candidatesTokenCount ?? 0;

  return {
    data: Buffer.from(image.inlineData.data, "base64"),
    mimeType: image.inlineData.mimeType ?? "image/png",
    note: parts.find((part) => part.text)?.text?.trim() || null,
    usage: {
      inputTokens,
      outputTokens,
      // Summed rather than taken from totalTokenCount: Vertex has been seen to
      // omit it, and a zero total beside non-zero parts reads as a bug in the
      // ledger rather than a missing field.
      totalTokens: used.totalTokenCount ?? inputTokens + outputTokens,
    },
  };
}

function errorOf(body: string): string {
  try {
    const payload = JSON.parse(body) as {
      error?: { message?: string; status?: string };
    };
    const error = Array.isArray(payload) ? payload[0]?.error : payload.error;
    return error?.message ?? error?.status ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

/**
 * Read the service account out of the environment.
 *
 * Takes the JSON itself or a path to it. The file is what Google hands you and
 * what a Docker secret mounts; the inline form is what fits in an env var when
 * there is nowhere to put a file.
 *
 * Null when nothing is configured — a deployment without image generation runs
 * as it did before.
 */
export function serviceAccountFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  readFile?: (path: string) => string,
): ServiceAccount | null {
  const raw = env.GOOGLE_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;

  const text = raw.startsWith("{") ? raw : (readFile ?? defaultRead)(raw);

  const parsed = JSON.parse(text) as ServiceAccount;
  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT thiếu client_email, private_key hoặc project_id.",
    );
  }
  return parsed;
}

function defaultRead(path: string): string {
  return readFileSync(path, "utf8");
}
