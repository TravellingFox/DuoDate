import { Hono } from "hono";
import type { AppEnv } from "../hono";
import { AppError } from "../lib/errors";
import { requireHousehold } from "../middleware/auth";
import { mediaService } from "../services/media-service";

const mediaRouter = new Hono<AppEnv>();

mediaRouter.get("/:mediaId/content", async (c) => {
  const { household } = requireHousehold(c);
  const content = await mediaService.getContent(household.id, c.req.param("mediaId"));
  if (c.req.header("Range")) {
    throw new AppError(
      416,
      "MEDIA_RANGE_NOT_SUPPORTED",
      "Byte-range media requests are not supported by the current encryption format",
    );
  }
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

export { mediaRouter };
