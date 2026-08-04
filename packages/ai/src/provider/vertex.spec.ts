import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  VertexAuth,
  generateVertexImage,
  serviceAccountFromEnv,
  type ServiceAccount,
} from "./vertex";

/** A real key pair, so the signing path is exercised rather than stubbed. */
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const SA: ServiceAccount = {
  client_email: "bot@project.iam.gserviceaccount.com",
  private_key: privateKey,
  project_id: "project-1",
  token_uri: "https://oauth2.test/token",
};

type Seen = { urls: string[]; bodies: string[]; auth: (string | null)[] };

/**
 * A fake Google: the token endpoint, then whatever the image call should say.
 */
const google = (
  imageResponse: { status: number; body: unknown },
  seen: Seen = { urls: [], bodies: [], auth: [] },
  token = "tok-1",
): typeof fetch =>
  (async (url: string, init: RequestInit = {}) => {
    seen.urls.push(String(url));
    seen.bodies.push(String(init.body ?? ""));
    seen.auth.push(new Headers(init.headers).get("authorization"));

    if (String(url).includes("/token")) {
      return new Response(JSON.stringify({ access_token: token }), {
        status: 200,
      });
    }
    return new Response(
      typeof imageResponse.body === "string"
        ? imageResponse.body
        : JSON.stringify(imageResponse.body),
      { status: imageResponse.status },
    );
  }) as unknown as typeof fetch;

const PIXEL = Buffer.from("giả vờ là PNG").toString("base64");
const withImage = {
  status: 200,
  body: {
    candidates: [
      {
        content: {
          parts: [{ inlineData: { data: PIXEL, mimeType: "image/png" } }],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 1290 },
  },
};

describe("VertexAuth", () => {
  it("signs a JWT and exchanges it for a token", async () => {
    const seen: Seen = { urls: [], bodies: [], auth: [] };
    const token = await new VertexAuth({
      serviceAccount: SA,
      fetchImpl: google(withImage, seen),
    }).accessToken();

    expect(token).toBe("tok-1");
    expect(seen.urls[0]).toBe("https://oauth2.test/token");
    expect(seen.bodies[0]).toContain("jwt-bearer");
  });

  it("reuses the token instead of signing on every call", async () => {
    // Minting one is a signature plus a round trip. Paying that per image adds
    // latency to every post for nothing.
    const seen: Seen = { urls: [], bodies: [], auth: [] };
    const auth = new VertexAuth({
      serviceAccount: SA,
      fetchImpl: google(withImage, seen),
    });

    await auth.accessToken();
    await auth.accessToken();

    expect(seen.urls.filter((url) => url.includes("/token"))).toHaveLength(1);
  });

  it("mints a fresh one before the old is due to expire", async () => {
    // A token that dies between being checked and being used fails a request
    // that had nothing wrong with it.
    const seen: Seen = { urls: [], bodies: [], auth: [] };
    let now = 1_000_000;
    const auth = new VertexAuth({
      serviceAccount: SA,
      fetchImpl: google(withImage, seen),
      now: () => now,
    });

    await auth.accessToken();
    now += 3600_000 - 30_000; // 30 seconds left
    await auth.accessToken();

    expect(seen.urls.filter((url) => url.includes("/token"))).toHaveLength(2);
  });

  it("says what Google said when the exchange is refused", async () => {
    const refusing = (async () =>
      new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "khoá sai",
        }),
        { status: 400 },
      )) as unknown as typeof fetch;

    await expect(
      new VertexAuth({ serviceAccount: SA, fetchImpl: refusing }).accessToken(),
    ).rejects.toThrow(/khoá sai/);
  });
});

