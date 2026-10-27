import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AesGcmCipher } from "./aes-gcm-cipher";

const newKey = () => randomBytes(32).toString("base64");

function cipher(key = newKey()): AesGcmCipher {
  const made = AesGcmCipher.fromBase64Key(key);
  if (!made.ok) throw new Error(made.error);
  return made.value;
}

describe("AesGcmCipher", () => {
  it("opens what it locked, including accents and long text", () => {
    const c = cipher();
    const text = JSON.stringify({ name: "José Núñez-O'Brien", note: "x".repeat(5_000) });
    const opened = c.decrypt(c.encrypt(text, "member-1"), "member-1");
    expect(opened).toEqual({ ok: true, value: text });
  });

  it("locks the same text differently each time, so equal values cannot be spotted", () => {
    const c = cipher();
    expect(c.encrypt("same", "m")).not.toBe(c.encrypt("same", "m"));
  });

  it("does not show the text in what it stores", () => {
    expect(cipher().encrypt("K1234567A", "m")).not.toContain("K1234567A");
  });

  it("will not open a value moved to another member", () => {
    const c = cipher();
    expect(c.decrypt(c.encrypt("secret", "member-1"), "member-2")).toEqual({ ok: false, error: { code: "tampered" } });
  });

  it("will not open a value made with a different key", () => {
    const token = cipher().encrypt("secret", "m");
    expect(cipher().decrypt(token, "m")).toEqual({ ok: false, error: { code: "tampered" } });
  });

  it("will not open a value that was changed in any part", () => {
    const c = cipher();
    const [version, iv, tag, body] = c.encrypt("secret text", "m").split(".");
    const flip = (part: string) => (part[0] === "A" ? "B" : "A") + part.slice(1);
    for (const changed of [`${version}.${flip(iv)}.${tag}.${body}`, `${version}.${iv}.${flip(tag)}.${body}`, `${version}.${iv}.${tag}.${flip(body)}`]) {
      expect(c.decrypt(changed, "m").ok).toBe(false);
    }
  });

  it.each(["", "garbage", "v1.a.b", "v2.a.b.c", "v1.a.b.c.d"])("answers a malformed value (%j) with a refusal, not an exception", (token) => {
    expect(cipher().decrypt(token, "m")).toEqual({ ok: false, error: { code: "tampered" } });
  });

  it("refuses a key that is not 32 bytes, without repeating it", () => {
    for (const bad of ["", "short", randomBytes(16).toString("base64"), randomBytes(48).toString("base64")]) {
      const made = AesGcmCipher.fromBase64Key(bad);
      expect(made.ok).toBe(false);
      if (!made.ok && bad) expect(made.error).not.toContain(bad);
    }
  });

  it("accepts a key with stray whitespace from a copied line", () => {
    expect(AesGcmCipher.fromBase64Key(` ${newKey()}\n`).ok).toBe(true);
  });
});
