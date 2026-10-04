import { Hono } from "hono";
import {
  createConfiguredProfileSession,
  listConfiguredSessionProfiles,
} from "../auth";
import { env } from "../env";
import type { AppEnv } from "../hono";
import { AppError } from "../lib/errors";
import { parseJson } from "../lib/validation";
import {
  devAuthSessionSchema,
  type DevAuthProfile,
  type DevAuthProfileSummary,
} from "../types";

const devAuthRouter = new Hono<AppEnv>();

function requireDevAuthBypass(): void {
  if (env.NODE_ENV !== "development" || !env.DUODATE_DEV_AUTH_BYPASS) {
    throw new AppError(404, "NOT_FOUND", "Route not found");
  }
}

function configuredProfiles(): Array<{ profile: DevAuthProfile; userId: string }> {
  return [
    { profile: "ONE", userId: env.DUODATE_USER_ONE_ID },
    { profile: "TWO", userId: env.DUODATE_USER_TWO_ID },
  ];
}

devAuthRouter.get("/session", async (c) => {
  requireDevAuthBypass();
  const configured = configuredProfiles();
  const eligible = await listConfiguredSessionProfiles(configured.map(({ userId }) => userId));
  const displayNameById = new Map(eligible.map((profile) => [profile.id, profile.displayName]));
  const profiles = configured.flatMap(({ profile, userId }): DevAuthProfileSummary[] => {
    const displayName = displayNameById.get(userId);
    return displayName ? [{ profile, displayName }] : [];
  });
  return c.json({ data: { profiles } });
});

devAuthRouter.post("/session", async (c) => {
  requireDevAuthBypass();
  const input = await parseJson(c, devAuthSessionSchema);
  const userId =
    input.profile === "ONE" ? env.DUODATE_USER_ONE_ID : env.DUODATE_USER_TWO_ID;
  const result = await createConfiguredProfileSession(userId, input.deviceLabel);
  return c.json({ data: result }, 201);
});

export { devAuthRouter };
