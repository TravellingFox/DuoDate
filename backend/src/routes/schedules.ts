import { Hono } from "hono";
import type { AppEnv } from "../hono";
import { parseJson, parseOptionalJson } from "../lib/validation";
import { requireHousehold } from "../middleware/auth";
import { datedService } from "../services/dated-service";
import { dispatchContributionInvite } from "../services/notification-service";
import { scheduleService } from "../services/schedule-service";
import { datedScheduleSchema, scheduleCreateSchema, scheduleUpdateSchema } from "../types";

const schedulesRouter = new Hono<AppEnv>();

schedulesRouter.get("/", async (c) => {
  const { household } = requireHousehold(c);
  return c.json({ data: await scheduleService.list(household.id) });
});

schedulesRouter.get("/:id", async (c) => {
  const { household } = requireHousehold(c);
  return c.json({ data: await scheduleService.get(household.id, c.req.param("id")) });
});

schedulesRouter.post("/", async (c) => {
  const { household, user } = requireHousehold(c);
  const input = await parseJson(c, scheduleCreateSchema);
  return c.json({ data: await scheduleService.create(household.id, user.id, input) }, 201);
});

schedulesRouter.patch("/:id", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, scheduleUpdateSchema);
  return c.json({ data: await scheduleService.update(household.id, c.req.param("id"), input) });
});

schedulesRouter.post("/:id/reschedule", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, scheduleUpdateSchema);
  return c.json({ data: await scheduleService.update(household.id, c.req.param("id"), input) });
});

schedulesRouter.post("/:id/dated", async (c) => {
  const { household, user } = requireHousehold(c);
  await parseOptionalJson(c, datedScheduleSchema, {});
  const memory = await datedService.dateSchedule(household.id, user.id, c.req.param("id"));
  try {
    await dispatchContributionInvite(memory.id);
  } catch {
    console.error("Immediate notification dispatch failed; the durable intent remains retryable");
  }
  return c.json({ data: memory });
});

schedulesRouter.delete("/:id", async (c) => {
  const { household } = requireHousehold(c);
  return c.json({ data: await scheduleService.cancel(household.id, c.req.param("id")) });
});

export { schedulesRouter };
