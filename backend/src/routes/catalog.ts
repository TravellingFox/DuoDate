import { Hono } from "hono";
import type { AppEnv } from "../hono";
import { parseJson } from "../lib/validation";
import { requireHousehold } from "../middleware/auth";
import { catalogService } from "../services/catalog-service";
import {
  categoryCreateSchema,
  categoryUpdateSchema,
  spaceCreateSchema,
  spaceUpdateSchema,
} from "../types";

const spacesRouter = new Hono<AppEnv>();
spacesRouter.get("/", async (c) => {
  const { household } = requireHousehold(c);
  return c.json({ data: await catalogService.listSpaces(household.id) });
});
spacesRouter.post("/", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, spaceCreateSchema);
  return c.json({ data: await catalogService.createSpace(household.id, input) }, 201);
});
spacesRouter.patch("/:id", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, spaceUpdateSchema);
  return c.json({ data: await catalogService.updateSpace(household.id, c.req.param("id"), input) });
});
spacesRouter.delete("/:id", async (c) => {
  const { household } = requireHousehold(c);
  await catalogService.retireSpace(household.id, c.req.param("id"));
  return c.body(null, 204);
});

const categoriesRouter = new Hono<AppEnv>();
categoriesRouter.get("/", async (c) => {
  const { household } = requireHousehold(c);
  return c.json({ data: await catalogService.listCategories(household.id) });
});
categoriesRouter.post("/", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, categoryCreateSchema);
  return c.json({ data: await catalogService.createCategory(household.id, input) }, 201);
});
categoriesRouter.patch("/:id", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, categoryUpdateSchema);
  return c.json({ data: await catalogService.updateCategory(household.id, c.req.param("id"), input) });
});
categoriesRouter.delete("/:id", async (c) => {
  const { household } = requireHousehold(c);
  await catalogService.deleteCategory(household.id, c.req.param("id"));
  return c.body(null, 204);
});

export { categoriesRouter, spacesRouter };