describe("generateVertexImage", () => {
  it("returns the bytes, decoded", async () => {
    const image = await generateVertexImage(
      { serviceAccount: SA, fetchImpl: google(withImage) },
      "một cái hộp",
    );

    expect(image.data.toString()).toBe("giả vờ là PNG");
    expect(image.mimeType).toBe("image/png");
  });

  it("reports what the call cost in tokens", async () => {
    // Every other AI call lands in the ledger, and an image is the most
    // expensive single one this platform makes.
    const image = await generateVertexImage(
      { serviceAccount: SA, fetchImpl: google(withImage) },
      "một cái hộp",
    );

    expect(image.usage).toEqual({
      inputTokens: 12,
      outputTokens: 1290,
      totalTokens: 1302,
    });
  });

  it("adds the parts up when Vertex leaves out the total", async () => {
    // A zero total beside non-zero parts reads as a bug in the ledger rather
    // than a field the provider did not send.
    const image = await generateVertexImage(
      { serviceAccount: SA, fetchImpl: google(withImage) },
      "một cái hộp",
    );

    expect(image.usage.totalTokens).toBe(
      image.usage.inputTokens + image.usage.outputTokens,
    );
  });

  it("calls the region's aiplatform host, not the Gemini API", async () => {
    // A service account sent to generativelanguage.googleapis.com answers
    // "insufficient authentication scopes", which reads like a permissions
    // problem and is actually the wrong door.
    const seen: Seen = { urls: [], bodies: [], auth: [] };
    await generateVertexImage(
      { serviceAccount: SA, fetchImpl: google(withImage, seen) },
      "một cái hộp",
    );

    const call = seen.urls[1]!;
    expect(call).toContain("us-central1-aiplatform.googleapis.com");
    expect(call).toContain("/projects/project-1/locations/us-central1");
    expect(call).not.toContain("generativelanguage");
  });

  it("carries the token as a bearer, not in the query string", async () => {
    const seen: Seen = { urls: [], bodies: [], auth: [] };
    await generateVertexImage(
      { serviceAccount: SA, fetchImpl: google(withImage, seen) },
      "một cái hộp",
    );

    expect(seen.auth[1]).toBe("Bearer tok-1");
    expect(seen.urls[1]).not.toContain("tok-1");
  });

  it("asks for an image, not only for words about one", async () => {
    // Without responseModalities the model may answer with a description of
    // the picture it would have drawn — a 200 containing no image.
    const seen: Seen = { urls: [], bodies: [], auth: [] };
    await generateVertexImage(
      { serviceAccount: SA, fetchImpl: google(withImage, seen) },
      "một cái hộp",
    );

    expect(seen.bodies[1]).toContain('"responseModalities":["TEXT","IMAGE"]');
  });

  it("takes the region it was given", async () => {
    const seen: Seen = { urls: [], bodies: [], auth: [] };
    await generateVertexImage(
      {
        serviceAccount: SA,
        location: "asia-southeast1",
        fetchImpl: google(withImage, seen),
      },
      "một cái hộp",
    );

    expect(seen.urls[1]).toContain("asia-southeast1-aiplatform");
  });

  it("says the model refused, rather than reporting an empty image", async () => {
    // A refusal is a 200 with words instead of a picture. Calling that an
    // empty image sends the reader looking for a decoding bug.
    await expect(
      generateVertexImage(
        {
          serviceAccount: SA,
          fetchImpl: google({
            status: 200,
            body: {
              candidates: [
                {
                  content: {
                    parts: [{ text: "Tôi không vẽ được nội dung này." }],
                  },
                  finishReason: "SAFETY",
                },
              ],
            },
          }),
        },
        "gì đó",
      ),
    ).rejects.toThrow(/không vẽ được nội dung này/);
  });

  it("passes on what Vertex said when it refuses the call", async () => {
    await expect(
      generateVertexImage(
        {
          serviceAccount: SA,
          fetchImpl: google({
            status: 429,
            body: {
              error: {
                message: "Quota exceeded",
                status: "RESOURCE_EXHAUSTED",
              },
            },
          }),
        },
        "gì đó",
      ),
    ).rejects.toThrow(/Quota exceeded/);
  });
});

describe("serviceAccountFromEnv", () => {
  it("returns nothing when image generation was never set up", () => {
    expect(serviceAccountFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("takes the JSON inline", () => {
    const sa = serviceAccountFromEnv({
      GOOGLE_SERVICE_ACCOUNT: JSON.stringify(SA),
    } as NodeJS.ProcessEnv);

    expect(sa?.project_id).toBe("project-1");
  });

  it("takes a path to the file Google hands you", () => {
    const read = vi.fn(() => JSON.stringify(SA));
    const sa = serviceAccountFromEnv(
      { GOOGLE_SERVICE_ACCOUNT: "/run/secrets/sa.json" } as NodeJS.ProcessEnv,
      read,
    );

    expect(read).toHaveBeenCalledWith("/run/secrets/sa.json");
    expect(sa?.client_email).toBe(SA.client_email);
  });

  it("refuses a file that is missing what it needs", () => {
    // Better here than at the first image, where the message would be about a
    // signature failing rather than about a field nobody filled in.
    expect(() =>
      serviceAccountFromEnv({
        GOOGLE_SERVICE_ACCOUNT: JSON.stringify({ project_id: "p" }),
      } as NodeJS.ProcessEnv),
    ).toThrow(/client_email/);
  });
});
