import { Hono } from "hono";
import { createSession, revokeSession } from "../auth";
import type { AppEnv } from "../hono";
import { parseJson } from "../lib/validation";
import { requireHousehold } from "../middleware/auth";
import { authLoginSchema } from "../types";

const authRouter = new Hono<AppEnv>();

authRouter.post("/session", async (c) => {
  const input = await parseJson(c, authLoginSchema);
  const forwardedFor = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const source = forwardedFor ?? c.req.header("x-real-ip") ?? "unknown";
  const result = await createSession(input, source);
  return c.json({ data: result }, 201);
});

authRouter.get("/session/current", (c) => {
  const auth = requireHousehold(c);
  return c.json({
    data: {
      user: {
        id: auth.user.id,
        displayName: auth.user.displayName,
        loginHandle: auth.user.loginHandle,
      },
      household: {
        id: auth.household.id,
        defaultTimeZone: auth.household.defaultTimeZone,
      },
    },
  });
});

authRouter.post("/session/revoke", async (c) => {
  const auth = requireHousehold(c);
  await revokeSession(auth);
  return c.body(null, 204);
});

export { authRouter };
