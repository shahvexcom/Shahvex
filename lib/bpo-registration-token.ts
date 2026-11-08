import { createHash } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";

const secretText = process.env.AUTH_SECRET ?? "development-only-change-me-before-production";
const secret = createHash("sha256").update(secretText).digest();

export type PendingBpoRegistration = {
  name: string;
  username: string;
  email: string;
  phone: string;
  passwordHash: string;
  challengeId: string;
};

export async function createBpoRegistrationToken(data: PendingBpoRegistration) {
  return new EncryptJWT(data)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .encrypt(secret);
}

export async function readBpoRegistrationToken(token: string) {
  try {
    const { payload } = await jwtDecrypt(token, secret);
    return payload as unknown as PendingBpoRegistration;
  } catch {
    return null;
  }
}
