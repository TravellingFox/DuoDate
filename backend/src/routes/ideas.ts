import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../hono";
import { AppError } from "../lib/errors";
import { parseJson } from "../lib/validation";
import { requireHousehold } from "../middleware/auth";
import { ideaImageService } from "../services/idea-image-service";
import { ideaService } from "../services/idea-service";
import { MAX_MEDIA_REQUEST_BYTES } from "../services/media-service";
import {
  availabilitySchema,
  ideaCreateSchema,
  ideaDestinationsSchema,
  ideaImageUploadMetadataSchema,
  ideaLinkInputSchema,
  ideaListQuerySchema,
  ideaSpacesSchema,
  ideaUpdateSchema,
  occurrenceCreateSchema,
  occurrenceUpdateSchema,
  weatherSchema,
} from "../types";

const ideasRouter = new Hono<AppEnv>();
const ideaImageUploadFields = new Set(["file", "kind", "width", "height"]);

async function parseIdeaImageUpload(c: Parameters<typeof parseJson>[0]) {
  const contentType = c.req.header("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new AppError(400, "VALIDATION_ERROR", "Idea media uploads must use multipart/form-data");
  }

  let body: Record<string, string | File | (string | File)[]>;
  try {
    body = await c.req.parseBody({ all: true });
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "The multipart upload could not be parsed");
  }
  if (Object.keys(body).some((key) => !ideaImageUploadFields.has(key))) {
    throw new AppError(400, "VALIDATION_ERROR", "Idea media upload contains unsupported fields");
  }
  if (Object.values(body).some(Array.isArray)) {
    throw new AppError(400, "VALIDATION_ERROR", "Idea media upload fields may only be supplied once");
  }
  const file = body.file;
  if (!(file instanceof File)) {
    throw new AppError(400, "VALIDATION_ERROR", "A photo or flyer image file is required");
  }
  const metadata = ideaImageUploadMetadataSchema.safeParse({
    kind: body.kind,
    width: body.width,
    height: body.height,
  });
  if (!metadata.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Idea media upload metadata is invalid");
  }
  return {
    file,
    metadata: metadata.data,
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

ideasRouter.get("/", async (c) => {
  const { household } = requireHousehold(c);
  const parsed = ideaListQuerySchema.safeParse({
    contextKind: c.req.query("contextKind"),
    contextId: c.req.query("contextId"),
    targetDate: c.req.query("targetDate"),
    scope: c.req.query("scope"),
  });
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Idea list query validation failed");
  }
  return c.json({
    data: await ideaService.list(
      household.id,
      household.defaultTimeZone,
      parsed.data,
    ),
  });
});

ideasRouter.get("/:id", async (c) => {
  const { household } = requireHousehold(c);
  return c.json({ data: await ideaService.get(household.id, c.req.param("id")) });
});

ideasRouter.post("/", async (c) => {
  const { household, user } = requireHousehold(c);
  const input = await parseJson(c, ideaCreateSchema);
  return c.json({ data: await ideaService.create(household.id, user.id, input) }, 201);
});

ideasRouter.put(
  "/:id/image",
  bodyLimit({
    maxSize: MAX_MEDIA_REQUEST_BYTES,
    onError: (c) =>
      c.json(
        { error: { message: "The media upload is too large", code: "MEDIA_TOO_LARGE" } },
        413,
      ),
  }),
  async (c) => {
    const { household, user } = requireHousehold(c);
    const upload = await parseIdeaImageUpload(c);
    return c.json(
      {
        data: await ideaImageService.upload(
          household.id,
          user.id,
          c.req.param("id"),
          upload.metadata,
          upload.file.type,
          upload.bytes,
        ),
      },
      201,
    );
  },
);

ideasRouter.get("/:id/image/content", async (c) => {
  const { household } = requireHousehold(c);
  if (c.req.header("Range")) {
    throw new AppError(
      416,
      "MEDIA_RANGE_NOT_SUPPORTED",
      "Byte-range media requests are not supported by the current encryption format",
    );
  }
  const content = await ideaImageService.getContent(household.id, c.req.param("id"));
  return new Response(content.bytes.slice().buffer, {
    status: 200,
    headers: {
      "Content-Type": content.contentType,
      "Content-Length": String(content.bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "none",
    },
  });
});

ideasRouter.delete("/:id/image", async (c) => {
  const { household } = requireHousehold(c);
  const result = await ideaImageService.delete(household.id, c.req.param("id"));
  return c.json({ data: result }, result.deletionPending ? 202 : 200);
});

ideasRouter.patch("/:id", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, ideaUpdateSchema);
  return c.json({ data: await ideaService.update(household.id, c.req.param("id"), input) });
});

ideasRouter.delete("/:id", async (c) => {
  const { household } = requireHousehold(c);
  await ideaService.delete(household.id, c.req.param("id"));
  return c.body(null, 204);
});

ideasRouter.put("/:id/spaces", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, ideaSpacesSchema);
  return c.json({ data: await ideaService.replaceSpaces(household.id, c.req.param("id"), input.spaceIds) });
});

ideasRouter.put("/:id/destinations", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, ideaDestinationsSchema);
  return c.json({
    data: await ideaService.replaceDestinations(
      household.id,
      c.req.param("id"),
      input.destinationIds,
    ),
  });
});

ideasRouter.post("/:id/links", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, ideaLinkInputSchema);
  return c.json({ data: await ideaService.addLink(household.id, c.req.param("id"), input) }, 201);
});

ideasRouter.patch("/:ideaId/links/:linkId", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, ideaLinkInputSchema.partial().strict());
  return c.json({
    data: await ideaService.updateLink(
      household.id,
      c.req.param("ideaId"),
      c.req.param("linkId"),
      input,
    ),
  });
});

ideasRouter.delete("/:ideaId/links/:linkId", async (c) => {
  const { household } = requireHousehold(c);
  await ideaService.deleteLink(household.id, c.req.param("ideaId"), c.req.param("linkId"));
  return c.body(null, 204);
});

ideasRouter.put("/:id/weather", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, weatherSchema);
  return c.json({ data: await ideaService.setWeather(household.id, c.req.param("id"), input) });
});

ideasRouter.put("/:id/availability", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, availabilitySchema);
  return c.json({ data: await ideaService.setAvailability(household.id, c.req.param("id"), input) });
});

ideasRouter.post("/:id/occurrences", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, occurrenceCreateSchema);
  return c.json({ data: await ideaService.addOccurrence(household.id, c.req.param("id"), input) }, 201);
});

ideasRouter.patch("/:ideaId/occurrences/:occurrenceId", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, occurrenceUpdateSchema);
  return c.json({
    data: await ideaService.updateOccurrence(
      household.id,
      c.req.param("ideaId"),
      c.req.param("occurrenceId"),
      input,
    ),
  });
});

ideasRouter.delete("/:ideaId/occurrences/:occurrenceId", async (c) => {
  const { household } = requireHousehold(c);
  await ideaService.deleteOccurrence(
    household.id,
    c.req.param("ideaId"),
    c.req.param("occurrenceId"),
  );
  return c.body(null, 204);
});

export { ideasRouter };
