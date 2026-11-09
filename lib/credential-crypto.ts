import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
function key() { return createHash("sha256").update(process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.AUTH_SECRET || "development-only-credential-key").digest(); }
export function encryptCredential(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${data.toString("base64")}`;
}
export function decryptCredential(value: string) {
  const [iv, tag, data] = value.split("."); if (!iv || !tag || !data) throw Error("Invalid encrypted credential");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64")); decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
