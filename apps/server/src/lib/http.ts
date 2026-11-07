import type { Context } from "hono";
import type { ZodType } from "zod";
import { badRequest } from "./errors.js";

export function ok<T>(c: Context, data: T, status = 200) {
  return c.json({ data }, status as 200);
}

export function parseQuery<T>(c: Context, schema: ZodType<T>): T {
  const raw = c.req.query();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest(
      parsed.error.issues[0]?.message ?? "Invalid query parameters",
      parsed.error.issues,
    );
  }
  return parsed.data;
}

export async function parseJson<T>(
  c: Context,
  schema: ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest(
      parsed.error.issues[0]?.message ?? "Invalid request body",
      parsed.error.issues,
    );
  }
  return parsed.data;
}
