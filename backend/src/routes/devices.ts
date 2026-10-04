import { Hono } from "hono";
import type { AppEnv } from "../hono";
import { parseJson } from "../lib/validation";
import { requireHousehold } from "../middleware/auth";
import { deviceService } from "../services/device-service";
import { deviceInstallationSchema, deviceRegistrationSchema } from "../types";

const devicesRouter = new Hono<AppEnv>();

devicesRouter.get("/", async (c) => {
  const { household, user } = requireHousehold(c);
  return c.json({ data: await deviceService.listOwn(household.id, user.id) });
});

devicesRouter.post("/", async (c) => {
  const { household, user, sessionId } = requireHousehold(c);
  const input = await parseJson(c, deviceRegistrationSchema);
  return c.json({
    data: await deviceService.register(household.id, user.id, sessionId, input),
  }, 201);
});

devicesRouter.post("/revoke", async (c) => {
  const { household, user } = requireHousehold(c);
  const { installationId } = await parseJson(c, deviceInstallationSchema);
  await deviceService.revokeInstallation(household.id, user.id, installationId);
  return c.body(null, 204);
});

devicesRouter.delete("/:id", async (c) => {
  const { household, user } = requireHousehold(c);
  await deviceService.revoke(household.id, user.id, c.req.param("id"));
  return c.body(null, 204);
});

export { devicesRouter };
