import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ImageTransform } from "@comicspace/plugin-sdk";

export interface ImageTicketPayload {
  /** Remote image URL. */
  u: string;
  /** Optional Referer. */
  r?: string;
  /** Optional request headers (cookies, UA, ...). Encrypted, never sent to the browser. */
  h?: Record<string, string>;
  /** Source id, for logging/policy. */
  p: string;
  /** Page images can be cached longer than covers. */
  k: "page" | "cover";
  /** Optional server-side image operation. */
  t?: ImageTransform;
  /** Expiry, epoch ms. */
  e: number;
}

export type ImageTicketInput = Omit<ImageTicketPayload, "e">;

const AAD = Buffer.from("comicspace.image.v1");
const MAX_TICKET_PAYLOAD = 4096;

export class TicketError extends Error {
  readonly code: "invalid" | "expired" | "too_large";

  constructor(code: "invalid" | "expired" | "too_large", message: string) {
    super(message);
    this.name = "TicketError";
    this.code = code;
  }
}

export function loadOrCreateSecret(dataDir: string): Buffer {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, ".image-secret");
  try {
    const existing = fs.readFileSync(file);
    if (existing.length === 32) return existing;
  } catch {
    // Create below.
  }

  const secret = randomBytes(32);
  try {
    fs.writeFileSync(file, secret, { mode: 0o600, flag: "wx" });
    return secret;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      const existing = fs.readFileSync(file);
      if (existing.length === 32) return existing;
      throw new Error("Invalid image secret file: expected 32 bytes", {
        cause: error,
      });
    }
    throw error;
  }
}

function keyFromSecret(secret: Buffer): Buffer {
  return createHash("sha256").update(secret).digest();
}

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function sealTicket(
  input: ImageTicketInput,
  options: {
    secret: Buffer;
    ttlMs?: number;
    now?: number;
  },
): string {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? 12 * 60 * 60 * 1000;
  // Round expiry up to a whole TTL so the same image keeps the same token for
  // the life of that window. Stable URLs are what let the browser reuse its
  // HTTP cache across reader payload rebuilds instead of re-fetching every
  // page after a refetch or a chapter re-entry.
  const exp = Math.ceil((now + ttlMs) / ttlMs) * ttlMs;
  const payload: ImageTicketPayload = { ...input, e: exp };
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  if (plaintext.length > MAX_TICKET_PAYLOAD) {
    throw new TicketError("too_large", "Image ticket payload is too large");
  }

  // Deterministic nonce, derived from the key and the plaintext: identical
  // image requests seal to identical tokens, and a different plaintext cannot
  // reuse a nonce because its hash differs.
  const iv = createHash("sha256")
    .update(keyFromSecret(options.secret))
    .update(plaintext)
    .digest()
    .subarray(0, 12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(options.secret), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1.${encode(iv)}.${encode(tag)}.${encode(ciphertext)}`;
}

export function openTicket(
  token: string,
  options: { secret: Buffer; now?: number },
): ImageTicketPayload {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new TicketError("invalid", "Malformed image ticket");
  }
  try {
    const iv = decode(parts[1] as string);
    const tag = decode(parts[2] as string);
    const ciphertext = decode(parts[3] as string);
    if (iv.length !== 12 || tag.length !== 16) {
      throw new TicketError("invalid", "Malformed image ticket");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyFromSecret(options.secret),
      iv,
    );
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    const parsed = JSON.parse(plaintext.toString("utf8")) as unknown;
    if (!isPayload(parsed)) {
      throw new TicketError("invalid", "Invalid image ticket payload");
    }
    if (parsed.e < (options.now ?? Date.now())) {
      throw new TicketError("expired", "Image ticket has expired");
    }
    return parsed;
  } catch (error) {
    if (error instanceof TicketError) throw error;
    throw new TicketError("invalid", "Image ticket could not be opened");
  }
}

function isImageTransform(value: unknown): value is ImageTransform {
  if (!value || typeof value !== "object") return false;
  const transform = value as Record<string, unknown>;
  return (
    transform.type === "band-reverse" &&
    typeof transform.bands === "number" &&
    Number.isInteger(transform.bands) &&
    transform.bands >= 2 &&
    transform.bands <= 64
  );
}

function isPayload(value: unknown): value is ImageTicketPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.u === "string" &&
    typeof payload.p === "string" &&
    (payload.k === "page" || payload.k === "cover") &&
    typeof payload.e === "number" &&
    (payload.r === undefined || typeof payload.r === "string") &&
    (payload.h === undefined ||
      (typeof payload.h === "object" &&
        payload.h !== null &&
        Object.values(payload.h).every((item) => typeof item === "string"))) &&
    (payload.t === undefined || isImageTransform(payload.t))
  );
}
