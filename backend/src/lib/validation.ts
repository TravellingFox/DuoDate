import type { Context } from "hono";
import * as v4 from "zod/v4/core";
import { AppError } from "./errors";

export async function parseJson<T extends v4.$ZodType>(
  c: Context,
  schema: T,
): Promise<v4.output<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "Request body must be valid JSON");
  }

  const result = await v4.safeParseAsync(schema, body);
  if (!result.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Request validation failed");
  }
  return result.data;
}

export async function parseOptionalJson<T extends v4.$ZodType>(
  c: Context,
  schema: T,
  fallback: v4.input<T>,
): Promise<v4.output<T>> {
  const text = await c.req.text();
  let body: unknown = fallback;
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new AppError(400, "VALIDATION_ERROR", "Request body must be valid JSON");
    }
  }

  const result = await v4.safeParseAsync(schema, body);
  if (!result.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Request validation failed");
  }
  return result.data;
}
