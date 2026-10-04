import type { Context, Next } from "hono";
import { resolveAuthContext, type AuthContext } from "../auth";
import type { AppEnv } from "../hono";
import { AppError } from "../lib/errors";

export async function authenticate(c: Context<AppEnv>, next: Next) {
  c.set("auth", await resolveAuthContext(c.req.raw.headers));
  await next();
}

export function requireHousehold(c: Context<AppEnv>): AuthContext {
  const auth = c.get("auth");
  if (!auth) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required");
  return auth;
}
