import { Prisma } from "@prisma/client";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { AppEnv } from "./hono";
import { AppError } from "./lib/errors";
import { authenticate, requireHousehold } from "./middleware/auth";
import { initializeDatabase, prisma } from "./prisma";
import { authRouter } from "./routes/auth";
import { categoriesRouter, spacesRouter } from "./routes/catalog";
import { devicesRouter } from "./routes/devices";
import { devAuthRouter } from "./routes/dev-auth";
import { ideasRouter } from "./routes/ideas";
import { letsDateRouter } from "./routes/lets-date";
import { mediaRouter } from "./routes/media";
import { memoriesRouter } from "./routes/memories";
import { schedulesRouter } from "./routes/schedules";
import { destinationsRouter, tripsRouter } from "./routes/travel";
import { catalogService } from "./services/catalog-service";
import { planningContextService } from "./services/planning-context-service";
import { scheduleMaintenanceService } from "./services/schedule-maintenance-service";
import type { HouseholdMemberSummary } from "./types";

const allowedOrigins = [
  /^http:\/\/localhost(?::\d+)?$/,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.dev\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecodeapp\.com$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.dev$/,
  /^https:\/\/vibecode\.dev$/,
  /^https:\/\/[a-z0-9-]+\.style\.dev$/,
  /^https:\/\/\d+-[a-z0-9-]+\.daytonaproxy01\.(?:net|eu)$/,
  /^exp:\/\//,
  /^vibecode:\/\//,
];

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", async (_c, next) => {
    await initializeDatabase();
    await next();
  });
  app.use(
    "*",
    cors({
      origin: (origin) => (origin && allowedOrigins.some((pattern) => pattern.test(origin)) ? origin : null),
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );
  app.use("*", logger());
  app.use("*", authenticate);

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/api/bootstrap", async (c) => {
    const { household, user } = requireHousehold(c);
    await scheduleMaintenanceService.run(household.id);
    const [settings, members, spaces, categories, defaultPlanningContext] = await Promise.all([
      prisma.householdSettings.findUnique({ where: { householdId: household.id } }),
      prisma.householdMember
        .findMany({
          where: { householdId: household.id, user: { disabledAt: null } },
          orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
          select: { user: { select: { id: true, displayName: true } } },
        })
        .then((rows) => rows.map(({ user: member }) => member satisfies HouseholdMemberSummary)),
      catalogService.listSpaces(household.id),
      prisma.category.findMany({
        where: { householdId: household.id, deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      planningContextService.resolveDefault(
        household.id,
        household.defaultTimeZone,
      ),
    ]);
    return c.json({
      data: {
        user: { id: user.id, displayName: user.displayName },
        household: { id: household.id, defaultTimeZone: household.defaultTimeZone },
        settings,
        members,
        spaces,
        categories,
        defaultPlanningContext,
      },
    });
  });

  app.route("/api/auth", authRouter);
  app.route("/api/dev/auth", devAuthRouter);
  app.route("/api/spaces", spacesRouter);
  app.route("/api/categories", categoriesRouter);
  app.route("/api/ideas", ideasRouter);
  app.route("/api/lets-date", letsDateRouter);
  app.route("/api/destinations", destinationsRouter);
  app.route("/api/trips", tripsRouter);
  app.route("/api/schedules", schedulesRouter);
  app.route("/api/memories", memoriesRouter);
  app.route("/api/media", mediaRouter);
  app.route("/api/devices", devicesRouter);

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: { message: "Route not found", code: "NOT_FOUND" } }, 404);
    }
    return c.text("Not Found", 404);
  });

  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json({ error: { message: error.message, code: error.code } }, error.status);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error(error);
      return c.json(
        { error: { message: "The request conflicts with existing data", code: "DATA_CONFLICT" } },
        409,
      );
    }
    console.error(error);
    return c.json({ error: { message: "Internal server error", code: "INTERNAL_ERROR" } }, 500);
  });

  return app;
}
