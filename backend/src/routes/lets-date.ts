import { Hono } from "hono";
import type { AppEnv } from "../hono";
import { parseJson } from "../lib/validation";
import { requireHousehold } from "../middleware/auth";
import { letsDateService } from "../services/lets-date-service";
import { letsDateRequestSchema } from "../types";

const letsDateRouter = new Hono<AppEnv>();

letsDateRouter.post("/", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, letsDateRequestSchema);
  return c.json({
    data: await letsDateService.suggest(
      household.id,
      household.defaultTimeZone,
      input,
    ),
  });
});

export { letsDateRouter };
