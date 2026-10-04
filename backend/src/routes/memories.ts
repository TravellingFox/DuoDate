import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../hono";
import { AppError } from "../lib/errors";
import { parseJson, parseOptionalJson } from "../lib/validation";
import { requireHousehold } from "../middleware/auth";
import { MAX_MEDIA_REQUEST_BYTES, mediaService } from "../services/media-service";
import { memoryService } from "../services/memory-service";
import {
  doAgainSchema,
  memoryContributionCreateSchema,
  memoryContributionUpdateSchema,
  memoryCoverUpdateSchema,
  memoryListQuerySchema,
  memoryMediaCaptionUpdateSchema,
  memoryMediaReorderSchema,
  memoryMediaUploadMetadataSchema,
  memoryUpdateSchema,
  spontaneousMemoryCreateSchema,
} from "../types";

const memoriesRouter = new Hono<AppEnv>();
const mediaUploadFields = new Set([
  "file",
  "clientRequestId",
  "kind",
  "caption",
  "sortOrder",
  "width",
  "height",
  "durationMs",
]);

async function parseMediaUpload(c: Parameters<typeof parseJson>[0]) {
  const contentType = c.req.header("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new AppError(400, "VALIDATION_ERROR", "Media uploads must use multipart/form-data");
  }

  let body: Record<string, string | File | (string | File)[]>;
  try {
    body = await c.req.parseBody({ all: true });
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "The multipart upload could not be parsed");
  }
  if (Object.keys(body).some((key) => !mediaUploadFields.has(key))) {
    throw new AppError(400, "VALIDATION_ERROR", "Media upload contains unsupported fields");
  }
  if (Object.values(body).some(Array.isArray)) {
    throw new AppError(400, "VALIDATION_ERROR", "Media upload fields may only be supplied once");
  }
  const file = body.file;
  if (!(file instanceof File)) {
    throw new AppError(400, "VALIDATION_ERROR", "A media file is required");
  }

  const metadataResult = memoryMediaUploadMetadataSchema.safeParse({
    kind: body.kind,
    clientRequestId: body.clientRequestId,
    caption: body.caption,
    sortOrder: body.sortOrder,
    width: body.width,
    height: body.height,
    durationMs: body.durationMs,
  });
  if (!metadataResult.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Media upload metadata is invalid");
  }
  return {
    file,
    metadata: metadataResult.data,
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

memoriesRouter.get("/", async (c) => {
  const { household } = requireHousehold(c);
  const parsed = memoryListQuerySchema.safeParse({
    captureState: c.req.query("captureState"),
  });
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Memory list query validation failed");
  }
  return c.json({ data: await memoryService.list(household.id, parsed.data) });
});

memoriesRouter.post("/", async (c) => {
  const { household, user } = requireHousehold(c);
  const input = await parseJson(c, spontaneousMemoryCreateSchema);
  return c.json({
    data: await memoryService.createSpontaneous(
      household.id,
      user.id,
      household.defaultTimeZone,
      input,
    ),
  }, 201);
});

memoriesRouter.get("/:id", async (c) => {
  const { household } = requireHousehold(c);
  return c.json({ data: await memoryService.get(household.id, c.req.param("id")) });
});

memoriesRouter.patch("/:id", async (c) => {
  const { household, user } = requireHousehold(c);
  const input = await parseJson(c, memoryUpdateSchema);
  return c.json({
    data: await memoryService.update(household.id, user.id, c.req.param("id"), input),
  });
});

memoriesRouter.post("/:id/do-again", async (c) => {
  const { household } = requireHousehold(c);
  await parseOptionalJson(c, doAgainSchema, {});
  return c.json({ data: await memoryService.doAgain(household.id, c.req.param("id")) });
});

memoriesRouter.post(
  "/:id/media",
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
    const upload = await parseMediaUpload(c);
    return c.json(
      {
        data: await mediaService.upload(
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

memoriesRouter.patch("/:memoryId/media/:mediaId", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, memoryMediaCaptionUpdateSchema);
  return c.json({
    data: await mediaService.updateCaption(
      household.id,
      c.req.param("memoryId"),
      c.req.param("mediaId"),
      input,
    ),
  });
});

memoriesRouter.put("/:memoryId/media-order", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, memoryMediaReorderSchema);
  return c.json({
    data: await mediaService.reorder(household.id, c.req.param("memoryId"), input),
  });
});

memoriesRouter.put("/:memoryId/cover", async (c) => {
  const { household, user } = requireHousehold(c);
  const input = await parseJson(c, memoryCoverUpdateSchema);
  return c.json({
    data: await mediaService.setCover(
      household.id,
      user.id,
      c.req.param("memoryId"),
      input,
    ),
  });
});

memoriesRouter.delete("/:memoryId/media/:mediaId", async (c) => {
  const { household, user } = requireHousehold(c);
  const result = await mediaService.delete(
    household.id,
    user.id,
    c.req.param("memoryId"),
    c.req.param("mediaId"),
  );
  return c.json({ data: result }, result.deletionPending ? 202 : 200);
});

memoriesRouter.post("/:id/contributions", async (c) => {
  const { household, user } = requireHousehold(c);
  const input = await parseJson(c, memoryContributionCreateSchema);
  const result = await memoryService.addContribution(household.id, user.id, c.req.param("id"), input);
  console.info("Memory text contribution POST", {
    clientRequestId: input.clientRequestId ?? null,
    memoryId: result.memory.id,
    success: true,
  });
  return c.json({ data: result }, 201);
});

memoriesRouter.patch("/:memoryId/contributions/:contributionId", async (c) => {
  const { household, user } = requireHousehold(c);
  const input = await parseJson(c, memoryContributionUpdateSchema);
  return c.json({
    data: await memoryService.updateContribution(
      household.id,
      user.id,
      c.req.param("memoryId"),
      c.req.param("contributionId"),
      input,
    ),
  });
});

memoriesRouter.delete("/:memoryId/contributions/:contributionId", async (c) => {
  const { household, user } = requireHousehold(c);
  return c.json({
    data: await memoryService.deleteContribution(
      household.id,
      user.id,
      c.req.param("memoryId"),
      c.req.param("contributionId"),
    ),
  });
});

export { memoriesRouter };
