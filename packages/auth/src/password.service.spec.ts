import { describe, expect, it } from "vitest";
import { PasswordService } from "./password.service";

// Cheap parameters keep the suite fast; production defaults are asserted separately.
const service = new PasswordService({
  memoryCost: 8192,
  timeCost: 2,
  parallelism: 1,
});

describe("PasswordService", () => {
  it("produces an argon2id hash, never the plaintext", async () => {
    const hash = await service.hash("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("correct horse battery staple");
  });

  it("salts each hash so identical passwords differ", async () => {
    const [a, b] = await Promise.all([
      service.hash("same-password"),
      service.hash("same-password"),
    ]);
    expect(a).not.toBe(b);
  });

  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await service.hash("s3cret-p@ss");
    await expect(service.verify(hash, "s3cret-p@ss")).resolves.toBe(true);
    await expect(service.verify(hash, "s3cret-p@sS")).resolves.toBe(false);
    await expect(service.verify(hash, "")).resolves.toBe(false);
  });

  it("returns false rather than throwing on a malformed hash", async () => {
    await expect(service.verify("not-a-hash", "anything")).resolves.toBe(false);
    await expect(service.verify("", "anything")).resolves.toBe(false);
  });

  it("flags a hash made with weaker parameters for rehashing", async () => {
    const weak = new PasswordService({
      memoryCost: 8192,
      timeCost: 2,
      parallelism: 1,
    });
    const strong = new PasswordService({
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    const weakHash = await weak.hash("password");
    expect(strong.needsRehash(weakHash)).toBe(true);
    expect(weak.needsRehash(weakHash)).toBe(false);
  });

  it("treats an unparseable hash as needing a rehash", () => {
    expect(service.needsRehash("garbage")).toBe(true);
  });

  it("handles unicode and long passwords", async () => {
    const password = "mật-khẩu-🔐-" + "x".repeat(200);
    const hash = await service.hash(password);
    await expect(service.verify(hash, password)).resolves.toBe(true);
  });
});
