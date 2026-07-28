import { randomBytes } from "node:crypto";
import { RuntimeError } from "@repo/runtime";
import { describe, expect, it } from "vitest";
import { Keyring, maskSecret, secretsMatch } from "./cipher";

const key = (id: string) => ({ id, key: randomBytes(32) });
const ring = () => {
  const v1 = key("v1");
  return { v1, keyring: new Keyring("v1", [v1]) };
};

describe("Keyring", () => {
  it("returns what was sealed", () => {
    const { keyring } = ring();
    const secret = "sk-ant-api03-rất-bí-mật";

    expect(keyring.open(keyring.seal(secret))).toBe(secret);
  });

  it("never produces the same ciphertext twice", () => {
    // A fresh IV every time. Reusing one under the same key breaks GCM
    // completely rather than gradually, and the two ciphertexts leak their XOR.
    const { keyring } = ring();

    const first = keyring.seal("cùng một giá trị");
    const second = keyring.seal("cùng một giá trị");

    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
    expect(keyring.open(first)).toBe(keyring.open(second));
  });

  it("refuses a ciphertext that was altered", () => {
    // The reason for GCM over CBC: an altered value fails rather than
    // decrypting to something else, which the caller would send to a vendor.
    const { keyring } = ring();
    const sealed = keyring.seal("sk-test");
    const bytes = Buffer.from(sealed.ciphertext, "base64");
    bytes[0] = bytes[0]! ^ 0xff;

    expect(() =>
      keyring.open({ ...sealed, ciphertext: bytes.toString("base64") }),
    ).toThrow(/authentication/i);
  });

  it("refuses a value whose tag was altered", () => {
    const { keyring } = ring();
    const sealed = keyring.seal("sk-test");
    const tag = Buffer.from(sealed.tag, "base64");
    tag[0] = tag[0]! ^ 0xff;

    expect(() =>
      keyring.open({ ...sealed, tag: tag.toString("base64") }),
    ).toThrow(RuntimeError);
  });

  it("refuses a value sealed under a key it does not hold", () => {
    const { keyring } = ring();
    const other = new Keyring("v9", [key("v9")]);
    const sealed = other.seal("sk-test");

    expect(() => keyring.open(sealed)).toThrow(/No key v9/);
  });

  it("still opens values sealed by a retired key", () => {
    // Rotation means writing with a new key while old values stay readable.
    // A keyring holding one key would make rotation an outage.
    const v1 = key("v1");
    const v2 = key("v2");
    const old = new Keyring("v1", [v1]);
    const sealed = old.seal("bí mật cũ");

    const rotated = new Keyring("v2", [v1, v2]);

    expect(rotated.open(sealed)).toBe("bí mật cũ");
    expect(rotated.seal("mới").keyId).toBe("v2");
  });

  it("says which values are due for re-sealing", () => {
    const v1 = key("v1");
    const v2 = key("v2");
    const sealedOld = new Keyring("v1", [v1]).seal("cũ");
    const rotated = new Keyring("v2", [v1, v2]);

    expect(rotated.needsRotation(sealedOld)).toBe(true);
    expect(rotated.needsRotation(rotated.seal("mới"))).toBe(false);
  });

  it("refuses a key of the wrong length rather than padding it", () => {
    // A short key silently padded is a vault with far less strength than its
    // configuration claims.
    expect(() => new Keyring("v1", [{ id: "v1", key: randomBytes(16) }])).toThrow(
      /16 bytes/,
    );
  });

  it("refuses a primary key that is not in the ring", () => {
    expect(() => new Keyring("v2", [key("v1")])).toThrow(/primary key v2/);
  });

  it("refuses a malformed sealed value", () => {
    const { keyring } = ring();
    const sealed = keyring.seal("x");

    expect(() => keyring.open({ ...sealed, iv: "AAAA" })).toThrow(/Malformed/);
  });

  it("round-trips a value with characters outside ASCII", () => {
    const { keyring } = ring();
    const secret = "khoá bí mật — có dấu, emoji 🔐 và ký tự lạ";

    expect(keyring.open(keyring.seal(secret))).toBe(secret);
  });

  it("round-trips an empty value", () => {
    const { keyring } = ring();

    expect(keyring.open(keyring.seal(""))).toBe("");
  });
});

describe("Keyring.fromEnv", () => {
  it("returns null when nothing is configured", () => {
    // Rather than generating a key: a vault that invents one at startup
    // encrypts everything with a key that disappears on restart, and the
    // failure only surfaces the next time something is read.
    expect(Keyring.fromEnv({})).toBeNull();
    expect(Keyring.fromEnv({ SECRET_KEYS: "v1:AAAA" })).toBeNull();
  });

  it("reads a ring of several keys", () => {
    const keyring = Keyring.fromEnv({
      SECRET_KEYS: `v1:${Keyring.generateKey()},v2:${Keyring.generateKey()}`,
      SECRET_PRIMARY_KEY: "v2",
    });

    const sealed = keyring!.seal("bí mật");
    expect(sealed.keyId).toBe("v2");
    expect(keyring!.open(sealed)).toBe("bí mật");
  });

  it("says so when an entry is malformed", () => {
    expect(() =>
      Keyring.fromEnv({ SECRET_KEYS: "khong-co-dau-hai-cham", SECRET_PRIMARY_KEY: "v1" }),
    ).toThrow(/id:base64key/);
  });

  it("generates a key of the right length", () => {
    expect(Buffer.from(Keyring.generateKey(), "base64")).toHaveLength(32);
  });
});

describe("secretsMatch", () => {
  it("compares equal and unequal values", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abd")).toBe(false);
  });

  it("handles different lengths without throwing", () => {
    // timingSafeEqual throws on a length mismatch, so length is checked first.
    expect(secretsMatch("abc", "abcd")).toBe(false);
    expect(secretsMatch("", "abc")).toBe(false);
  });
});

describe("maskSecret", () => {
  it("shows just enough to tell two keys apart", () => {
    expect(maskSecret("sk-ant-api03-abcdefgh")).toBe("••••••••efgh");
  });

  it("hides a short value entirely rather than partly", () => {
    expect(maskSecret("short")).toBe("••••••••");
    expect(maskSecret("")).toBe("••••••••");
  });
});
