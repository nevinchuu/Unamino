import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { CipherError, TravellerCipher } from "@/domain/travellers/ports";
import { err, ok, type Result } from "@/lib/result";

const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM. Every value gets its own random IV, and the context is authenticated, so a moved value fails to open. */
export class AesGcmCipher implements TravellerCipher {
  private constructor(private readonly key: Buffer) {}

  /** `base64Key` must decode to exactly 32 bytes. The message names the problem, never the key. */
  static fromBase64Key(base64Key: string): Result<AesGcmCipher, string> {
    const key = Buffer.from(base64Key.trim(), "base64");
    if (key.length !== KEY_BYTES) return err(`The encryption key must be ${KEY_BYTES} bytes in base64`);
    return ok(new AesGcmCipher(key));
  }

  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
  }

  decrypt(token: string, context: string): Result<string, CipherError> {
    const tampered = err({ code: "tampered" } as const satisfies CipherError);
    const [version, ivText, tagText, bodyText, ...extra] = token.split(".");
    if (version !== VERSION || !ivText || !tagText || bodyText === undefined || extra.length > 0) return tampered;

    const iv = Buffer.from(ivText, "base64");
    const tag = Buffer.from(tagText, "base64");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return tampered;

    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(tag);
      return ok(Buffer.concat([decipher.update(Buffer.from(bodyText, "base64")), decipher.final()]).toString("utf8"));
    } catch {
      return tampered;
    }
  }
}
