import { randomBytes, createHash } from "crypto";

/** URL-safe, non-guessable token (default 256 bits of entropy). */
export function secureToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Hash a token for at-rest storage (password-reset tokens). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Generate a readable temporary password: 3 groups like "Kx7-mQ2-pZ9". */
export function tempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const group = () =>
    Array.from(randomBytes(3))
      .map((b) => alphabet[b % alphabet.length])
      .join("");
  return `${group()}-${group()}-${group()}`;
}
