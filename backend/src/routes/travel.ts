import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../hono";
import { calendarDateSchema } from "../lib/date-time";
import { AppError } from "../lib/errors";
import { parseJson } from "../lib/validation";
import { requireHousehold } from "../middleware/auth";
import { MAX_PHOTO_REQUEST_BYTES } from "../services/media-service";
import { travelService } from "../services/travel-service";
import { tripHeroImageService } from "../services/trip-hero-image-service";
import {
  destinationCreateSchema,
  destinationUpdateSchema,
  tripCreateSchema,
  tripHeroImageUploadMetadataSchema,
  tripUpdateSchema,
} from "../types";

const tripHeroUploadFields = new Set(["file", "width", "height"]);

async function parseTripHeroUpload(c: Parameters<typeof parseJson>[0]) {
  const contentType = c.req.header("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new AppError(400, "VALIDATION_ERROR", "Trip hero uploads must use multipart/form-data");
  }

  let body: Record<string, string | File | (string | File)[]>;
  try {
    body = await c.req.parseBody({ all: true });
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "The multipart upload could not be parsed");
  }
  if (Object.keys(body).some((key) => !tripHeroUploadFields.has(key))) {
    throw new AppError(400, "VALIDATION_ERROR", "Trip hero upload contains unsupported fields");
  }
  if (Object.values(body).some(Array.isArray)) {
    throw new AppError(400, "VALIDATION_ERROR", "Trip hero upload fields may only be supplied once");
  }
  const file = body.file;
  if (!(file instanceof File)) {
    throw new AppError(400, "VALIDATION_ERROR", "An image file is required");
  }
  const metadata = tripHeroImageUploadMetadataSchema.safeParse({
    width: body.width,
    height: body.height,
  });
  if (!metadata.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Trip hero upload metadata is invalid");
  }
  return {
    file,
    metadata: metadata.data,
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

const destinationsRouter = new Hono<AppEnv>();
destinationsRouter.get("/", async (c) => {
  const { household } = requireHousehold(c);
  return c.json({ data: await travelService.listDestinations(household.id) });
});
destinationsRouter.post("/", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, destinationCreateSchema);
  return c.json({ data: await travelService.createDestination(household.id, input) }, 201);
});
destinationsRouter.patch("/:id", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, destinationUpdateSchema);
  return c.json({ data: await travelService.updateDestination(household.id, c.req.param("id"), input) });
});
destinationsRouter.delete("/:id", async (c) => {
  const { household } = requireHousehold(c);
  await travelService.deleteDestination(household.id, c.req.param("id"));
  return c.body(null, 204);
});

const tripsRouter = new Hono<AppEnv>();
tripsRouter.get("/", async (c) => {
  const { household } = requireHousehold(c);
  const rawPlanningDate = c.req.query("planningDate");
  const parsed = rawPlanningDate ? calendarDateSchema.safeParse(rawPlanningDate) : null;
  if (parsed && !parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "planningDate must be YYYY-MM-DD");
  }
  return c.json({ data: await travelService.listTrips(household.id, parsed?.data) });
});
tripsRouter.put(
  "/:id/hero",
  bodyLimit({
    maxSize: MAX_PHOTO_REQUEST_BYTES,
    onError: (c) =>
      c.json(
        { error: { message: "The image upload is too large", code: "MEDIA_TOO_LARGE" } },
        413,
      ),
  }),
  async (c) => {
    const { household, user } = requireHousehold(c);
    const upload = await parseTripHeroUpload(c);
    return c.json(
      {
        data: await tripHeroImageService.upload(
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
tripsRouter.get("/:id/hero", async (c) => {
  const { household } = requireHousehold(c);
  if (c.req.header("Range")) {
    throw new AppError(
      416,
      "MEDIA_RANGE_NOT_SUPPORTED",
      "Byte-range image requests are not supported by the current encryption format",
    );
  }
  const content = await tripHeroImageService.getContent(household.id, c.req.param("id"));
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
tripsRouter.delete("/:id/hero", async (c) => {
  const { household } = requireHousehold(c);
  const result = await tripHeroImageService.delete(household.id, c.req.param("id"));
  return c.json({ data: result }, result.deletionPending ? 202 : 200);
});
tripsRouter.get("/:id", async (c) => {
  const { household } = requireHousehold(c);
  return c.json({ data: await travelService.getTripForPlanning(household.id, c.req.param("id")) });
});
tripsRouter.post("/", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, tripCreateSchema);
  return c.json({ data: await travelService.createTrip(household.id, input) }, 201);
});
tripsRouter.patch("/:id", async (c) => {
  const { household } = requireHousehold(c);
  const input = await parseJson(c, tripUpdateSchema);
  return c.json({ data: await travelService.updateTrip(household.id, c.req.param("id"), input) });
});
tripsRouter.delete("/:id", async (c) => {
  const { household } = requireHousehold(c);
  await travelService.deleteTrip(household.id, c.req.param("id"));
  return c.body(null, 204);
});

export { destinationsRouter, tripsRouter };
