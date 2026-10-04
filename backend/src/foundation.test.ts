import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "./app";
import { hashSessionToken } from "./auth";
import { ensureDevelopmentAuthProfiles } from "./development-auth";
import { env, envSchema } from "./env";
import {
  FakePushProvider,
  PushProviderRequestError,
  setPushProviderForTests,
} from "./notifications/push-provider";
import {
  calendarDateInTimeZone,
  calendarDateSchema,
  projectLocalTimes,
  type CalendarDate,
} from "./lib/date-time";
import {
  eligibilityService,
  evaluateIdeaEligibility,
  type EligibilityRequest,
  type PlanningIdea,
} from "./services/eligibility-service";
import { householdSettingsService } from "./services/household-settings-service";
import { datedService } from "./services/dated-service";
import { deriveCostFields } from "./services/idea-normalization";
import { letsDateService } from "./services/lets-date-service";
import {
  decryptMediaObject,
  encryptMediaObject,
  encryptIdeaImageObject,
  MEDIA_ENCRYPTION_VERSION,
  MediaIntegrityError,
  type MediaAssociatedData,
} from "./services/media-encryption";
import { mediaService } from "./services/media-service";
import { ideaImageService } from "./services/idea-image-service";
import { recurrenceFields } from "./services/idea-recurrence";
import { memoryService, recomputeMemoryContentState } from "./services/memory-service";
import {
  dispatchContributionInvite,
  processNotificationIntent,
  runNotificationSweep,
} from "./services/notification-service";
import { FakeObjectStorage } from "./storage/object-storage";
import { setMediaStorageRuntimeForTests } from "./storage/media-storage";
import {
  planningContextService,
  selectPrimaryActiveTrip,
  tripStatusAt,
  type ResolvedPlanningContext,
} from "./services/planning-context-service";
import {
  markScheduleMissedIfStillDue,
  scheduleMaintenanceService,
} from "./services/schedule-maintenance-service";
import { travelService } from "./services/travel-service";
import { tripHeroImageService } from "./services/trip-hero-image-service";
import { initializeDatabase, prisma } from "./prisma";
import {
  canonicalCategories,
  canonicalSpaces,
  provisionCanonicalCatalog,
  provisionCanonicalCategories,
} from "./scripts/provision";
import type { IdeaRecurrenceInput } from "./types";

const app = createApp();
const firstPassphrase = "correct horse battery staple one";
const secondPassphrase = "correct horse battery staple two";
let firstHash: string;
let secondHash: string;
const mediaStorage = new FakeObjectStorage();
const mediaMasterKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
let pushProvider: FakePushProvider;

async function resetDatabase() {
  await prisma.suggestionItem.deleteMany();
  await prisma.suggestionSet.deleteMany();
  await prisma.notificationDelivery.deleteMany();
  await prisma.notificationIntent.deleteMany();
  await prisma.memoryMedia.deleteMany();
  await prisma.ideaImage.deleteMany();
  await prisma.tripHeroImage.deleteMany();
  await prisma.memoryContribution.deleteMany();
  await prisma.memory.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.specificOccurrence.deleteMany();
  await prisma.availability.deleteMany();
  await prisma.weatherSuitability.deleteMany();
  await prisma.ideaLink.deleteMany();
  await prisma.ideaSpace.deleteMany();
  await prisma.ideaDestination.deleteMany();
  await prisma.idea.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.destination.deleteMany();
  await prisma.category.deleteMany();
  await prisma.space.deleteMany();
  await prisma.device.deleteMany();
  await prisma.authSession.deleteMany();
  await prisma.authThrottle.deleteMany();
  await prisma.householdMember.deleteMany();
  await prisma.authCredential.deleteMany();
  await prisma.userProfile.deleteMany();
  await prisma.householdSettings.deleteMany();
  await prisma.household.deleteMany();
}

async function seedFoundation() {
  await prisma.household.create({
    data: {
      id: env.DUODATE_HOUSEHOLD_ID,
      defaultTimeZone: "Europe/Berlin",
      suggestionSeed: "test-seed",
      settings: { create: {} },
    },
  });

  await prisma.userProfile.create({
    data: {
      id: env.DUODATE_USER_ONE_ID,
      displayName: "Pablo Test",
      loginHandle: "pablo-test",
      credential: { create: { passwordHash: firstHash } },
      memberships: { create: { householdId: env.DUODATE_HOUSEHOLD_ID } },
    },
  });
  await prisma.userProfile.create({
    data: {
      id: env.DUODATE_USER_TWO_ID,
      displayName: "Luane Test",
      loginHandle: "luane-test",
      credential: { create: { passwordHash: secondHash } },
      memberships: { create: { householdId: env.DUODATE_HOUSEHOLD_ID } },
    },
  });

  await prisma.space.createMany({
    data: [
      { id: "space-berlin", householdId: env.DUODATE_HOUSEHOLD_ID, name: "Berlin", timeZone: "Europe/Berlin", sortOrder: 0 },
      { id: "space-online", householdId: env.DUODATE_HOUSEHOLD_ID, name: "Online", sortOrder: 1 },
    ],
  });
  await prisma.category.create({
    data: { id: "category-food", householdId: env.DUODATE_HOUSEHOLD_ID, name: "Food & Drink" },
  });
}

async function signIn(handle: string, passphrase: string, source: string) {
  const response = await app.request("http://duodate.test/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": source },
    body: JSON.stringify({ handle, passphrase }),
  });
  const body = (await response.json()) as { data?: { token: string }; error?: { message: string; code: string } };
  return { response, body, token: body.data?.token };
}

async function withDevAuthEnvironment<T>(
  nodeEnv: typeof env.NODE_ENV,
  enabled: boolean,
  run: () => Promise<T>,
): Promise<T> {
  const previousNodeEnv = env.NODE_ENV;
  const previousEnabled = env.DUODATE_DEV_AUTH_BYPASS;
  env.NODE_ENV = nodeEnv;
  env.DUODATE_DEV_AUTH_BYPASS = enabled;
  try {
    return await run();
  } finally {
    env.NODE_ENV = previousNodeEnv;
    env.DUODATE_DEV_AUTH_BYPASS = previousEnabled;
  }
}

async function devSignIn(
  profile: "ONE" | "TWO",
  deviceLabel?: string,
) {
  const response = await app.request("http://duodate.test/api/dev/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile, ...(deviceLabel ? { deviceLabel } : {}) }),
  });
  const body = (await response.json()) as {
    data?: {
      token: string;
      session: { id: string; expiresAt: string };
      user: { id: string; displayName: string; loginHandle: string };
      household: { id: string; defaultTimeZone: string };
    };
    error?: { message: string; code: string };
  };
  return { response, body, token: body.data?.token };
}

function authorizedRequest(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  return app.request(`http://duodate.test${path}`, { ...init, headers });
}

async function registerDevice(
  token: string,
  installationId: string,
  pushToken: string,
) {
  return authorizedRequest("/api/devices", token, {
    method: "POST",
    body: JSON.stringify({ installationId, pushToken, platform: "ANDROID" }),
  });
}

function photoBytes(label = "private photo") {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(label)]);
}

function videoBytes(label = "private video") {
  return Uint8Array.from([
    0x00, 0x00, 0x00, 0x18,
    ...new TextEncoder().encode("ftypisom"),
    ...new TextEncoder().encode(label),
  ]);
}

function voiceBytes(label = "private voice") {
  return Uint8Array.from([
    ...new TextEncoder().encode("RIFF"),
    0x00, 0x00, 0x00, 0x00,
    ...new TextEncoder().encode("WAVE"),
    ...new TextEncoder().encode(label),
  ]);
}

async function uploadMedia(
  token: string,
  memoryId: string,
  input: {
    kind: "PHOTO" | "VIDEO" | "VOICE_NOTE";
    bytes: Uint8Array;
    contentType: string;
    caption?: string;
    sortOrder?: number;
    extra?: Record<string, string>;
  },
) {
  const form = new FormData();
  form.append("kind", input.kind);
  const extension = input.kind === "PHOTO" ? "jpg" : input.kind === "VIDEO" ? "mp4" : "wav";
  form.append(
    "file",
    new File([input.bytes], `memory-media.${extension}`, { type: input.contentType }),
  );
  if (input.caption !== undefined) form.append("caption", input.caption);
  if (input.sortOrder !== undefined) form.append("sortOrder", String(input.sortOrder));
  for (const [key, value] of Object.entries(input.extra ?? {})) form.append(key, value);
  return authorizedRequest(`/api/memories/${memoryId}/media`, token, {
    method: "POST",
    body: form,
  });
}

async function uploadIdeaImage(
  token: string,
  ideaId: string,
  input: {
    bytes: Uint8Array;
    contentType: string;
    kind?: "PHOTO" | "VIDEO";
    width?: number;
    height?: number;
    extra?: Record<string, string>;
  },
) {
  const form = new FormData();
  if (input.kind !== undefined) form.append("kind", input.kind);
  // Bun's multipart parser derives known file MIME types from the extension.
  const extension = input.contentType === "image/jpeg" ? "jpg"
    : input.contentType === "audio/mp4" ? "m4a"
    : input.contentType === "audio/wav" ? "wav" : "mp4";
  form.append("file", new File([input.bytes], `idea-attachment.${extension}`, { type: input.contentType }));
  if (input.width !== undefined) form.append("width", String(input.width));
  if (input.height !== undefined) form.append("height", String(input.height));
  for (const [key, value] of Object.entries(input.extra ?? {})) form.append(key, value);
  return authorizedRequest(`/api/ideas/${ideaId}/image`, token, {
    method: "PUT",
    body: form,
  });
}

async function uploadTripHero(
  token: string,
  tripId: string,
  input: {
    bytes: Uint8Array;
    contentType: string;
    width?: number;
    height?: number;
    extra?: Record<string, string>;
  },
) {
  const form = new FormData();
  form.append("file", new File([input.bytes], "trip-hero.jpg", { type: input.contentType }));
  if (input.width !== undefined) form.append("width", String(input.width));
  if (input.height !== undefined) form.append("height", String(input.height));
  for (const [key, value] of Object.entries(input.extra ?? {})) form.append(key, value);
  return authorizedRequest(`/api/trips/${tripId}/hero`, token, {
    method: "PUT",
    body: form,
  });
}

async function createIdea(token: string, overrides: Record<string, unknown> = {}) {
  const response = await authorizedRequest("/api/ideas", token, {
    method: "POST",
    body: JSON.stringify({
      title: "Dinner together",
      categoryId: "category-food",
      spaceIds: ["space-berlin", "space-online"],
      destinationIds: [],
      links: [],
      availability: { mode: "ANYTIME" },
      ...overrides,
    }),
  });
  const body = (await response.json()) as { data: { id: string; createdById: string; spaces: Array<{ id: string }> } };
  return { response, body, idea: body.data };
}

let planningIdeaSequence = 0;

async function createPlanningIdea(input: {
  title?: string;
  lifecycle?: "ACTIVE" | "COMPLETED" | "EXPIRED";
  deletedAt?: Date | null;
  specificLocation?: string | null;
  categoryId?: string | null;
  spaceIds?: string[];
  destinationIds?: string[];
  availability?: {
    mode: "ANYTIME" | "DATE_RANGE" | "SPECIFIC_OCCURRENCES";
    rangeStartDate?: string | null;
    rangeEndDate?: string | null;
  };
  occurrenceDates?: string[];
  recurrence?: IdeaRecurrenceInput;
  costMaxTotalCents?: number | null;
  exactCostTotalCents?: number | null;
  durationRank?: number | null;
  weather?: {
    sunny?: "NEUTRAL" | "GOOD" | "IMPOSSIBLE";
    rainy?: "NEUTRAL" | "GOOD" | "IMPOSSIBLE";
    indoor?: "NEUTRAL" | "GOOD" | "IMPOSSIBLE";
    outdoor?: "NEUTRAL" | "GOOD" | "IMPOSSIBLE";
  } | null;
} = {}) {
  planningIdeaSequence += 1;
  const id = `planning-idea-${planningIdeaSequence}`;
  await prisma.idea.create({
    data: {
      id,
      householdId: env.DUODATE_HOUSEHOLD_ID,
      createdById: env.DUODATE_USER_ONE_ID,
      title: input.title ?? id,
      lifecycle: input.lifecycle ?? "ACTIVE",
      deletedAt: input.deletedAt ?? null,
      specificLocation: input.specificLocation ?? null,
      categoryId: input.categoryId ?? null,
      costMaxTotalCents: input.costMaxTotalCents ?? null,
      exactCostTotalCents: input.exactCostTotalCents ?? null,
      durationRank: input.durationRank ?? null,
      ...recurrenceFields(input.recurrence ?? { kind: "NONE" }),
      availability: { create: input.availability ?? { mode: "ANYTIME" } },
      spaces: {
        create: (input.spaceIds ?? ["space-berlin"]).map((spaceId) => ({ spaceId })),
      },
      destinations: {
        create: (input.destinationIds ?? []).map((destinationId) => ({ destinationId })),
      },
      occurrences: {
        create: (input.occurrenceDates ?? []).map((localDate) => ({ localDate })),
      },
      ...(input.weather === null ? {} : { weatherSuitability: { create: input.weather ?? {} } }),
    },
  });
  return id;
}

let scheduleSequence = 0;

async function createTestSchedule(
  ideaId: string,
  input: {
    householdId?: string;
    createdById?: string;
    scheduledDate?: string;
    cleanupDueAt?: Date;
    status?: "SCHEDULED" | "COMPLETED" | "MISSED" | "CANCELLED";
  } = {},
) {
  scheduleSequence += 1;
  const status = input.status ?? "SCHEDULED";
  return prisma.schedule.create({
    data: {
      id: `phase-c-schedule-${scheduleSequence}`,
      householdId: input.householdId ?? env.DUODATE_HOUSEHOLD_ID,
      ideaId,
      createdById: input.createdById ?? env.DUODATE_USER_ONE_ID,
      scheduledDate: input.scheduledDate ?? "2026-10-10",
      timeZone: "Europe/Berlin",
      cleanupDueAt: input.cleanupDueAt ?? new Date("2026-10-13T00:00:00.000Z"),
      status,
      activeSlot: status === "SCHEDULED" ? ideaId : null,
    },
  });
}

async function loadPlanningIdea(id: string): Promise<PlanningIdea> {
  const idea = (await eligibilityService.loadIdeas(env.DUODATE_HOUSEHOLD_ID)).find(
    (candidate) => candidate.id === id,
  );
  if (!idea) throw new Error(`Missing test Idea ${id}`);
  return idea;
}

function eligibilityRequest(
  context: ResolvedPlanningContext,
  targetDate: string,
  overrides: Partial<EligibilityRequest> = {},
): EligibilityRequest {
  return {
    householdId: env.DUODATE_HOUSEHOLD_ID,
    mode: "LETS_DATE",
    context,
    targetDate: targetDate as CalendarDate,
    maximumCostTotalCents: null,
    maximumDurationRank: null,
    weatherConditions: [],
    ...overrides,
  };
}

type CostFields = {
  costBand: string | null;
  exactCostCents: number | null;
  costBasisAtEntry: string | null;
  costMinTotalCents: number | null;
  costMaxTotalCents: number | null;
  exactCostTotalCents: number | null;
};

beforeAll(async () => {
  await initializeDatabase();
  [firstHash, secondHash] = await Promise.all([
    Bun.password.hash(firstPassphrase, { algorithm: "argon2id" }),
    Bun.password.hash(secondPassphrase, { algorithm: "argon2id" }),
  ]);
});

beforeEach(async () => {
  mediaStorage.clear();
  pushProvider = new FakePushProvider();
  setPushProviderForTests(pushProvider);
  setMediaStorageRuntimeForTests({
    storage: mediaStorage,
    masterKeys: new Map([[1, mediaMasterKey]]),
    currentKeyVersion: 1,
  });
  await resetDatabase();
  await seedFoundation();
});

afterAll(async () => {
  await resetDatabase();
  setPushProviderForTests(undefined);
  setMediaStorageRuntimeForTests(undefined);
  await prisma.$disconnect();
});

describe("Foundation Phase A", () => {
  test("provisions exactly the two approved profiles", async () => {
    const users = await prisma.userProfile.findMany({
      include: { memberships: true, credential: true },
      orderBy: { id: "asc" },
    });
    expect(users).toHaveLength(2);
    expect(users.every((user) => user.memberships.length === 1 && user.credential !== null)).toBe(true);
    expect(users.map((user) => user.id).sort()).toEqual(
      [env.DUODATE_USER_ONE_ID, env.DUODATE_USER_TWO_ID].sort(),
    );
  });

  test("canonical catalog provisioning initializes empty Spaces idempotently in production", async () => {
    await prisma.space.deleteMany();
    const categories = await prisma.category.findMany();
    await withDevAuthEnvironment("production", false, async () => {
      await prisma.$transaction((tx) =>
        provisionCanonicalCatalog(tx, env.DUODATE_HOUSEHOLD_ID),
      );
      const initial = await prisma.space.findMany({ orderBy: { sortOrder: "asc" } });
      expect(initial.map(({ name, timeZone, sortOrder }) => ({ name, timeZone, sortOrder })))
        .toEqual([...canonicalSpaces]);
      expect(initial.every(({ id, retiredAt }) => Boolean(id) && retiredAt === null)).toBe(true);
      expect(await prisma.category.findMany()).toEqual(categories);

      await prisma.$transaction((tx) =>
        provisionCanonicalCatalog(tx, env.DUODATE_HOUSEHOLD_ID),
      );
      expect(await prisma.space.findMany({ orderBy: { sortOrder: "asc" } })).toEqual(initial);
    });
  });

  test("catalog provisioning and development startup preserve existing, custom, and retired Spaces", async () => {
    await prisma.space.update({
      where: { id: "space-berlin" },
      data: { name: "Our Berlin", timeZone: "Europe/Paris", sortOrder: 42 },
    });
    await prisma.space.createMany({
      data: [
        {
          id: "space-salvador-retired",
          householdId: env.DUODATE_HOUSEHOLD_ID,
          name: "Salvador",
          timeZone: "America/Sao_Paulo",
          sortOrder: 99,
          retiredAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        { id: "space-custom", householdId: env.DUODATE_HOUSEHOLD_ID, name: "Our favorites", sortOrder: 7 },
        { id: "space-travel-existing", householdId: env.DUODATE_HOUSEHOLD_ID, name: "Travel", sortOrder: 8 },
      ],
    });
    const initial = await prisma.space.findMany({ orderBy: { id: "asc" } });
    await withDevAuthEnvironment("development", true, async () => {
      for (let repeat = 0; repeat < 2; repeat++) {
        await prisma.$transaction((tx) =>
          provisionCanonicalCatalog(tx, env.DUODATE_HOUSEHOLD_ID),
        );
        expect(await ensureDevelopmentAuthProfiles()).toBe(true);
        expect(await prisma.space.findMany({ orderBy: { id: "asc" } })).toEqual(initial);
      }
    });
  });

  test("catalog provisioning preserves retired-only Spaces and scopes initialization to the household", async () => {
    await prisma.space.deleteMany();
    const otherHousehold = await prisma.household.create({
      data: { id: "other-catalog-household", suggestionSeed: "other-catalog-seed" },
    });
    const retired = await prisma.space.create({
      data: {
        id: "space-other-retired",
        householdId: otherHousehold.id,
        name: "Berlin",
        timeZone: "Europe/Paris",
        sortOrder: 99,
        retiredAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    for (let repeat = 0; repeat < 2; repeat++) {
      await prisma.$transaction(async (tx) => {
        await provisionCanonicalCatalog(tx, otherHousehold.id);
        await provisionCanonicalCatalog(tx, env.DUODATE_HOUSEHOLD_ID);
      });
    }
    expect(await prisma.space.findMany({ where: { householdId: otherHousehold.id } }))
      .toEqual([retired]);
    const spaces = await prisma.space.findMany({
      where: { householdId: env.DUODATE_HOUSEHOLD_ID },
      orderBy: { sortOrder: "asc" },
    });
    expect(spaces.map(({ name, timeZone, sortOrder }) => ({ name, timeZone, sortOrder })))
      .toEqual([...canonicalSpaces]);
  });

  test("canonical category provisioning initializes an empty catalog idempotently", async () => {
    await prisma.category.deleteMany();
    await prisma.$transaction((tx) =>
      provisionCanonicalCategories(tx, env.DUODATE_HOUSEHOLD_ID),
    );
    const initial = await prisma.category.findMany({ orderBy: { sortOrder: "asc" } });
    expect(initial.map(({ name, sortOrder }) => ({ name, sortOrder }))).toEqual(
      [...canonicalCategories],
    );
    expect(initial.every(({ id, deletedAt }) => Boolean(id) && deletedAt === null)).toBe(true);

    await prisma.$transaction((tx) =>
      provisionCanonicalCategories(tx, env.DUODATE_HOUSEHOLD_ID),
    );
    expect(await prisma.category.findMany({ orderBy: { sortOrder: "asc" } })).toEqual(initial);
  });

  test("canonical category provisioning preserves customized and deleted records", async () => {
    await prisma.category.update({ where: { id: "category-food" }, data: { sortOrder: 42 } });
    await prisma.category.createMany({
      data: [
        {
          id: "category-learning-existing",
          householdId: env.DUODATE_HOUSEHOLD_ID,
          name: "Learning Something",
          sortOrder: 99,
          deletedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        { id: "category-custom", householdId: env.DUODATE_HOUSEHOLD_ID, name: "Our favorites", sortOrder: 7 },
      ],
    });
    const initial = await prisma.category.findMany({ orderBy: { id: "asc" } });

    await prisma.$transaction((tx) =>
      provisionCanonicalCategories(tx, env.DUODATE_HOUSEHOLD_ID),
    );
    expect(await prisma.category.findMany({ orderBy: { id: "asc" } })).toEqual(initial);
  });

  test("canonical category provisioning preserves a catalog containing only tombstones", async () => {
    await prisma.category.update({
      where: { id: "category-food" },
      data: { deletedAt: new Date("2026-01-01T00:00:00.000Z") },
    });
    const initial = await prisma.category.findMany();
    await prisma.$transaction((tx) =>
      provisionCanonicalCategories(tx, env.DUODATE_HOUSEHOLD_ID),
    );
    expect(await prisma.category.findMany()).toEqual(initial);
  });

  test("valid handle and passphrase login succeeds and invalid login is generic", async () => {
    const valid = await signIn("  PABLO-TEST  ", firstPassphrase, "login-valid");
    expect(valid.response.status).toBe(201);
    expect(valid.token).toBeString();

    const wrongPassphrase = await signIn("pablo-test", "wrong", "login-wrong-pass");
    const unknownHandle = await signIn("not-a-profile", "wrong", "login-wrong-handle");
    expect(wrongPassphrase.response.status).toBe(401);
    expect(unknownHandle.response.status).toBe(401);
    expect(wrongPassphrase.body.error).toEqual(unknownHandle.body.error);
    expect(wrongPassphrase.body.error).toEqual({
      message: "Invalid login credentials",
      code: "LOGIN_FAILED",
    });
  });

  test("parallel app startup reads reuse recent session activity and maintenance work", async () => {
    const signedIn = await signIn("pablo-test", firstPassphrase, "parallel-startup");
    const sessionBefore = await prisma.authSession.findUniqueOrThrow({
      where: { tokenHash: hashSessionToken(signedIn.token!) },
      select: { lastUsedAt: true },
    });

    const responses = await Promise.all([
      authorizedRequest("/api/auth/session/current", signedIn.token!),
      authorizedRequest("/api/bootstrap", signedIn.token!),
      authorizedRequest("/api/schedules", signedIn.token!),
      authorizedRequest("/api/memories", signedIn.token!),
      authorizedRequest("/api/ideas", signedIn.token!),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([200, 200, 200, 200, 200]);
    expect(
      await prisma.authSession.findUniqueOrThrow({
        where: { tokenHash: hashSessionToken(signedIn.token!) },
        select: { lastUsedAt: true },
      }),
    ).toEqual(sessionBefore);
  });

  test("development auth bypass is hidden when its explicit flag is disabled", async () => {
    await withDevAuthEnvironment("development", false, async () => {
      const getResponse = await app.request("http://duodate.test/api/dev/auth/session");
      const postResponse = await app.request("http://duodate.test/api/dev/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: "ONE" }),
      });

      expect(getResponse.status).toBe(404);
      expect(postResponse.status).toBe(404);
      expect(await getResponse.json()).toEqual({
        error: { message: "Route not found", code: "NOT_FOUND" },
      });
      expect(await prisma.authSession.count()).toBe(0);
    });
  });

  test("development auth startup provisioning survives logout and repeated startup", async () => {
    await resetDatabase();

    await withDevAuthEnvironment("development", true, async () => {
      expect(await ensureDevelopmentAuthProfiles()).toBe(true);

      const initialList = await app.request("http://duodate.test/api/dev/auth/session");
      expect(initialList.status).toBe(200);
      expect(await initialList.json()).toEqual({
        data: {
          profiles: [
            {
              profile: "ONE",
              displayName: env.DUODATE_USER_ONE_DISPLAY_NAME ?? "Pablo",
            },
            {
              profile: "TWO",
              displayName: env.DUODATE_USER_TWO_DISPLAY_NAME ?? "Luane",
            },
          ],
        },
      });

      const firstSession = await devSignIn("ONE", "Development startup test one");
      expect(firstSession.response.status).toBe(201);
      expect(firstSession.body.data?.user.id).toBe(env.DUODATE_USER_ONE_ID);
      expect(
        (
          await authorizedRequest("/api/auth/session/revoke", firstSession.token!, {
            method: "POST",
          })
        ).status,
      ).toBe(204);

      const afterFirstLogout = await app.request("http://duodate.test/api/dev/auth/session");
      expect(afterFirstLogout.status).toBe(200);
      expect(((await afterFirstLogout.json()) as { data: { profiles: unknown[] } }).data.profiles)
        .toHaveLength(2);

      const secondSession = await devSignIn("TWO", "Development startup test two");
      expect(secondSession.response.status).toBe(201);
      expect(secondSession.body.data?.user.id).toBe(env.DUODATE_USER_TWO_ID);
      expect(secondSession.body.data?.user.id).not.toBe(firstSession.body.data?.user.id);
      expect(
        (
          await authorizedRequest("/api/auth/session/revoke", secondSession.token!, {
            method: "POST",
          })
        ).status,
      ).toBe(204);

      expect(await ensureDevelopmentAuthProfiles()).toBe(true);
      const afterRestart = await app.request("http://duodate.test/api/dev/auth/session");
      expect(afterRestart.status).toBe(200);
      expect(((await afterRestart.json()) as { data: { profiles: unknown[] } }).data.profiles)
        .toHaveLength(2);
      expect(await prisma.userProfile.count()).toBe(2);
      expect(await prisma.authCredential.count()).toBe(2);
      expect(await prisma.householdMember.count()).toBe(2);
    });
  });

  test("development startup exposes real editable canonical categories in fresh bootstrap", async () => {
    await resetDatabase();
    await withDevAuthEnvironment("development", true, async () => {
      expect(await ensureDevelopmentAuthProfiles()).toBe(true);
      const signedIn = await devSignIn("ONE", "Category startup test");
      expect(signedIn.response.status).toBe(201);
      const bootstrapResponse = await authorizedRequest("/api/bootstrap", signedIn.token!);
      expect(bootstrapResponse.status).toBe(200);
      const bootstrap = (await bootstrapResponse.json()) as {
        data: {
          categories: Array<{ id: string; name: string; sortOrder: number }>;
          spaces: Array<{ id: string; name: string; timeZone: string | null; sortOrder: number }>;
        };
      };
      expect(bootstrap.data.categories.map(({ name, sortOrder }) => ({ name, sortOrder })))
        .toEqual([...canonicalCategories]);
      expect(bootstrap.data.spaces.map(({ name, timeZone, sortOrder }) => ({ name, timeZone, sortOrder })))
        .toEqual([...canonicalSpaces]);
      const initialSpaces = await prisma.space.findMany({ orderBy: { sortOrder: "asc" } });
      const learning = bootstrap.data.categories.find(({ name }) => name === "Learning Something")!;
      expect(learning.id).toBeString();
      const created = await createIdea(signedIn.token!, {
        categoryId: learning.id,
        spaceIds: [],
      });
      expect(created.response.status).toBe(201);
      expect(await prisma.idea.findUnique({ where: { id: created.idea.id } }))
        .toMatchObject({ categoryId: learning.id });

      const renamed = await authorizedRequest(`/api/categories/${learning.id}`, signedIn.token!, {
        method: "PATCH",
        body: JSON.stringify({ name: "Our Learning", sortOrder: 99 }),
      });
      expect(renamed.status).toBe(200);
      const initial = await prisma.category.findMany({ orderBy: { id: "asc" } });
      expect(await ensureDevelopmentAuthProfiles()).toBe(true);
      expect(await prisma.category.findMany({ orderBy: { id: "asc" } })).toEqual(initial);
      expect(await prisma.space.findMany({ orderBy: { sortOrder: "asc" } })).toEqual(initialSpaces);

      for (const category of initial) {
        const deleted = await authorizedRequest(`/api/categories/${category.id}`, signedIn.token!, {
          method: "DELETE",
        });
        expect(deleted.status).toBe(204);
      }
      const tombstones = await prisma.category.findMany({ orderBy: { id: "asc" } });
      expect(await ensureDevelopmentAuthProfiles()).toBe(true);
      expect(await prisma.category.findMany({ orderBy: { id: "asc" } })).toEqual(tombstones);
      const afterDeletion = await authorizedRequest("/api/bootstrap", signedIn.token!);
      expect(afterDeletion.status).toBe(200);
      expect(((await afterDeletion.json()) as { data: { categories: unknown[] } }).data.categories)
        .toEqual([]);
      expect(await prisma.idea.findUnique({ where: { id: created.idea.id } }))
        .toMatchObject({ categoryId: null });
    });
  });

  test("fresh development bootstrap exposes persisted editable Spaces without recreating retired records", async () => {
    await resetDatabase();
    await withDevAuthEnvironment("development", true, async () => {
      expect(await ensureDevelopmentAuthProfiles()).toBe(true);
      const signedIn = await devSignIn("ONE", "Spaces startup test");
      expect(signedIn.response.status).toBe(201);
      const bootstrapResponse = await authorizedRequest("/api/bootstrap", signedIn.token!);
      const listResponse = await authorizedRequest("/api/spaces", signedIn.token!);
      expect(bootstrapResponse.status).toBe(200);
      expect(listResponse.status).toBe(200);
      const persisted = await prisma.space.findMany({ orderBy: { sortOrder: "asc" } });
      const serialized = JSON.parse(JSON.stringify(persisted));
      expect(((await bootstrapResponse.json()) as { data: { spaces: unknown[] } }).data.spaces)
        .toEqual(serialized);
      expect(await listResponse.json()).toEqual({ data: serialized });
      expect(persisted.map(({ name, timeZone, sortOrder }) => ({ name, timeZone, sortOrder })))
        .toEqual([...canonicalSpaces]);
      const berlin = persisted.find(({ name }) => name === "Berlin")!;
      const salvador = persisted.find(({ name }) => name === "Salvador")!;
      const created = await createIdea(signedIn.token!, { categoryId: null, spaceIds: [berlin.id] });
      expect(created.response.status).toBe(201);
      expect(created.idea.spaces.map(({ id }) => id)).toEqual([berlin.id]);

      expect((await authorizedRequest(`/api/spaces/${berlin.id}`, signedIn.token!, {
        method: "PATCH",
        body: JSON.stringify({ name: "Our Berlin", timeZone: "Europe/Paris", sortOrder: 42 }),
      })).status).toBe(200);
      expect((await authorizedRequest(`/api/spaces/${salvador.id}`, signedIn.token!, {
        method: "DELETE",
      })).status).toBe(204);
      expect((await authorizedRequest("/api/spaces", signedIn.token!, {
        method: "POST",
        body: JSON.stringify({ name: "Our favorites", timeZone: null, sortOrder: 7 }),
      })).status).toBe(201);
      const customized = await prisma.space.findMany({ orderBy: { id: "asc" } });
      for (let repeat = 0; repeat < 2; repeat++) {
        expect(await ensureDevelopmentAuthProfiles()).toBe(true);
        expect(await prisma.space.findMany({ orderBy: { id: "asc" } })).toEqual(customized);
      }
      expect(await prisma.ideaSpace.findMany({ where: { ideaId: created.idea.id } }))
        .toEqual([{ ideaId: created.idea.id, spaceId: berlin.id }]);

      for (const space of customized.filter(({ retiredAt }) => retiredAt === null)) {
        expect((await authorizedRequest(`/api/spaces/${space.id}`, signedIn.token!, {
          method: "DELETE",
        })).status).toBe(204);
      }
      const retired = await prisma.space.findMany({ orderBy: { id: "asc" } });
      expect(await ensureDevelopmentAuthProfiles()).toBe(true);
      expect(await prisma.space.findMany({ orderBy: { id: "asc" } })).toEqual(retired);
      const afterRetirement = await authorizedRequest("/api/bootstrap", signedIn.token!);
      expect(afterRetirement.status).toBe(200);
      expect(((await afterRetirement.json()) as { data: { spaces: unknown[] } }).data.spaces)
        .toEqual([]);
    });
  });

  test("development startup preserves an existing custom category catalog", async () => {
    await prisma.category.update({
      where: { id: "category-food" },
      data: { name: "Our favorites", sortOrder: 99 },
    });
    const initial = await prisma.category.findMany();
    await withDevAuthEnvironment("development", true, async () => {
      expect(await ensureDevelopmentAuthProfiles()).toBe(true);
      expect(await prisma.category.findMany()).toEqual(initial);
    });
  });

  test("development auth startup provisioning is disabled in production", async () => {
    await resetDatabase();

    await withDevAuthEnvironment("production", false, async () => {
      expect(await ensureDevelopmentAuthProfiles()).toBe(false);
      expect(await prisma.category.count()).toBe(0);
      expect(await prisma.userProfile.count()).toBe(0);
      expect((await app.request("http://duodate.test/api/dev/auth/session")).status).toBe(404);
    });
  });

  test("development auth bypass lists both fixed profiles and issues ordinary sessions", async () => {
    await withDevAuthEnvironment("development", true, async () => {
      const listResponse = await app.request("http://duodate.test/api/dev/auth/session");
      expect(listResponse.status).toBe(200);
      expect(await listResponse.json()).toEqual({
        data: {
          profiles: [
            { profile: "ONE", displayName: "Pablo Test" },
            { profile: "TWO", displayName: "Luane Test" },
          ],
        },
      });

      for (const [profile, userId, displayName, deviceLabel] of [
        ["ONE", env.DUODATE_USER_ONE_ID, "Pablo Test", "Dev phone one"],
        ["TWO", env.DUODATE_USER_TWO_ID, "Luane Test", "Dev phone two"],
      ] as const) {
        const signedIn = await devSignIn(profile, deviceLabel);
        expect(signedIn.response.status).toBe(201);
        expect(Object.keys(signedIn.body)).toEqual(["data"]);
        expect(signedIn.body.data).toMatchObject({
          user: { id: userId, displayName },
          household: { id: env.DUODATE_HOUSEHOLD_ID, defaultTimeZone: "Europe/Berlin" },
        });
        expect(signedIn.token).toBeString();

        const storedSession = await prisma.authSession.findUniqueOrThrow({
          where: { id: signedIn.body.data!.session.id },
        });
        expect(storedSession.userId).toBe(userId);
        expect(storedSession.deviceLabel).toBe(deviceLabel);
        expect(storedSession.isDevelopmentBypass).toBe(true);
        expect(storedSession.tokenHash).toBe(hashSessionToken(signedIn.token!));
        expect(storedSession.tokenHash).not.toBe(signedIn.token);

        const bootstrap = await authorizedRequest("/api/bootstrap", signedIn.token!);
        expect(bootstrap.status).toBe(200);
        expect((await bootstrap.json()) as { data: { user: { id: string } } }).toMatchObject({
          data: { user: { id: userId } },
        });
      }
    });
  });

  test("development auth bypass rejects unknown and caller-controlled profile selectors", async () => {
    await withDevAuthEnvironment("development", true, async () => {
      const invalidBodies = [
        { profile: "THREE" },
        { profile: env.DUODATE_USER_ONE_ID },
        { profile: "ONE", userId: env.DUODATE_USER_TWO_ID },
        { profile: "ONE", handle: "luane-test" },
        { profile: "ONE", displayName: "Luane Test" },
        { profile: "ONE", householdId: "other-household" },
      ];

      for (const body of invalidBodies) {
        const response = await app.request("http://duodate.test/api/dev/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: { message: "Request validation failed", code: "VALIDATION_ERROR" },
        });
      }
      expect(await prisma.authSession.count()).toBe(0);
    });
  });

  test("development auth bypass requires an enabled credentialed configured Household member", async () => {
    await withDevAuthEnvironment("development", true, async () => {
      await prisma.userProfile.update({
        where: { id: env.DUODATE_USER_ONE_ID },
        data: { disabledAt: new Date() },
      });
      expect((await devSignIn("ONE")).response.status).toBe(404);

      await prisma.userProfile.update({
        where: { id: env.DUODATE_USER_ONE_ID },
        data: { disabledAt: null },
      });
      await prisma.authCredential.delete({ where: { userId: env.DUODATE_USER_ONE_ID } });
      expect((await devSignIn("ONE")).response.status).toBe(404);

      await prisma.household.create({
        data: {
          id: "dev-auth-other-household",
          defaultTimeZone: "Europe/Lisbon",
          suggestionSeed: "dev-auth-other",
        },
      });
      await prisma.householdMember.update({
        where: { userId: env.DUODATE_USER_TWO_ID },
        data: { householdId: "dev-auth-other-household" },
      });
      expect((await devSignIn("TWO")).response.status).toBe(404);
      expect(await prisma.authSession.count()).toBe(0);
    });
  });

  test("development auth bypass attributes writes to the selected fixed profile", async () => {
    await withDevAuthEnvironment("development", true, async () => {
      const signedIn = await devSignIn("TWO");
      const created = await createIdea(signedIn.token!);
      expect(created.response.status).toBe(201);
      expect(created.idea.createdById).toBe(env.DUODATE_USER_TWO_ID);
      expect(
        await prisma.idea.findUniqueOrThrow({
          where: { id: created.idea.id },
          select: { createdById: true },
        }),
      ).toEqual({ createdById: env.DUODATE_USER_TWO_ID });
    });
  });

  test("development bypass sessions stop authorizing when the bypass is disabled", async () => {
    let developmentToken = "";
    let normalToken = "";

    await withDevAuthEnvironment("development", true, async () => {
      developmentToken = (await devSignIn("ONE")).token!;
      normalToken = (await signIn("luane-test", secondPassphrase, "normal-session-control")).token!;
      expect((await authorizedRequest("/api/bootstrap", developmentToken)).status).toBe(200);
      expect((await authorizedRequest("/api/bootstrap", normalToken)).status).toBe(200);
    });

    await withDevAuthEnvironment("development", false, async () => {
      expect((await authorizedRequest("/api/bootstrap", developmentToken)).status).toBe(401);
      expect((await authorizedRequest("/api/bootstrap", normalToken)).status).toBe(200);
    });

    await withDevAuthEnvironment("production", false, async () => {
      expect((await authorizedRequest("/api/bootstrap", developmentToken)).status).toBe(401);
      expect((await authorizedRequest("/api/bootstrap", normalToken)).status).toBe(200);
    });
  });

  test("development auth bypass cannot be enabled outside development", async () => {
    for (const nodeEnv of ["test", "production"] as const) {
      await withDevAuthEnvironment(nodeEnv, true, async () => {
        expect(
          (await app.request("http://duodate.test/api/dev/auth/session")).status,
        ).toBe(404);
        expect((await devSignIn("ONE")).response.status).toBe(404);
      });
      expect(
        envSchema.safeParse({ NODE_ENV: nodeEnv, DUODATE_DEV_AUTH_BYPASS: "true" }).success,
      ).toBe(false);
    }

    const enabledDevelopment = envSchema.safeParse({
      NODE_ENV: "development",
      DUODATE_DEV_AUTH_BYPASS: " TRUE ",
    });
    expect(enabledDevelopment.success).toBe(true);
    if (enabledDevelopment.success) {
      expect(enabledDevelopment.data.DUODATE_DEV_AUTH_BYPASS).toBe(true);
    }
    expect(
      envSchema.safeParse({ NODE_ENV: "development", DUODATE_DEV_AUTH_BYPASS: "1" }).success,
    ).toBe(false);
    expect(
      envSchema.parse({ NODE_ENV: "development" }).DUODATE_DEV_AUTH_BYPASS,
    ).toBe(true);
    expect(
      envSchema.parse({ NODE_ENV: "production" }).DUODATE_DEV_AUTH_BYPASS,
    ).toBe(false);
  });

  test("public signup does not exist", async () => {
    const response = await app.request("http://duodate.test/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: "third", passphrase: "not allowed at all" }),
    });
    expect(response.status).toBe(404);
  });

  test("authenticated identities cannot escape the configured Household boundary", async () => {
    const otherHousehold = await prisma.household.create({
      data: { id: "other-household", defaultTimeZone: "America/Bahia", suggestionSeed: "other" },
    });
    const outsider = await prisma.userProfile.create({
      data: {
        id: "outsider",
        displayName: "Outsider",
        loginHandle: "outsider",
        credential: { create: { passwordHash: firstHash } },
        memberships: { create: { householdId: otherHousehold.id } },
      },
    });
    const rawToken = "outsider-session-token";
    await prisma.authSession.create({
      data: {
        userId: outsider.id,
        tokenHash: hashSessionToken(rawToken),
        credentialVersion: 1,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const rejected = await authorizedRequest("/api/spaces", rawToken);
    expect(rejected.status).toBe(401);

    const { token } = await signIn("pablo-test", firstPassphrase, "boundary-member");
    const otherSpace = await prisma.space.create({
      data: { householdId: otherHousehold.id, name: "Private other space" },
    });
    const hidden = await authorizedRequest(`/api/spaces/${otherSpace.id}`, token!, {
      method: "PATCH",
      body: JSON.stringify({ name: "Stolen" }),
    });
    expect(hidden.status).toBe(404);
  });

  test("creator attribution cannot be forged and both members share access", async () => {
    const first = await signIn("pablo-test", firstPassphrase, "creator-first");
    const forged = await createIdea(first.token!, { createdById: env.DUODATE_USER_TWO_ID });
    expect(forged.response.status).toBe(400);

    const created = await createIdea(first.token!);
    expect(created.response.status).toBe(201);
    expect(created.idea.createdById).toBe(env.DUODATE_USER_ONE_ID);

    const second = await signIn("luane-test", secondPassphrase, "creator-second");
    const read = await authorizedRequest(`/api/ideas/${created.idea.id}`, second.token!);
    expect(read.status).toBe(200);
    const updated = await authorizedRequest(`/api/ideas/${created.idea.id}`, second.token!, {
      method: "PATCH",
      body: JSON.stringify({ title: "Dinner together, edited" }),
    });
    expect(updated.status).toBe(200);
  });

  test("SAVED Idea scope returns persisted inactive Ideas in the response envelope", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "saved-ideas");
    const active = await createIdea(token!, { title: "Saved active idea" });
    const completed = await createIdea(token!, {
      title: "Saved completed idea",
      lifecycle: "COMPLETED",
    });
    const deleted = await createIdea(token!, { title: "Deleted saved idea" });
    await prisma.idea.update({
      where: { id: deleted.idea.id },
      data: { deletedAt: new Date() },
    });

    const eligibleResponse = await authorizedRequest("/api/ideas", token!);
    const eligibleBody = (await eligibleResponse.json()) as { data: Array<{ id: string }> };
    expect(eligibleResponse.status).toBe(200);
    expect(eligibleBody.data.map(({ id }) => id)).toContain(active.idea.id);
    expect(eligibleBody.data.map(({ id }) => id)).not.toContain(completed.idea.id);

    const savedResponse = await authorizedRequest("/api/ideas?scope=SAVED", token!);
    const savedBody = (await savedResponse.json()) as {
      data: Array<{ id: string; lifecycle: string }>;
    };
    expect(savedResponse.status).toBe(200);
    expect(Object.keys(savedBody)).toEqual(["data"]);
    expect(savedBody.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: active.idea.id, lifecycle: "ACTIVE" }),
        expect.objectContaining({ id: completed.idea.id, lifecycle: "COMPLETED" }),
      ]),
    );
    expect(savedBody.data.map(({ id }) => id)).not.toContain(deleted.idea.id);
    expect(
      await prisma.idea.count({
        where: { id: { in: [active.idea.id, completed.idea.id, deleted.idea.id] } },
      }),
    ).toBe(3);
  });

  test("POST /api/ideas atomically creates occurrences and returns them in the response envelope", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "idea-occurrences-create");
    const requestBody = {
      clientRequestId: "idea-create-autumn-market-dates",
      title: "Autumn market dates",
      categoryId: "category-food",
      spaceIds: ["space-berlin"],
      destinationIds: [],
      links: [],
      availability: { mode: "SPECIFIC_OCCURRENCES" },
      occurrences: [
        {
          localDate: "2026-10-18",
          startLocalTime: "19:30",
          endLocalTime: "21:00",
          timeZone: "Europe/Berlin",
        },
        { localDate: "2026-10-19" },
      ],
    };
    const response = await authorizedRequest("/api/ideas", token!, {
      method: "POST",
      body: JSON.stringify(requestBody),
    });
    const body = (await response.json()) as {
      data: {
        id: string;
        title: string;
        availability: { mode: string };
        occurrences: Array<{
          localDate: string;
          startLocalTime: string | null;
          endLocalTime: string | null;
          timeZone: string | null;
        }>;
      };
    };

    expect(response.status).toBe(201);
    expect(Object.keys(body)).toEqual(["data"]);
    expect(body.data).toMatchObject({
      title: "Autumn market dates",
      availability: { mode: "SPECIFIC_OCCURRENCES" },
      occurrences: [
        {
          localDate: "2026-10-18",
          startLocalTime: "19:30",
          endLocalTime: "21:00",
          timeZone: "Europe/Berlin",
        },
        {
          localDate: "2026-10-19",
          startLocalTime: null,
          endLocalTime: null,
          timeZone: null,
        },
      ],
    });

    const retryResponse = await authorizedRequest("/api/ideas", token!, {
      method: "POST",
      body: JSON.stringify(requestBody),
    });
    const retryBody = (await retryResponse.json()) as { data: { id: string } };
    expect(retryResponse.status).toBe(201);
    expect(retryBody.data.id).toBe(body.data.id);

    const stored = await prisma.idea.findUniqueOrThrow({
      where: { id: body.data.id },
      include: {
        availability: true,
        occurrences: { orderBy: [{ localDate: "asc" }, { startMinute: "asc" }] },
      },
    });
    expect(stored.availability?.mode).toBe("SPECIFIC_OCCURRENCES");
    expect(stored.occurrences).toMatchObject([
      {
        localDate: "2026-10-18",
        startMinute: 19 * 60 + 30,
        endMinute: 21 * 60,
        timeZone: "Europe/Berlin",
      },
      {
        localDate: "2026-10-19",
        startMinute: null,
        endMinute: null,
        timeZone: null,
      },
    ]);
    expect(await prisma.specificOccurrence.count({ where: { ideaId: body.data.id } })).toBe(2);
    expect(await prisma.idea.count({ where: { title: "Autumn market dates" } })).toBe(1);
  });

  test("Idea recurrence is serialized explicitly, preserves same-date occurrences, and never schedules", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "idea-recurrence-contract");
    const defaulted = await createIdea(token!, { title: "No recurrence by default" });
    const defaultedRead = await authorizedRequest(`/api/ideas/${defaulted.idea.id}`, token!);
    expect(
      ((await defaultedRead.json()) as { data: { recurrence: { kind: string } } }).data.recurrence,
    ).toEqual({ kind: "NONE" });

    const response = await authorizedRequest("/api/ideas", token!, {
      method: "POST",
      body: JSON.stringify({
        title: "Saturday class",
        categoryId: "category-food",
        spaceIds: ["space-berlin"],
        destinationIds: [],
        links: [],
        availability: { mode: "ANYTIME" },
        recurrence: {
          kind: "WEEKLY",
          startDate: "2026-10-01",
          endDate: "2026-12-31",
          weekdays: ["SATURDAY", "WEDNESDAY"],
        },
        occurrences: [
          { localDate: "2026-10-03", startLocalTime: "10:00", timeZone: "Europe/Berlin" },
          { localDate: "2026-10-03", startLocalTime: "16:00", timeZone: "Europe/Berlin" },
        ],
      }),
    });
    const body = (await response.json()) as {
      data: {
        id: string;
        recurrence: {
          kind: string;
          startDate: string;
          endDate: string | null;
          weekdays: string[];
        };
        occurrences: Array<{ id: string; localDate: string; startLocalTime: string | null }>;
        image: null;
      };
    };

    expect(response.status).toBe(201);
    expect(body.data.recurrence).toEqual({
      kind: "WEEKLY",
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      weekdays: ["WEDNESDAY", "SATURDAY"],
    });
    expect(body.data.occurrences.map(({ localDate }) => localDate)).toEqual([
      "2026-10-03",
      "2026-10-03",
    ]);
    expect(new Set(body.data.occurrences.map(({ id }) => id)).size).toBe(2);
    expect(body.data.occurrences.map(({ startLocalTime }) => startLocalTime)).toEqual([
      "10:00",
      "16:00",
    ]);
    expect(body.data.image).toBeNull();
    expect(await prisma.specificOccurrence.count({ where: { ideaId: body.data.id } })).toBe(2);
    expect(await prisma.schedule.count({ where: { ideaId: body.data.id } })).toBe(0);
  });

  test("recurrence validation rejects malformed or generic recurrence payloads", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "idea-recurrence-validation");
    const invalidRecurrences = [
      {
        kind: "WEEKLY",
        startDate: "2026-10-10",
        endDate: "2026-10-01",
        weekdays: ["SATURDAY"],
      },
      { kind: "WEEKLY", startDate: "2026-10-01", weekdays: [] },
      {
        kind: "WEEKLY",
        startDate: "2026-10-01",
        weekdays: ["SATURDAY", "SATURDAY"],
      },
      {
        kind: "MONTHLY_ORDINAL_WEEKDAY",
        startDate: "2026-10-01",
        ordinal: 0,
        weekday: "SATURDAY",
      },
      { kind: "RRULE", value: "FREQ=WEEKLY" },
    ];

    for (const [index, recurrence] of invalidRecurrences.entries()) {
      const response = await authorizedRequest("/api/ideas", token!, {
        method: "POST",
        body: JSON.stringify({
          title: `Invalid recurrence ${index}`,
          spaceIds: [],
          destinationIds: [],
          links: [],
          recurrence,
        }),
      });
      expect(response.status).toBe(400);
    }
    expect(await prisma.idea.count({ where: { title: { startsWith: "Invalid recurrence" } } })).toBe(0);
  });

  test("PER_PERSON costs are normalized by the backend to totals for two", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "cost-per-person");
    const bandIdea = await createIdea(token!, { costBand: "FROM_20_TO_50" });
    const exactIdea = await createIdea(token!, {
      title: "Exact per-person cost",
      costBand: "FROM_20_TO_50",
      exactCostCents: 2_500,
    });
    expect(bandIdea.response.status).toBe(201);
    expect(exactIdea.response.status).toBe(201);

    const [storedBand, storedExact] = await Promise.all([
      prisma.idea.findUniqueOrThrow({ where: { id: bandIdea.idea.id } }),
      prisma.idea.findUniqueOrThrow({ where: { id: exactIdea.idea.id } }),
    ]);
    expect(storedBand).toMatchObject({
      costBand: "FROM_20_TO_50",
      exactCostCents: null,
      costBasisAtEntry: "PER_PERSON",
      costMinTotalCents: 4_000,
      costMaxTotalCents: 10_000,
      exactCostTotalCents: null,
    });
    expect(storedExact).toMatchObject({
      exactCostCents: 2_500,
      costBasisAtEntry: "PER_PERSON",
      costMinTotalCents: 5_000,
      costMaxTotalCents: 5_000,
      exactCostTotalCents: 5_000,
    });

    const untrusted = await createIdea(token!, {
      title: "Client-calculated cost",
      costBand: "FREE",
      costMaxTotalCents: 1,
    });
    expect(untrusted.response.status).toBe(400);
  });

  test("TOTAL_FOR_TWO costs are stored without a per-person multiplier", async () => {
    await prisma.householdSettings.update({
      where: { householdId: env.DUODATE_HOUSEHOLD_ID },
      data: { costBasis: "TOTAL_FOR_TWO" },
    });
    const { token } = await signIn("pablo-test", firstPassphrase, "cost-total-for-two");
    const bandIdea = await createIdea(token!, { costBand: "FROM_20_TO_50" });
    const exactIdea = await createIdea(token!, {
      title: "Exact total cost",
      costBand: "FROM_20_TO_50",
      exactCostCents: 2_500,
    });
    expect(bandIdea.response.status).toBe(201);
    expect(exactIdea.response.status).toBe(201);

    const [storedBand, storedExact] = await Promise.all([
      prisma.idea.findUniqueOrThrow({ where: { id: bandIdea.idea.id } }),
      prisma.idea.findUniqueOrThrow({ where: { id: exactIdea.idea.id } }),
    ]);
    expect(storedBand).toMatchObject({
      costBasisAtEntry: "TOTAL_FOR_TWO",
      costMinTotalCents: 2_000,
      costMaxTotalCents: 5_000,
      exactCostTotalCents: null,
    });
    expect(storedExact).toMatchObject({
      exactCostCents: 2_500,
      costBasisAtEntry: "TOTAL_FOR_TWO",
      costMinTotalCents: 2_500,
      costMaxTotalCents: 2_500,
      exactCostTotalCents: 2_500,
    });
  });

  test("cost bands produce ordered ceilings suitable for later maximum-budget filtering", () => {
    const normalizedCeiling = 5_000;
    const bands = [
      deriveCostFields("FREE", null, "TOTAL_FOR_TWO"),
      deriveCostFields("UNDER_20", null, "TOTAL_FOR_TWO"),
      deriveCostFields("FROM_20_TO_50", null, "TOTAL_FOR_TWO"),
      deriveCostFields("FROM_50_TO_100", null, "TOTAL_FOR_TWO"),
      deriveCostFields("FROM_100", null, "TOTAL_FOR_TWO"),
    ];

    expect(bands.map(({ costMaxTotalCents }) => costMaxTotalCents)).toEqual([
      0,
      1_999,
      5_000,
      10_000,
      null,
    ]);
    expect(
      bands.map(
        ({ costMaxTotalCents }) =>
          costMaxTotalCents !== null && costMaxTotalCents <= normalizedCeiling,
      ),
    ).toEqual([true, true, true, false, false]);
  });

  test("changing HouseholdSettings recomputes every canonical cost in one backend path", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "cost-recompute");
    const bandIdea = await createIdea(token!, { costBand: "FROM_20_TO_50" });
    const exactIdea = await createIdea(token!, {
      title: "Exact-price date",
      costBand: "UNDER_20",
      exactCostCents: 1_250,
    });

    await householdSettingsService.setCostBasis(
      env.DUODATE_HOUSEHOLD_ID,
      "TOTAL_FOR_TWO",
    );

    const stored = await prisma.idea.findMany({
      where: { id: { in: [bandIdea.idea.id, exactIdea.idea.id] } },
      orderBy: { title: "asc" },
    });
    const byId = new Map(stored.map((idea) => [idea.id, idea]));
    expect(byId.get(bandIdea.idea.id)).toMatchObject({
      costBasisAtEntry: "TOTAL_FOR_TWO",
      costMinTotalCents: 2_000,
      costMaxTotalCents: 5_000,
      exactCostTotalCents: null,
    } satisfies Partial<CostFields>);
    expect(byId.get(exactIdea.idea.id)).toMatchObject({
      exactCostCents: 1_250,
      costBasisAtEntry: "TOTAL_FOR_TWO",
      costMinTotalCents: 1_250,
      costMaxTotalCents: 1_250,
      exactCostTotalCents: 1_250,
    } satisfies Partial<CostFields>);
  });

  test("an Idea can belong to multiple editable Spaces and Categories remain editable", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "editable-records");
    const created = await createIdea(token!);
    expect(created.idea.spaces.map((space) => space.id).sort()).toEqual([
      "space-berlin",
      "space-online",
    ]);

    const spaceResponse = await authorizedRequest("/api/spaces/space-berlin", token!, {
      method: "PATCH",
      body: JSON.stringify({ name: "Berlin & nearby" }),
    });
    const categoryResponse = await authorizedRequest("/api/categories/category-food", token!, {
      method: "PATCH",
      body: JSON.stringify({ name: "Food, drinks & cafés" }),
    });
    expect(spaceResponse.status).toBe(200);
    expect(categoryResponse.status).toBe(200);
  });

  test("date-only values remain unchanged while timed values use explicit IANA zones", async () => {
    const value = calendarDateSchema.parse("2026-09-10");
    expect(String(value)).toBe("2026-09-10");

    const berlin = projectLocalTimes({
      localDate: value,
      startLocalTime: "20:00",
      timeZone: "Europe/Berlin",
    });
    const bahia = projectLocalTimes({
      localDate: value,
      startLocalTime: "20:00",
      timeZone: "America/Bahia",
    });
    expect(String(value)).toBe("2026-09-10");
    expect(berlin.startsAt?.toISOString()).not.toBe(bahia.startsAt?.toISOString());
  });

  test("future Trips are queryable and reuse Destination Ideas across visits", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "travel-test");
    const destinationResponse = await authorizedRequest("/api/destinations", token!, {
      method: "POST",
      body: JSON.stringify({ name: "Lisbon", timeZone: "Europe/Berlin", country: "Portugal" }),
    });
    const destination = ((await destinationResponse.json()) as {
      data: { id: string; timeZone: string };
    }).data;
    expect(destination.timeZone).toBe("Europe/Lisbon");

    const idea = await createIdea(token!, {
      title: "Ride tram 28",
      spaceIds: [],
      destinationIds: [destination.id],
    });
    const firstTripResponse = await authorizedRequest("/api/trips", token!, {
      method: "POST",
      body: JSON.stringify({
        destinationId: destination.id,
        name: "November in Lisbon",
        startDate: "2026-11-10",
        endDate: "2026-11-15",
      }),
    });
    const secondTripResponse = await authorizedRequest("/api/trips", token!, {
      method: "POST",
      body: JSON.stringify({
        destinationId: destination.id,
        name: "Return to Lisbon",
        startDate: "2027-04-01",
        endDate: "2027-04-05",
      }),
    });
    const firstTrip = ((await firstTripResponse.json()) as { data: { id: string } }).data;
    const secondTrip = ((await secondTripResponse.json()) as { data: { id: string } }).data;

    const planned = await authorizedRequest("/api/trips?planningDate=2026-09-01", token!);
    const plannedTrips = ((await planned.json()) as { data: Array<{ id: string }> }).data;
    expect(plannedTrips.map((trip) => trip.id)).toContain(firstTrip.id);

    const [firstView, secondView] = await Promise.all([
      authorizedRequest(`/api/trips/${firstTrip.id}`, token!),
      authorizedRequest(`/api/trips/${secondTrip.id}`, token!),
    ]);
    const firstIdeas = ((await firstView.json()) as { data: { destination: { ideas: Array<{ id: string }> } } }).data.destination.ideas;
    const secondIdeas = ((await secondView.json()) as { data: { destination: { ideas: Array<{ id: string }> } } }).data.destination.ideas;
    expect(firstIdeas.map(({ id }) => id)).toEqual([idea.idea.id]);
    expect(secondIdeas.map(({ id }) => id)).toEqual([idea.idea.id]);
    expect(await prisma.idea.count({ where: { title: "Ride tram 28" } })).toBe(1);
  });

  test("availability, occurrences, and one-active Schedule contracts preserve local semantics", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "schedule-test");
    const created = await createIdea(token!);

    const availability = await authorizedRequest(`/api/ideas/${created.idea.id}/availability`, token!, {
      method: "PUT",
      body: JSON.stringify({
        mode: "DATE_RANGE",
        rangeStartDate: "2026-10-18",
        rangeEndDate: "2026-10-20",
      }),
    });
    expect(availability.status).toBe(200);
    const availabilityData = ((await availability.json()) as { data: { rangeStartDate: string; rangeEndDate: string } }).data;
    expect(availabilityData.rangeStartDate).toBe("2026-10-18");
    expect(availabilityData.rangeEndDate).toBe("2026-10-20");

    const occurrence = await authorizedRequest(`/api/ideas/${created.idea.id}/occurrences`, token!, {
      method: "POST",
      body: JSON.stringify({
        localDate: "2026-10-18",
        startLocalTime: "20:00",
        endLocalTime: "22:15",
        timeZone: "Europe/Berlin",
      }),
    });
    expect(occurrence.status).toBe(201);
    const occurrenceData = ((await occurrence.json()) as { data: { id: string; localDate: string; startLocalTime: string } }).data;
    expect(occurrenceData.localDate).toBe("2026-10-18");
    expect(occurrenceData.startLocalTime).toBe("20:00");

    const schedule = await authorizedRequest("/api/schedules", token!, {
      method: "POST",
      body: JSON.stringify({
        ideaId: created.idea.id,
        occurrenceId: occurrenceData.id,
        scheduledDate: "2026-10-18",
        startLocalTime: "20:00",
        endLocalTime: "22:15",
        timeZone: "Europe/Berlin",
      }),
    });
    expect(schedule.status).toBe(201);
    const scheduleData = ((await schedule.json()) as {
      data: { id: string; scheduledDate: string; cleanupDueAt: string; status: string };
    }).data;
    expect(scheduleData.scheduledDate).toBe("2026-10-18");
    expect(scheduleData.status).toBe("SCHEDULED");
    expect(scheduleData.cleanupDueAt).toBe("2026-10-20T20:15:00.000Z");

    const missedTransition = await authorizedRequest(`/api/schedules/${scheduleData.id}`, token!, {
      method: "PATCH",
      body: JSON.stringify({ status: "MISSED" }),
    });
    expect(missedTransition.status).toBe(400);
    expect(
      (await prisma.schedule.findUniqueOrThrow({ where: { id: scheduleData.id } })).status,
    ).toBe("SCHEDULED");

    const duplicate = await authorizedRequest("/api/schedules", token!, {
      method: "POST",
      body: JSON.stringify({
        ideaId: created.idea.id,
        scheduledDate: "2026-10-19",
        timeZone: "Europe/Berlin",
      }),
    });
    expect(duplicate.status).toBe(409);

    const rescheduled = await authorizedRequest(`/api/schedules/${scheduleData.id}/reschedule`, token!, {
      method: "POST",
      body: JSON.stringify({
        scheduledDate: "2026-10-19",
        startLocalTime: null,
        endLocalTime: null,
      }),
    });
    expect(rescheduled.status).toBe(200);
    const rescheduledData = ((await rescheduled.json()) as {
      data: { scheduledDate: string; startLocalTime: null; cleanupDueAt: string };
    }).data;
    expect(rescheduledData.scheduledDate).toBe("2026-10-19");
    expect(rescheduledData.startLocalTime).toBeNull();
    expect(rescheduledData.cleanupDueAt).toBe("2026-10-21T22:00:00.000Z");
  });

  test("deleting an Idea cannot cascade-delete an existing historical Memory", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "history-test");
    const created = await createIdea(token!);
    const memory = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      {
        title: "Dinner together",
        startDate: "2026-09-10" as CalendarDate,
        sourceIdeaId: created.idea.id,
      },
    );

    await prisma.idea.delete({ where: { id: created.idea.id } });
    const preserved = await prisma.memory.findUnique({ where: { id: memory.id } });
    expect(preserved).not.toBeNull();
    expect(preserved?.sourceIdeaId).toBeNull();
    expect(preserved?.title).toBe("Dinner together");
  });

  test("Memory supports multiple independently authored contributions and rejects forged attribution", async () => {
    const memory = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      { title: "Shared day", startDate: "2026-09-10" as CalendarDate },
    );
    const first = await signIn("pablo-test", firstPassphrase, "memory-first");
    const second = await signIn("luane-test", secondPassphrase, "memory-second");

    const forged = await authorizedRequest(`/api/memories/${memory.id}/contributions`, first.token!, {
      method: "POST",
      body: JSON.stringify({
        kind: "TEXT",
        text: "My memory",
        authorId: env.DUODATE_USER_TWO_ID,
      }),
    });
    expect(forged.status).toBe(400);

    for (const [token, text] of [
      [first.token!, "My memory"],
      [second.token!, "My perspective"],
    ] as const) {
      const response = await authorizedRequest(`/api/memories/${memory.id}/contributions`, token, {
        method: "POST",
        body: JSON.stringify({ kind: "TEXT", text }),
      });
      expect(response.status).toBe(201);
    }

    const stored = await prisma.memory.findUnique({
      where: { id: memory.id },
      include: { contributions: { orderBy: { createdAt: "asc" } } },
    });
    expect(stored?.status).toBe("CONTENT_VALID");
    expect(stored?.contributions).toHaveLength(2);
    expect(new Set(stored?.contributions.map(({ authorId }) => authorId))).toEqual(
      new Set([env.DUODATE_USER_ONE_ID, env.DUODATE_USER_TWO_ID]),
    );
  });

  test("Device ownership always comes from the session and tokens stay private", async () => {
    const first = await signIn("pablo-test", firstPassphrase, "device-first");
    const second = await signIn("luane-test", secondPassphrase, "device-second");
    const forged = await authorizedRequest("/api/devices", first.token!, {
      method: "POST",
      body: JSON.stringify({
        installationId: "android-installation-one",
        pushToken: "ExponentPushToken[test-private-token]",
        platform: "ANDROID",
        userId: env.DUODATE_USER_TWO_ID,
      }),
    });
    expect(forged.status).toBe(400);

    const registered = await authorizedRequest("/api/devices", first.token!, {
      method: "POST",
      body: JSON.stringify({
        installationId: "android-installation-one",
        pushToken: "ExponentPushToken[test-private-token]",
        platform: "ANDROID",
      }),
    });
    expect(registered.status).toBe(201);
    const publicBody = ((await registered.json()) as { data: Record<string, unknown> }).data;
    expect(publicBody.userId).toBeUndefined();
    expect(publicBody.pushToken).toBeUndefined();
    expect(publicBody.hasPushToken).toBe(true);

    const secondList = await authorizedRequest("/api/devices", second.token!);
    expect(((await secondList.json()) as { data: unknown[] }).data).toEqual([]);
    const stored = await prisma.device.findUnique({
      where: {
        userId_installationId: {
          userId: env.DUODATE_USER_ONE_ID,
          installationId: "android-installation-one",
        },
      },
    });
    expect(stored?.userId).toBe(env.DUODATE_USER_ONE_ID);
  });
});

describe("Foundation Phase B eligibility", () => {
  test("Anytime, inclusive ranges, and specific occurrences are authoritative", async () => {
    const context = await planningContextService.resolveSpace(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      "space-berlin",
    );
    const anytimeId = await createPlanningIdea({ title: "Anytime" });
    const rangeId = await createPlanningIdea({
      title: "Range",
      availability: {
        mode: "DATE_RANGE",
        rangeStartDate: "2026-10-10",
        rangeEndDate: "2026-10-12",
      },
    });
    const occurrenceId = await createPlanningIdea({
      title: "Occurrence",
      availability: { mode: "SPECIFIC_OCCURRENCES" },
      occurrenceDates: ["2026-10-11"],
    });

    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(anytimeId),
        eligibilityRequest(context, "2026-10-11"),
      ).eligible,
    ).toBe(true);
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(rangeId),
        eligibilityRequest(context, "2026-10-12"),
      ).eligible,
    ).toBe(true);
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(rangeId),
        eligibilityRequest(context, "2026-10-13"),
      ),
    ).toMatchObject({ eligible: false, reason: "EXPIRED" });
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(occurrenceId),
        eligibilityRequest(context, "2026-10-11"),
      ).eligible,
    ).toBe(true);
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(occurrenceId),
        eligibilityRequest(context, "2026-10-12"),
      ),
    ).toMatchObject({ eligible: false, reason: "EXPIRED" });
  });

  test("weekly recurrence gates local planning dates without creating occurrences or schedules", async () => {
    const context = await planningContextService.resolveSpace(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      "space-berlin",
    );
    const ideaId = await createPlanningIdea({
      title: "Weekly Wednesday and Saturday",
      recurrence: {
        kind: "WEEKLY",
        startDate: "2026-10-01" as CalendarDate,
        endDate: "2026-12-31" as CalendarDate,
        weekdays: ["WEDNESDAY", "SATURDAY"],
      },
    });
    const idea = await loadPlanningIdea(ideaId);

    expect(evaluateIdeaEligibility(idea, eligibilityRequest(context, "2026-10-03")).eligible)
      .toBe(true);
    expect(evaluateIdeaEligibility(idea, eligibilityRequest(context, "2026-10-04"))).toMatchObject({
      eligible: false,
      reason: "UNAVAILABLE",
    });
    expect(evaluateIdeaEligibility(idea, eligibilityRequest(context, "2027-01-02"))).toMatchObject({
      eligible: false,
      reason: "EXPIRED",
    });
    expect(await prisma.specificOccurrence.count({ where: { ideaId } })).toBe(0);
    expect(await prisma.schedule.count({ where: { ideaId } })).toBe(0);
  });

  test("first-Saturday monthly recurrence participates in target-date and Trip-range eligibility", async () => {
    const destination = await prisma.destination.create({
      data: {
        id: "destination-recurring-class",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        name: "Recurring class destination",
        timeZone: "Europe/Berlin",
      },
    });
    const trip = await prisma.trip.create({
      data: {
        id: "trip-first-saturday",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        destinationId: destination.id,
        startDate: "2026-10-02",
        endDate: "2026-10-04",
      },
    });
    const ideaId = await createPlanningIdea({
      title: "First Saturday workshop",
      spaceIds: ["space-berlin"],
      destinationIds: [destination.id],
      recurrence: {
        kind: "MONTHLY_ORDINAL_WEEKDAY",
        startDate: "2026-09-01" as CalendarDate,
        endDate: null,
        ordinal: 1,
        weekday: "SATURDAY",
      },
    });
    const idea = await loadPlanningIdea(ideaId);
    const spaceContext = await planningContextService.resolveSpace(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      "space-berlin",
    );

    expect(evaluateIdeaEligibility(idea, eligibilityRequest(spaceContext, "2026-10-03")).eligible)
      .toBe(true);
    expect(evaluateIdeaEligibility(idea, eligibilityRequest(spaceContext, "2026-10-10"))).toMatchObject({
      eligible: false,
      reason: "UNAVAILABLE",
    });

    const tripContext = await planningContextService.resolveTrip(
      env.DUODATE_HOUSEHOLD_ID,
      trip.id,
    );
    expect(
      evaluateIdeaEligibility(
        idea,
        eligibilityRequest(tripContext, "2026-10-02", { mode: "TRIP_PLANNING" }),
      ).eligible,
    ).toBe(true);
    expect(await prisma.schedule.count({ where: { ideaId } })).toBe(0);
  });

  test("Space relevance, travel dormancy, lifecycle, and active Schedule rules stay separate", async () => {
    const destination = await prisma.destination.create({
      data: {
        id: "destination-lisbon",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        name: "Lisbon",
        timeZone: "Europe/Lisbon",
      },
    });
    const regularId = await createPlanningIdea({ title: "Berlin only" });
    const destinationOnlyId = await createPlanningIdea({
      title: "Lisbon only",
      spaceIds: [],
      destinationIds: [destination.id],
    });
    const mixedId = await createPlanningIdea({
      title: "Berlin and Lisbon",
      destinationIds: [destination.id],
    });
    const completedId = await createPlanningIdea({ title: "Completed", lifecycle: "COMPLETED" });
    const context: ResolvedPlanningContext = {
      kind: "ACTIVE_POOL",
      id: null,
      timeZone: "Europe/Berlin",
      isDefault: true,
    };

    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(destinationOnlyId),
        eligibilityRequest(context, "2026-09-09"),
      ).reason,
    ).toBe("OUTSIDE_CONTEXT");
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(mixedId),
        eligibilityRequest(context, "2026-09-09"),
      ).eligible,
    ).toBe(true);
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(completedId),
        eligibilityRequest(context, "2026-09-09"),
      ).reason,
    ).toBe("INACTIVE");

    await prisma.schedule.create({
      data: {
        id: "active-schedule",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        ideaId: regularId,
        createdById: env.DUODATE_USER_ONE_ID,
        scheduledDate: "2026-10-10",
        timeZone: "Europe/Berlin",
        cleanupDueAt: new Date("2026-10-13T00:00:00.000Z"),
        activeSlot: regularId,
      },
    });
    const scheduled = await loadPlanningIdea(regularId);
    expect(
      evaluateIdeaEligibility(scheduled, eligibilityRequest(context, "2026-10-10")),
    ).toMatchObject({ eligible: false, reason: "ALREADY_SCHEDULED", scheduled: true });
    expect(
      evaluateIdeaEligibility(
        scheduled,
        eligibilityRequest(context, "2026-10-10", { mode: "ACTIVE_BROWSE" }),
      ).eligible,
    ).toBe(true);
  });

  test("cost and duration filters are ceilings and exclude unknown values only when active", async () => {
    const context = await planningContextService.resolveSpace(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      "space-berlin",
    );
    const cheapId = await createPlanningIdea({ costMaxTotalCents: 4_000, durationRank: 2 });
    const exactId = await createPlanningIdea({ exactCostTotalCents: 5_000, durationRank: 4 });
    const expensiveId = await createPlanningIdea({ costMaxTotalCents: 5_001, durationRank: 5 });
    const unknownId = await createPlanningIdea();
    const filtered = eligibilityRequest(context, "2026-09-09", {
      maximumCostTotalCents: 5_000,
      maximumDurationRank: 4,
    });

    expect(evaluateIdeaEligibility(await loadPlanningIdea(cheapId), filtered).eligible).toBe(true);
    expect(evaluateIdeaEligibility(await loadPlanningIdea(exactId), filtered).eligible).toBe(true);
    expect(evaluateIdeaEligibility(await loadPlanningIdea(expensiveId), filtered).reason).toBe(
      "ABOVE_BUDGET",
    );
    expect(evaluateIdeaEligibility(await loadPlanningIdea(unknownId), filtered).reason).toBe(
      "UNKNOWN_COST",
    );
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(unknownId),
        eligibilityRequest(context, "2026-09-09"),
      ).eligible,
    ).toBe(true);
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(unknownId),
        eligibilityRequest(context, "2026-09-09", {
          maximumCostTotalCents: null,
          maximumDurationRank: 4,
        }),
      ).reason,
    ).toBe("UNKNOWN_DURATION");

    await prisma.idea.update({
      where: { id: expensiveId },
      data: { costMaxTotalCents: 5_000 },
    });
    expect(
      evaluateIdeaEligibility(await loadPlanningIdea(expensiveId), filtered).reason,
    ).toBe("TOO_LONG");
  });

  test("weather impossible excludes while good only adds preference and missing is neutral", async () => {
    const context = await planningContextService.resolveSpace(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      "space-berlin",
    );
    const goodId = await createPlanningIdea({ weather: { sunny: "GOOD" } });
    const impossibleId = await createPlanningIdea({ weather: { sunny: "IMPOSSIBLE" } });
    const neutralId = await createPlanningIdea({ weather: { sunny: "NEUTRAL" } });
    const missingId = await createPlanningIdea({ weather: null });
    const request = eligibilityRequest(context, "2026-09-09", {
      weatherConditions: ["SUNNY"],
    });

    expect(evaluateIdeaEligibility(await loadPlanningIdea(goodId), request)).toMatchObject({
      eligible: true,
      weatherScore: 1,
    });
    expect(evaluateIdeaEligibility(await loadPlanningIdea(impossibleId), request).reason).toBe(
      "WEATHER_IMPOSSIBLE",
    );
    expect(evaluateIdeaEligibility(await loadPlanningIdea(neutralId), request)).toMatchObject({
      eligible: true,
      weatherScore: 0,
    });
    expect(evaluateIdeaEligibility(await loadPlanningIdea(missingId), request)).toMatchObject({
      eligible: true,
      weatherScore: 0,
    });
  });
});

describe("Foundation Phase B travel lifecycle", () => {
  test("generic Travel Spaces stay persisted but are hidden from normal planning choices", async () => {
    const travelSpace = await prisma.space.create({
      data: {
        id: "space-generic-travel",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        name: "  tRaVeL  ",
        sortOrder: 2,
      },
    });
    const travelOnlyIdeaId = await createPlanningIdea({
      title: "Legacy generic travel idea",
      spaceIds: [travelSpace.id],
      destinationIds: [],
    });
    const activePool: ResolvedPlanningContext = {
      kind: "ACTIVE_POOL",
      id: null,
      timeZone: "Europe/Berlin",
      isDefault: true,
    };
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(travelOnlyIdeaId),
        eligibilityRequest(activePool, "2026-09-14"),
      ),
    ).toMatchObject({ eligible: false, reason: "OUTSIDE_CONTEXT" });

    const { token } = await signIn("pablo-test", firstPassphrase, "generic-travel-space");
    const spacesResponse = await authorizedRequest("/api/spaces", token!);
    const spaces = ((await spacesResponse.json()) as { data: Array<{ id: string }> }).data;
    expect(spaces.map(({ id }) => id)).not.toContain(travelSpace.id);
    const bootstrapResponse = await authorizedRequest("/api/bootstrap", token!);
    const bootstrapSpaces = ((await bootstrapResponse.json()) as {
      data: { spaces: Array<{ id: string }> };
    }).data.spaces;
    expect(bootstrapSpaces.map(({ id }) => id)).not.toContain(travelSpace.id);
    expect(await prisma.space.findUnique({ where: { id: travelSpace.id } })).not.toBeNull();

    const letsDate = await authorizedRequest("/api/lets-date", token!, {
      method: "POST",
      body: JSON.stringify({
        context: { kind: "SPACE", id: travelSpace.id },
        targetDate: "2026-09-14",
        weather: [],
      }),
    });
    expect(letsDate.status).toBe(404);
  });

  test("Trip status is derived from each Destination's local calendar date", async () => {
    const [kiritimatiDestination, honoluluDestination] = await Promise.all([
      prisma.destination.create({
        data: {
          id: "destination-status-kiritimati",
          householdId: env.DUODATE_HOUSEHOLD_ID,
          name: "Status Kiritimati",
          timeZone: "Pacific/Kiritimati",
        },
      }),
      prisma.destination.create({
        data: {
          id: "destination-status-honolulu",
          householdId: env.DUODATE_HOUSEHOLD_ID,
          name: "Status Honolulu",
          timeZone: "Pacific/Honolulu",
        },
      }),
    ]);
    const [kiritimatiTrip, honoluluTrip] = await Promise.all([
      prisma.trip.create({
        data: {
          id: "trip-status-kiritimati",
          householdId: env.DUODATE_HOUSEHOLD_ID,
          destinationId: kiritimatiDestination.id,
          startDate: "2026-09-14",
          endDate: "2026-09-14",
        },
        include: { destination: true },
      }),
      prisma.trip.create({
        data: {
          id: "trip-status-honolulu",
          householdId: env.DUODATE_HOUSEHOLD_ID,
          destinationId: honoluluDestination.id,
          startDate: "2026-09-14",
          endDate: "2026-09-14",
        },
        include: { destination: true },
      }),
    ]);
    const instant = new Date("2026-09-13T23:30:00.000Z");

    expect(tripStatusAt(kiritimatiTrip, instant)).toBe("ACTIVE");
    expect(tripStatusAt(honoluluTrip, instant)).toBe("UPCOMING");
  });

  test("Europe/Lisbon controls Trip status at its local midnight boundary", async () => {
    const destination = await prisma.destination.create({
      data: {
        id: "destination-status-lisbon",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        name: "Status Lisbon",
        timeZone: "Europe/Lisbon",
      },
    });
    await prisma.trip.create({
      data: {
        id: "trip-status-lisbon",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        destinationId: destination.id,
        startDate: "2026-09-15",
        endDate: "2026-09-15",
      },
    });

    const [trip] = await travelService.listTrips(
      env.DUODATE_HOUSEHOLD_ID,
      undefined,
      new Date("2026-09-14T23:30:00.000Z"),
    );
    expect(trip).toMatchObject({
      id: "trip-status-lisbon",
      localToday: "2026-09-15",
      status: "ACTIVE",
      isActive: true,
    });
  });

  test("Trip APIs expose backend-owned lifecycle and primary active status", async () => {
    const destination = await prisma.destination.create({
      data: {
        id: "destination-overview-status",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        name: "Overview status place",
        timeZone: "Europe/Berlin",
      },
    });
    await prisma.trip.createMany({
      data: [
        {
          id: "trip-overview-past",
          householdId: env.DUODATE_HOUSEHOLD_ID,
          destinationId: destination.id,
          startDate: "2026-08-01",
          endDate: "2026-08-03",
        },
        {
          id: "trip-overview-active",
          householdId: env.DUODATE_HOUSEHOLD_ID,
          destinationId: destination.id,
          startDate: "2026-09-10",
          endDate: "2026-09-18",
        },
        {
          id: "trip-overview-upcoming",
          householdId: env.DUODATE_HOUSEHOLD_ID,
          destinationId: destination.id,
          startDate: "2026-10-01",
          endDate: "2026-10-05",
        },
      ],
    });
    const now = new Date("2026-09-14T12:00:00.000Z");

    const overview = await travelService.listTrips(
      env.DUODATE_HOUSEHOLD_ID,
      undefined,
      now,
    );
    expect(
      overview.map(({ id, status, localToday, isPrimaryActive }) => ({
        id,
        status,
        localToday: String(localToday),
        isPrimaryActive,
      })),
    ).toEqual([
      {
        id: "trip-overview-past",
        status: "PAST",
        localToday: "2026-09-14",
        isPrimaryActive: false,
      },
      {
        id: "trip-overview-active",
        status: "ACTIVE",
        localToday: "2026-09-14",
        isPrimaryActive: true,
      },
      {
        id: "trip-overview-upcoming",
        status: "UPCOMING",
        localToday: "2026-09-14",
        isPrimaryActive: false,
      },
    ]);

    const active = await travelService.getTripForPlanning(
      env.DUODATE_HOUSEHOLD_ID,
      "trip-overview-active",
      now,
    );
    expect(active).toMatchObject({
      id: "trip-overview-active",
      status: "ACTIVE",
      isActive: true,
    });
    expect(String(active.localToday)).toBe("2026-09-14");
  });

  test("cancelling a Trip preserves history and destination Ideas while removing planning eligibility", async () => {
    const destination = await prisma.destination.create({
      data: {
        id: "destination-cancelled-trip",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        name: "Cancelled Lisbon",
        timeZone: "Europe/Lisbon",
      },
    });
    await prisma.trip.create({
      data: {
        id: "trip-preserved-past",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        destinationId: destination.id,
        startDate: "2026-06-01",
        endDate: "2026-06-05",
      },
    });
    await prisma.trip.create({
      data: {
        id: "trip-to-cancel",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        destinationId: destination.id,
        startDate: "2026-09-14",
        endDate: "2026-09-16",
      },
    });
    const reusableId = await createPlanningIdea({
      title: "Reusable after cancellation",
      spaceIds: [],
      destinationIds: [destination.id],
    });
    const expiredId = await createPlanningIdea({
      title: "Expired before return",
      spaceIds: [],
      destinationIds: [destination.id],
      availability: {
        mode: "DATE_RANGE",
        rangeStartDate: "2026-09-14",
        rangeEndDate: "2026-09-16",
      },
    });
    const now = new Date("2026-09-14T12:00:00.000Z");
    expect(
      await planningContextService.resolveDefault(
        env.DUODATE_HOUSEHOLD_ID,
        "Europe/Berlin",
        now,
      ),
    ).toMatchObject({ kind: "TRIP", id: "trip-to-cancel" });

    const { token } = await signIn("pablo-test", firstPassphrase, "cancel-trip");
    const cancellation = await authorizedRequest("/api/trips/trip-to-cancel", token!, {
      method: "DELETE",
    });
    expect(cancellation.status).toBe(204);

    const stored = await prisma.trip.findUniqueOrThrow({ where: { id: "trip-to-cancel" } });
    expect(stored.cancelledAt).toBeInstanceOf(Date);
    expect(await prisma.trip.findUnique({ where: { id: "trip-preserved-past" } })).not.toBeNull();
    expect(await prisma.destination.findUnique({ where: { id: destination.id } })).not.toBeNull();
    expect(await prisma.idea.findUnique({ where: { id: reusableId } })).not.toBeNull();

    expect(
      await planningContextService.resolveDefault(
        env.DUODATE_HOUSEHOLD_ID,
        "Europe/Berlin",
        now,
      ),
    ).toMatchObject({ kind: "ACTIVE_POOL" });
    expect(
      planningContextService.resolveTrip(env.DUODATE_HOUSEHOLD_ID, "trip-to-cancel"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const overview = await travelService.listTrips(env.DUODATE_HOUSEHOLD_ID, undefined, now);
    expect(overview.find(({ id }) => id === "trip-to-cancel")).toMatchObject({
      status: "CANCELLED",
      isActive: false,
      isCancelled: true,
    });
    expect(overview.find(({ id }) => id === "trip-to-cancel")?.cancelledAt).not.toBeNull();
    const plannable = await travelService.listTrips(
      env.DUODATE_HOUSEHOLD_ID,
      "2026-09-14",
      now,
    );
    expect(plannable.map(({ id }) => id)).not.toContain("trip-to-cancel");

    const activePool: ResolvedPlanningContext = {
      kind: "ACTIVE_POOL",
      id: null,
      timeZone: "Europe/Berlin",
      isDefault: true,
    };
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(reusableId),
        eligibilityRequest(activePool, "2026-09-14"),
      ).reason,
    ).toBe("OUTSIDE_CONTEXT");

    const laterTrip = await prisma.trip.create({
      data: {
        id: "trip-after-cancellation",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        destinationId: destination.id,
        startDate: "2027-03-01",
        endDate: "2027-03-05",
      },
    });
    const laterContext = await planningContextService.resolveTrip(
      env.DUODATE_HOUSEHOLD_ID,
      laterTrip.id,
    );
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(reusableId),
        eligibilityRequest(laterContext, "2027-03-01", { mode: "TRIP_PLANNING" }),
      ).eligible,
    ).toBe(true);
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(expiredId),
        eligibilityRequest(laterContext, "2027-03-01", { mode: "TRIP_PLANNING" }),
      ).reason,
    ).toBe("EXPIRED");
  });

  test("future Trip planning uses availability overlap without leaking into the ordinary pool", async () => {
    const destination = await prisma.destination.create({
      data: {
        id: "destination-future",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        name: "Future Lisbon",
        timeZone: "Europe/Lisbon",
      },
    });
    const trip = await prisma.trip.create({
      data: {
        id: "trip-future",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        destinationId: destination.id,
        startDate: "2026-11-10",
        endDate: "2026-11-15",
      },
    });
    const anytimeId = await createPlanningIdea({
      title: "Reusable restaurant",
      spaceIds: [],
      destinationIds: [destination.id],
    });
    const overlapId = await createPlanningIdea({
      title: "Trip exhibition",
      spaceIds: [],
      destinationIds: [destination.id],
      availability: {
        mode: "DATE_RANGE",
        rangeStartDate: "2026-11-12",
        rangeEndDate: "2026-11-20",
      },
    });
    await createPlanningIdea({
      title: "Expired exhibition",
      spaceIds: [],
      destinationIds: [destination.id],
      availability: {
        mode: "DATE_RANGE",
        rangeStartDate: "2026-10-01",
        rangeEndDate: "2026-10-18",
      },
    });
    const occurrenceId = await createPlanningIdea({
      title: "Trip performance",
      spaceIds: [],
      destinationIds: [destination.id],
      availability: { mode: "SPECIFIC_OCCURRENCES" },
      occurrenceDates: ["2026-11-14"],
    });

    const planned = await planningContextService.resolveTrip(
      env.DUODATE_HOUSEHOLD_ID,
      trip.id,
    );
    const matches = await eligibilityService.eligibleIdeas(
      eligibilityRequest(planned, "2026-11-10", { mode: "TRIP_PLANNING" }),
    );
    expect(matches.map(({ idea }) => idea.id).sort()).toEqual(
      [anytimeId, occurrenceId, overlapId].sort(),
    );

    const defaultContext = await planningContextService.resolveDefault(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      new Date("2026-09-09T12:00:00.000Z"),
    );
    expect(defaultContext.kind).toBe("ACTIVE_POOL");
    const ordinary = await eligibilityService.eligibleIdeas(
      eligibilityRequest(defaultContext, "2026-09-09"),
    );
    expect(ordinary.map(({ idea }) => idea.id)).not.toContain(anytimeId);

    await Promise.all([
      createPlanningIdea({ title: "Ordinary one" }),
      createPlanningIdea({ title: "Ordinary two" }),
      createPlanningIdea({ title: "Ordinary three" }),
    ]);
    const ordinarySuggestions = await letsDateService.suggest(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      { targetDate: "2026-09-09" as CalendarDate, weather: [] },
      new Date("2026-09-09T12:00:00.000Z"),
    );
    expect(ordinarySuggestions.context.kind).toBe("ACTIVE_POOL");
    expect(ordinarySuggestions.suggestions.map(({ idea }) => idea.id)).not.toContain(anytimeId);
  });

  test("destination-local dates activate Trips and overlapping Trips resolve deterministically", async () => {
    const destination = await prisma.destination.create({
      data: {
        id: "destination-kiritimati",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        name: "Kiritimati",
        timeZone: "Pacific/Kiritimati",
      },
    });
    const earlier = await prisma.trip.create({
      data: {
        id: "trip-z-earlier",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        destinationId: destination.id,
        startDate: "2026-09-08",
        endDate: "2026-09-10",
      },
      include: { destination: true },
    });
    const tieB = await prisma.trip.create({
      data: {
        id: "trip-b",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        destinationId: destination.id,
        startDate: "2026-09-09",
        endDate: "2026-09-11",
      },
      include: { destination: true },
    });
    const tieA = await prisma.trip.create({
      data: {
        id: "trip-a",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        destinationId: destination.id,
        startDate: "2026-09-09",
        endDate: "2026-09-12",
      },
      include: { destination: true },
    });
    const now = new Date("2026-09-08T12:30:00.000Z");

    expect(String(calendarDateInTimeZone(now, "Pacific/Kiritimati"))).toBe("2026-09-09");
    expect(selectPrimaryActiveTrip([earlier, tieB, tieA], now)?.id).toBe("trip-a");
    const onlineContext = await planningContextService.resolveSpace(
      env.DUODATE_HOUSEHOLD_ID,
      "America/Bahia",
      "space-online",
    );
    expect(onlineContext.timeZone).toBe("America/Bahia");
    const context = await planningContextService.resolveDefault(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      now,
    );
    expect(context).toMatchObject({ kind: "TRIP", id: "trip-a", isDefault: true });
  });

  test("bootstrap exposes the resolved active Trip as the default planning context", async () => {
    const now = new Date();
    const localToday = calendarDateInTimeZone(now, "Europe/Berlin");
    const destination = await prisma.destination.create({
      data: {
        id: "destination-bootstrap-active",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        name: "Bootstrap active place",
        timeZone: "Europe/Berlin",
      },
    });
    await prisma.trip.create({
      data: {
        id: "trip-bootstrap-active",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        destinationId: destination.id,
        startDate: localToday,
        endDate: localToday,
      },
    });
    const { token } = await signIn("pablo-test", firstPassphrase, "bootstrap-active-trip");
    const response = await authorizedRequest("/api/bootstrap", token!);
    const body = (await response.json()) as {
      data: {
        members: Array<{ id: string; displayName: string }>;
        defaultPlanningContext: { kind: string; id: string; isDefault: boolean };
      };
    };
    expect(response.status).toBe(200);
    expect(body.data.members).toHaveLength(2);
    expect(body.data.members).toEqual(
      expect.arrayContaining([
        { id: env.DUODATE_USER_ONE_ID, displayName: "Pablo Test" },
        { id: env.DUODATE_USER_TWO_ID, displayName: "Luane Test" },
      ]),
    );
    expect(body.data.defaultPlanningContext).toMatchObject({
      kind: "TRIP",
      id: "trip-bootstrap-active",
      isDefault: true,
    });
  });

  test("post-Trip destination Ideas stay dormant, then resurface only in a later Trip context", async () => {
    const destination = await prisma.destination.create({
      data: {
        id: "destination-return",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        name: "Return destination",
        timeZone: "Europe/Lisbon",
      },
    });
    await prisma.trip.create({
      data: {
        id: "trip-past",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        destinationId: destination.id,
        startDate: "2026-06-01",
        endDate: "2026-06-05",
      },
    });
    const reusableId = await createPlanningIdea({
      title: "Reusable place",
      spaceIds: [],
      destinationIds: [destination.id],
    });
    const mixedId = await createPlanningIdea({
      title: "Also in Berlin",
      destinationIds: [destination.id],
    });
    const expiredId = await createPlanningIdea({
      title: "Old event",
      spaceIds: [],
      destinationIds: [destination.id],
      availability: {
        mode: "DATE_RANGE",
        rangeStartDate: "2026-06-01",
        rangeEndDate: "2026-06-05",
      },
    });
    const activePool: ResolvedPlanningContext = {
      kind: "ACTIVE_POOL",
      id: null,
      timeZone: "Europe/Berlin",
      isDefault: true,
    };
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(reusableId),
        eligibilityRequest(activePool, "2026-09-09"),
      ).eligible,
    ).toBe(false);
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(mixedId),
        eligibilityRequest(activePool, "2026-09-09"),
      ).eligible,
    ).toBe(true);

    const futureTrip = await prisma.trip.create({
      data: {
        id: "trip-return",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        destinationId: destination.id,
        startDate: "2027-03-01",
        endDate: "2027-03-05",
      },
    });
    const tripContext = await planningContextService.resolveTrip(
      env.DUODATE_HOUSEHOLD_ID,
      futureTrip.id,
    );
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(reusableId),
        eligibilityRequest(tripContext, "2027-03-01", { mode: "TRIP_PLANNING" }),
      ).eligible,
    ).toBe(true);
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(expiredId),
        eligibilityRequest(tripContext, "2027-03-01", { mode: "TRIP_PLANNING" }),
      ).reason,
    ).toBe("EXPIRED");
  });

  test("Let's Date uses destination Ideas only while the matching Trip is active", async () => {
    const destination = await prisma.destination.create({
      data: {
        id: "destination-active",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        name: "Active place",
        timeZone: "Pacific/Kiritimati",
      },
    });
    await prisma.trip.create({
      data: {
        id: "trip-active",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        destinationId: destination.id,
        startDate: "2026-09-09",
        endDate: "2026-09-10",
      },
    });
    await createPlanningIdea({ spaceIds: [], destinationIds: [destination.id] });
    const activeResult = await letsDateService.suggest(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      { weather: [] },
      new Date("2026-09-08T12:30:00.000Z"),
    );
    expect(activeResult.context).toMatchObject({ kind: "TRIP", id: "trip-active", isDefault: true });
    expect(String(activeResult.targetDate)).toBe("2026-09-09");

    await prisma.trip.update({
      where: { id: "trip-active" },
      data: { startDate: "2026-11-01", endDate: "2026-11-05" },
    });
    expect(
      letsDateService.suggest(
        env.DUODATE_HOUSEHOLD_ID,
        "Europe/Berlin",
        {
          context: { kind: "TRIP", id: "trip-active" },
          targetDate: "2026-11-01" as CalendarDate,
          weather: [],
        },
        new Date("2026-09-08T12:30:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "TRIP_NOT_ACTIVE" });
  });
});

describe("Foundation Phase B missed Schedule maintenance", () => {
  test("only overdue active Schedules become MISSED, clear activeSlot, and remain historical", async () => {
    const overdueIdea = await createPlanningIdea({ title: "Overdue" });
    const futureIdea = await createPlanningIdea({ title: "Future" });
    const cancelledIdea = await createPlanningIdea({ title: "Cancelled" });
    await prisma.schedule.createMany({
      data: [
        {
          id: "schedule-overdue",
          householdId: env.DUODATE_HOUSEHOLD_ID,
          ideaId: overdueIdea,
          createdById: env.DUODATE_USER_ONE_ID,
          scheduledDate: "2026-09-01",
          timeZone: "Europe/Berlin",
          cleanupDueAt: new Date("2026-09-04T00:00:00.000Z"),
          activeSlot: overdueIdea,
        },
        {
          id: "schedule-future",
          householdId: env.DUODATE_HOUSEHOLD_ID,
          ideaId: futureIdea,
          createdById: env.DUODATE_USER_ONE_ID,
          scheduledDate: "2026-10-01",
          timeZone: "Europe/Berlin",
          cleanupDueAt: new Date("2026-10-04T00:00:00.000Z"),
          activeSlot: futureIdea,
        },
        {
          id: "schedule-cancelled",
          householdId: env.DUODATE_HOUSEHOLD_ID,
          ideaId: cancelledIdea,
          createdById: env.DUODATE_USER_ONE_ID,
          scheduledDate: "2026-09-01",
          timeZone: "Europe/Berlin",
          cleanupDueAt: new Date("2026-09-04T00:00:00.000Z"),
          status: "CANCELLED",
          activeSlot: null,
        },
      ],
    });

    expect(
      await scheduleMaintenanceService.run(
        env.DUODATE_HOUSEHOLD_ID,
        new Date("2026-09-09T00:00:00.000Z"),
      ),
    ).toEqual({ transitionedCount: 1 });
    const schedules = await prisma.schedule.findMany({ orderBy: { id: "asc" } });
    expect(schedules).toHaveLength(3);
    expect(schedules.find(({ id }) => id === "schedule-overdue")).toMatchObject({
      status: "MISSED",
      activeSlot: null,
      scheduledDate: "2026-09-01",
    });
    expect(schedules.find(({ id }) => id === "schedule-future")?.status).toBe("SCHEDULED");
    expect(schedules.find(({ id }) => id === "schedule-cancelled")?.status).toBe("CANCELLED");
    expect(
      await scheduleMaintenanceService.run(
        env.DUODATE_HOUSEHOLD_ID,
        new Date("2026-09-09T00:00:00.000Z"),
      ),
    ).toEqual({ transitionedCount: 0 });
  });

  test("bootstrap lazily runs Household maintenance", async () => {
    const ideaId = await createPlanningIdea();
    await prisma.schedule.create({
      data: {
        id: "schedule-bootstrap-maintenance",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        ideaId,
        createdById: env.DUODATE_USER_ONE_ID,
        scheduledDate: "2026-01-01",
        timeZone: "Europe/Berlin",
        cleanupDueAt: new Date("2026-01-04T00:00:00.000Z"),
        activeSlot: ideaId,
      },
    });
    const { token } = await signIn("pablo-test", firstPassphrase, "maintenance-bootstrap");
    const response = await authorizedRequest("/api/bootstrap", token!);
    expect(response.status).toBe(200);
    expect(
      await prisma.schedule.findUnique({
        where: { id: "schedule-bootstrap-maintenance" },
        select: { status: true, activeSlot: true },
      }),
    ).toEqual({ status: "MISSED", activeSlot: null });
  });

  test("a stale maintenance candidate cannot overwrite a rescheduled future deadline", async () => {
    const ideaId = await createPlanningIdea();
    await prisma.schedule.create({
      data: {
        id: "schedule-race",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        ideaId,
        createdById: env.DUODATE_USER_ONE_ID,
        scheduledDate: "2026-09-01",
        timeZone: "Europe/Berlin",
        cleanupDueAt: new Date("2026-09-04T00:00:00.000Z"),
        activeSlot: ideaId,
      },
    });
    await prisma.schedule.update({
      where: { id: "schedule-race" },
      data: {
        scheduledDate: "2026-10-01",
        cleanupDueAt: new Date("2026-10-04T00:00:00.000Z"),
      },
    });

    const changed = await prisma.$transaction((tx) =>
      markScheduleMissedIfStillDue(
        tx,
        env.DUODATE_HOUSEHOLD_ID,
        "schedule-race",
        new Date("2026-09-09T00:00:00.000Z"),
      ),
    );
    expect(changed).toBe(false);
    expect(await prisma.schedule.findUnique({ where: { id: "schedule-race" } })).toMatchObject({
      status: "SCHEDULED",
      activeSlot: ideaId,
      scheduledDate: "2026-10-01",
    });
  });

  test("released Ideas return only when authoritative eligibility still permits them", async () => {
    const destination = await prisma.destination.create({
      data: {
        id: "destination-dormant",
        householdId: env.DUODATE_HOUSEHOLD_ID,
        name: "Dormant place",
        timeZone: "Europe/Lisbon",
      },
    });
    const validId = await createPlanningIdea({ title: "Valid" });
    const expiredId = await createPlanningIdea({
      title: "Expired",
      availability: {
        mode: "DATE_RANGE",
        rangeStartDate: "2026-08-01",
        rangeEndDate: "2026-08-02",
      },
    });
    const dormantId = await createPlanningIdea({
      title: "Dormant",
      spaceIds: [],
      destinationIds: [destination.id],
    });
    await prisma.schedule.createMany({
      data: [validId, expiredId, dormantId].map((ideaId, index) => ({
        id: `release-${index}`,
        householdId: env.DUODATE_HOUSEHOLD_ID,
        ideaId,
        createdById: env.DUODATE_USER_ONE_ID,
        scheduledDate: "2026-09-01",
        timeZone: "Europe/Berlin",
        cleanupDueAt: new Date("2026-09-04T00:00:00.000Z"),
        activeSlot: ideaId,
      })),
    });
    await scheduleMaintenanceService.run(
      env.DUODATE_HOUSEHOLD_ID,
      new Date("2026-09-09T00:00:00.000Z"),
    );
    const context: ResolvedPlanningContext = {
      kind: "ACTIVE_POOL",
      id: null,
      timeZone: "Europe/Berlin",
      isDefault: true,
    };

    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(validId),
        eligibilityRequest(context, "2026-09-09"),
      ).eligible,
    ).toBe(true);
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(expiredId),
        eligibilityRequest(context, "2026-09-09"),
      ).reason,
    ).toBe("EXPIRED");
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(dormantId),
        eligibilityRequest(context, "2026-09-09"),
      ).reason,
    ).toBe("OUTSIDE_CONTEXT");
  });
});

describe("Foundation Phase B Let's Date", () => {
  test("persists exactly three unique deterministic suggestions for the same normalized request", async () => {
    for (let index = 0; index < 5; index += 1) {
      await createPlanningIdea({ title: `Choice ${index}` });
    }
    const request = {
      context: { kind: "SPACE" as const, id: "space-berlin" },
      targetDate: "2026-09-12" as CalendarDate,
      weather: ["RAINY" as const, "SUNNY" as const],
    };
    const originalRandom = Math.random;
    Math.random = () => {
      throw new Error("Let's Date must not use Math.random");
    };
    try {
      const first = await letsDateService.suggest(
        env.DUODATE_HOUSEHOLD_ID,
        "Europe/Berlin",
        request,
      );
      const second = await letsDateService.suggest(
        env.DUODATE_HOUSEHOLD_ID,
        "Europe/Berlin",
        { ...request, weather: ["SUNNY", "RAINY"] },
      );
      expect(first.status).toBe("READY");
      expect(first.suggestions).toHaveLength(3);
      expect(new Set(first.suggestions.map(({ idea }) => idea.id)).size).toBe(3);
      expect(second.suggestions.map(({ idea, position }) => [position, idea.id])).toEqual(
        first.suggestions.map(({ idea, position }) => [position, idea.id]),
      );
      expect(await prisma.suggestionSet.count()).toBe(1);
    } finally {
      Math.random = originalRandom;
    }
  });

  test("date and normalized filters create distinct set identities", async () => {
    for (let index = 0; index < 4; index += 1) {
      await createPlanningIdea({
        title: `Filtered ${index}`,
        costMaxTotalCents: 2_000,
        durationRank: 2,
      });
    }
    const base = {
      context: { kind: "SPACE" as const, id: "space-berlin" },
      targetDate: "2026-09-12" as CalendarDate,
      weather: [] as Array<"SUNNY">,
    };
    await letsDateService.suggest(env.DUODATE_HOUSEHOLD_ID, "Europe/Berlin", base);
    await letsDateService.suggest(env.DUODATE_HOUSEHOLD_ID, "Europe/Berlin", {
      ...base,
      targetDate: "2026-09-13" as CalendarDate,
    });
    await letsDateService.suggest(env.DUODATE_HOUSEHOLD_ID, "Europe/Berlin", {
      ...base,
      maximumDuration: "HALF_DAY",
    });
    await letsDateService.suggest(env.DUODATE_HOUSEHOLD_ID, "Europe/Berlin", {
      ...base,
      maximumBudget: { kind: "EXACT", exactCostCents: 2_500 },
    });
    await householdSettingsService.setCostBasis(
      env.DUODATE_HOUSEHOLD_ID,
      "TOTAL_FOR_TWO",
    );
    await letsDateService.suggest(env.DUODATE_HOUSEHOLD_ID, "Europe/Berlin", base);
    expect(await prisma.suggestionSet.count()).toBe(5);
    const hashes = await prisma.suggestionSet.findMany({ select: { filterHash: true } });
    expect(new Set(hashes.map(({ filterHash }) => filterHash)).size).toBe(5);
  });

  test("weather GOOD deterministically outranks neutral without becoming a requirement", async () => {
    const goodId = await createPlanningIdea({ title: "Sunny favorite", weather: { sunny: "GOOD" } });
    const neutralIds = await Promise.all([
      createPlanningIdea({ title: "Neutral one" }),
      createPlanningIdea({ title: "Neutral two" }),
      createPlanningIdea({ title: "Neutral three" }),
    ]);
    const result = await letsDateService.suggest(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      {
        context: { kind: "SPACE", id: "space-berlin" },
        targetDate: "2026-09-12" as CalendarDate,
        weather: ["SUNNY"],
      },
    );
    expect(result.suggestions[0]?.idea.id).toBe(goodId);
    expect(result.suggestions.some(({ idea }) => neutralIds.includes(idea.id))).toBe(true);
  });

  test("insufficient matches return all hard-filtered matches without duplication or relaxation", async () => {
    const cheapId = await createPlanningIdea({
      title: "Fits",
      costMaxTotalCents: 4_000,
      durationRank: 2,
    });
    await createPlanningIdea({ title: "Too costly", costMaxTotalCents: 4_001, durationRank: 2 });
    await createPlanningIdea({ title: "Unknown cost", durationRank: 2 });
    await createPlanningIdea({ title: "Too long", costMaxTotalCents: 4_000, durationRank: 5 });
    await createPlanningIdea({
      title: "Rain impossible",
      costMaxTotalCents: 4_000,
      durationRank: 2,
      weather: { rainy: "IMPOSSIBLE" },
    });

    const result = await letsDateService.suggest(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      {
        context: { kind: "SPACE", id: "space-berlin" },
        targetDate: "2026-09-12" as CalendarDate,
        maximumBudget: { kind: "EXACT", exactCostCents: 2_000 },
        maximumDuration: "HALF_DAY",
        weather: ["RAINY"],
      },
    );
    expect(result).toMatchObject({
      status: "INSUFFICIENT_MATCHES",
      requestedCount: 3,
      matchCount: 1,
      missingPositions: [2, 3],
    });
    expect(result.suggestions.map(({ idea }) => idea.id)).toEqual([cheapId]);
    expect(new Set(result.suggestions.map(({ idea }) => idea.id)).size).toBe(1);
  });

  test("scheduling a persisted suggestion keeps its position and marks it scheduled", async () => {
    for (let index = 0; index < 4; index += 1) {
      await createPlanningIdea({ title: `Stable ${index}` });
    }
    const request = {
      context: { kind: "SPACE" as const, id: "space-berlin" },
      targetDate: "2026-10-12" as CalendarDate,
      weather: [],
    };
    const first = await letsDateService.suggest(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      request,
    );
    const scheduledSuggestion = first.suggestions[1]!;
    await prisma.schedule.create({
      data: {
        householdId: env.DUODATE_HOUSEHOLD_ID,
        ideaId: scheduledSuggestion.idea.id,
        createdById: env.DUODATE_USER_ONE_ID,
        scheduledDate: "2026-10-12",
        timeZone: "Europe/Berlin",
        cleanupDueAt: new Date("2026-10-15T00:00:00.000Z"),
        activeSlot: scheduledSuggestion.idea.id,
      },
    });
    const second = await letsDateService.suggest(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      request,
    );
    expect(second.suggestions.map(({ idea }) => idea.id)).toEqual(
      first.suggestions.map(({ idea }) => idea.id),
    );
    expect(second.suggestions[1]).toMatchObject({
      position: scheduledSuggestion.position,
      scheduled: true,
    });
  });

  test("deletion and expiration replace only invalid positions while survivors stay fixed", async () => {
    for (let index = 0; index < 6; index += 1) {
      await createPlanningIdea({ title: `Repair ${index}` });
    }
    const request = {
      context: { kind: "SPACE" as const, id: "space-berlin" },
      targetDate: "2026-10-12" as CalendarDate,
      weather: [],
    };
    const initial = await letsDateService.suggest(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      request,
    );
    const initialByPosition = new Map(
      initial.suggestions.map(({ position, idea }) => [position, idea.id]),
    );
    await prisma.idea.update({
      where: { id: initialByPosition.get(2)! },
      data: { deletedAt: new Date() },
    });
    const afterDelete = await letsDateService.suggest(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      request,
    );
    expect(afterDelete.suggestions.find(({ position }) => position === 1)?.idea.id).toBe(
      initialByPosition.get(1),
    );
    expect(afterDelete.suggestions.find(({ position }) => position === 3)?.idea.id).toBe(
      initialByPosition.get(3),
    );
    expect(afterDelete.suggestions.find(({ position }) => position === 2)?.idea.id).not.toBe(
      initialByPosition.get(2),
    );

    const positionOneId = afterDelete.suggestions.find(({ position }) => position === 1)!.idea.id;
    await prisma.availability.update({
      where: { ideaId: positionOneId },
      data: {
        mode: "DATE_RANGE",
        rangeStartDate: "2026-09-01",
        rangeEndDate: "2026-09-02",
      },
    });
    const afterExpiry = await letsDateService.suggest(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      request,
    );
    expect(afterExpiry.suggestions.find(({ position }) => position === 1)?.idea.id).not.toBe(
      positionOneId,
    );
    expect(afterExpiry.suggestions.find(({ position }) => position === 2)?.idea.id).toBe(
      afterDelete.suggestions.find(({ position }) => position === 2)?.idea.id,
    );
    expect(afterExpiry.suggestions.find(({ position }) => position === 3)?.idea.id).toBe(
      initialByPosition.get(3),
    );
  });

  test("saved cost, duration, weather, and context constraints invalidate changed Ideas", async () => {
    for (let index = 0; index < 8; index += 1) {
      await createPlanningIdea({
        title: `Constraint ${index}`,
        costMaxTotalCents: 4_000,
        durationRank: 2,
        weather: { sunny: "NEUTRAL" },
      });
    }
    const request = {
      context: { kind: "SPACE" as const, id: "space-berlin" },
      targetDate: "2026-10-12" as CalendarDate,
      maximumBudget: { kind: "EXACT" as const, exactCostCents: 2_000 },
      maximumDuration: "HALF_DAY" as const,
      weather: ["SUNNY" as const],
    };
    let result = await letsDateService.suggest(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      request,
    );
    const mutateAndExpectReplacement = async (
      position: number,
      mutate: (ideaId: string) => Promise<unknown>,
    ) => {
      const beforeByPosition = new Map(
        result.suggestions.map(({ position: itemPosition, idea }) => [itemPosition, idea.id]),
      );
      const previousId = beforeByPosition.get(position)!;
      await mutate(previousId);
      result = await letsDateService.suggest(
        env.DUODATE_HOUSEHOLD_ID,
        "Europe/Berlin",
        request,
      );
      expect(result.suggestions.find((item) => item.position === position)?.idea.id).not.toBe(
        previousId,
      );
      for (const survivorPosition of [1, 2, 3].filter((value) => value !== position)) {
        expect(result.suggestions.find((item) => item.position === survivorPosition)?.idea.id).toBe(
          beforeByPosition.get(survivorPosition),
        );
      }
    };

    await mutateAndExpectReplacement(1, (ideaId) =>
      prisma.idea.update({ where: { id: ideaId }, data: { costMaxTotalCents: 4_001 } }),
    );
    await mutateAndExpectReplacement(2, (ideaId) =>
      prisma.idea.update({ where: { id: ideaId }, data: { durationRank: 5 } }),
    );
    await mutateAndExpectReplacement(3, (ideaId) =>
      prisma.weatherSuitability.update({
        where: { ideaId },
        data: { sunny: "IMPOSSIBLE" },
      }),
    );
    await mutateAndExpectReplacement(1, (ideaId) =>
      prisma.ideaSpace.delete({
        where: { ideaId_spaceId: { ideaId, spaceId: "space-berlin" } },
      }),
    );
  });

  test("a missing replacement produces an inactive vacancy instead of stale or duplicate data", async () => {
    const firstId = await createPlanningIdea({ title: "Only one" });
    const secondId = await createPlanningIdea({ title: "Only two" });
    const request = {
      context: { kind: "SPACE" as const, id: "space-berlin" },
      targetDate: "2026-10-12" as CalendarDate,
      weather: [],
    };
    const initial = await letsDateService.suggest(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      request,
    );
    const removed = initial.suggestions[0]!;
    await prisma.idea.update({ where: { id: removed.idea.id }, data: { deletedAt: new Date() } });
    const repaired = await letsDateService.suggest(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      request,
    );
    expect(repaired.status).toBe("INSUFFICIENT_MATCHES");
    expect(repaired.matchCount).toBe(1);
    expect(repaired.suggestions.map(({ idea }) => idea.id)).toEqual([
      removed.idea.id === firstId ? secondId : firstId,
    ]);
    expect(repaired.missingPositions).toContain(removed.position);
    expect(new Set(repaired.suggestions.map(({ idea }) => idea.id)).size).toBe(1);
  });

  test("concurrent identical first requests converge on one persisted set", async () => {
    for (let index = 0; index < 4; index += 1) {
      await createPlanningIdea({ title: `Concurrent ${index}` });
    }
    const request = {
      context: { kind: "SPACE" as const, id: "space-berlin" },
      targetDate: "2026-10-12" as CalendarDate,
      weather: [],
    };
    const [first, second] = await Promise.all([
      letsDateService.suggest(env.DUODATE_HOUSEHOLD_ID, "Europe/Berlin", request),
      letsDateService.suggest(env.DUODATE_HOUSEHOLD_ID, "Europe/Berlin", request),
    ]);
    expect(first.suggestions.map(({ idea }) => idea.id)).toEqual(
      second.suggestions.map(({ idea }) => idea.id),
    );
    expect(await prisma.suggestionSet.count()).toBe(1);
    expect(await prisma.suggestionItem.count()).toBe(3);
  });

  test("the authenticated API exposes suggestions and no reroll route", async () => {
    await createPlanningIdea();
    const { token } = await signIn("pablo-test", firstPassphrase, "lets-date-api");
    const response = await authorizedRequest("/api/lets-date", token!, {
      method: "POST",
      body: JSON.stringify({
        context: { kind: "SPACE", id: "space-berlin" },
        targetDate: "2026-10-12",
        weather: [],
      }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()) as { data: { status: string } }).toMatchObject({
      data: { status: "INSUFFICIENT_MATCHES" },
    });

    const reroll = await authorizedRequest("/api/lets-date/reroll", token!, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(reroll.status).toBe(404);
  });
});

describe("Foundation Phase C Dated and Memory lifecycle", () => {
  test("Dated atomically completes the Schedule and Idea and creates one unresolved snapshot", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "dated-transaction");
    const ideaId = await createPlanningIdea({
      title: "Riverside dinner",
      specificLocation: "Old Harbour",
      categoryId: "category-food",
    });
    const schedule = await createTestSchedule(ideaId, { scheduledDate: "2026-10-10" });

    const forged = await authorizedRequest(`/api/schedules/${schedule.id}/dated`, token!, {
      method: "POST",
      body: JSON.stringify({ createdById: env.DUODATE_USER_TWO_ID }),
    });
    expect(forged.status).toBe(400);

    const before = Date.now();
    const response = await authorizedRequest(`/api/schedules/${schedule.id}/dated`, token!, {
      method: "POST",
      body: JSON.stringify({}),
    });
    const after = Date.now();
    expect(response.status).toBe(200);
    const memoryResponse = ((await response.json()) as {
      data: {
        id: string;
        title: string;
        locationSnapshot: string | null;
        categorySnapshot: string | null;
        startDate: string;
        status: string;
        captureDueAt: string;
        resolvedAt: string | null;
        createdById: string;
        contributionCount: number;
      };
    }).data;

    expect(memoryResponse).toMatchObject({
      title: "Riverside dinner",
      locationSnapshot: "Old Harbour",
      categorySnapshot: "Food & Drink",
      startDate: "2026-10-10",
      status: "CAPTURE_REQUIRED",
      resolvedAt: null,
      createdById: env.DUODATE_USER_ONE_ID,
      contributionCount: 0,
    });
    const captureDueAt = new Date(memoryResponse.captureDueAt).getTime();
    expect(captureDueAt).toBeGreaterThanOrEqual(before + 48 * 60 * 60 * 1000);
    expect(captureDueAt).toBeLessThanOrEqual(after + 48 * 60 * 60 * 1000);

    expect(await prisma.schedule.findUnique({ where: { id: schedule.id } })).toMatchObject({
      status: "COMPLETED",
      activeSlot: null,
      scheduledDate: "2026-10-10",
    });
    expect(await prisma.idea.findUnique({ where: { id: ideaId } })).toMatchObject({
      lifecycle: "COMPLETED",
      deletedAt: null,
    });
    expect(await prisma.memory.count({ where: { sourceScheduleId: schedule.id } })).toBe(1);

    const scheduleAgainBeforeDoAgain = await authorizedRequest("/api/schedules", token!, {
      method: "POST",
      body: JSON.stringify({
        ideaId,
        scheduledDate: "2026-10-20",
        timeZone: "Europe/Berlin",
      }),
    });
    expect(scheduleAgainBeforeDoAgain.status).toBe(400);

    const repeated = await authorizedRequest(`/api/schedules/${schedule.id}/dated`, token!, {
      method: "POST",
    });
    expect(repeated.status).toBe(200);
    expect(((await repeated.json()) as { data: { id: string } }).data.id).toBe(memoryResponse.id);
    expect(await prisma.memory.count({ where: { sourceScheduleId: schedule.id } })).toBe(1);
  });

  test("concurrent Dated requests converge on the same Memory", async () => {
    const ideaId = await createPlanningIdea({ title: "Concurrent date" });
    const schedule = await createTestSchedule(ideaId);
    const now = new Date("2026-10-11T12:00:00.000Z");

    const [first, second] = await Promise.all([
      datedService.dateSchedule(
        env.DUODATE_HOUSEHOLD_ID,
        env.DUODATE_USER_ONE_ID,
        schedule.id,
        now,
      ),
      datedService.dateSchedule(
        env.DUODATE_HOUSEHOLD_ID,
        env.DUODATE_USER_TWO_ID,
        schedule.id,
        now,
      ),
    ]);

    expect(first.id).toBe(second.id);
    expect(await prisma.memory.count({ where: { sourceScheduleId: schedule.id } })).toBe(1);
    expect(await prisma.schedule.findUnique({ where: { id: schedule.id } })).toMatchObject({
      status: "COMPLETED",
      activeSlot: null,
    });
  });

  test("cancelled, missed, and cross-Household Schedules cannot be marked Dated", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "dated-conflicts");
    const cancelledIdeaId = await createPlanningIdea({ title: "Cancelled" });
    const cancelled = await createTestSchedule(cancelledIdeaId, { status: "CANCELLED" });
    const cancelledResponse = await authorizedRequest(`/api/schedules/${cancelled.id}/dated`, token!, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(cancelledResponse.status).toBe(409);
    expect(((await cancelledResponse.json()) as { error: { code: string } }).error.code).toBe(
      "SCHEDULE_CANCELLED",
    );

    const missedIdeaId = await createPlanningIdea({ title: "Missed" });
    const missed = await createTestSchedule(missedIdeaId, { status: "MISSED" });
    const missedResponse = await authorizedRequest(`/api/schedules/${missed.id}/dated`, token!, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(missedResponse.status).toBe(409);
    expect(((await missedResponse.json()) as { error: { code: string } }).error.code).toBe(
      "SCHEDULE_MISSED",
    );

    await prisma.household.create({
      data: { id: "foreign-household", suggestionSeed: "foreign-seed" },
    });
    const foreignIdea = await prisma.idea.create({
      data: {
        householdId: "foreign-household",
        createdById: env.DUODATE_USER_ONE_ID,
        title: "Foreign date",
      },
    });
    const foreignSchedule = await createTestSchedule(foreignIdea.id, {
      householdId: "foreign-household",
    });
    const foreignResponse = await authorizedRequest(
      `/api/schedules/${foreignSchedule.id}/dated`,
      token!,
      { method: "POST", body: JSON.stringify({}) },
    );
    expect(foreignResponse.status).toBe(404);
    expect(await prisma.memory.count({ where: { sourceScheduleId: foreignSchedule.id } })).toBe(0);
  });

  test("missed maintenance and Dated have one coherent winner", async () => {
    const ideaId = await createPlanningIdea({ title: "Maintenance race" });
    const schedule = await createTestSchedule(ideaId, {
      cleanupDueAt: new Date("2026-09-10T12:00:00.000Z"),
    });
    const now = new Date("2026-09-10T12:00:00.000Z");

    const result = await Promise.allSettled([
      datedService.dateSchedule(
        env.DUODATE_HOUSEHOLD_ID,
        env.DUODATE_USER_ONE_ID,
        schedule.id,
        now,
      ),
      scheduleMaintenanceService.run(env.DUODATE_HOUSEHOLD_ID, now),
    ]);
    const storedSchedule = await prisma.schedule.findUniqueOrThrow({ where: { id: schedule.id } });
    const memoryCount = await prisma.memory.count({ where: { sourceScheduleId: schedule.id } });

    expect(["COMPLETED", "MISSED"]).toContain(storedSchedule.status);
    expect(memoryCount).toBe(storedSchedule.status === "COMPLETED" ? 1 : 0);
    expect(storedSchedule.activeSlot).toBeNull();
    expect(result.some((entry) => entry.status === "fulfilled")).toBe(true);
  });

  test("Memory snapshots and contributions survive later Idea edits and deletion", async () => {
    const ideaId = await createPlanningIdea({
      title: "Original title",
      specificLocation: "Original place",
      categoryId: "category-food",
    });
    const schedule = await createTestSchedule(ideaId);
    const memory = await datedService.dateSchedule(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      schedule.id,
      new Date("2026-10-11T12:00:00.000Z"),
    );
    await memoryService.addContribution(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_TWO_ID,
      memory.id,
      { kind: "TEXT", text: "A lasting memory", sortOrder: 0 },
    );

    await prisma.idea.update({
      where: { id: ideaId },
      data: {
        title: "Changed title",
        specificLocation: "Changed place",
        categoryId: null,
        deletedAt: new Date(),
      },
    });
    const preserved = await prisma.memory.findUniqueOrThrow({
      where: { id: memory.id },
      include: { contributions: true },
    });

    expect(preserved).toMatchObject({
      title: "Original title",
      locationSnapshot: "Original place",
      categorySnapshot: "Food & Drink",
      startDate: schedule.scheduledDate,
    });
    expect(preserved.contributions).toHaveLength(1);
    expect(preserved.contributions[0]?.text).toBe("A lasting memory");
    expect(await prisma.schedule.findUnique({ where: { id: schedule.id } })).toMatchObject({
      status: "COMPLETED",
      ideaId,
    });
  });

  test("written contribution CRUD preserves authorship and recalculates capture state", async () => {
    const first = await signIn("pablo-test", firstPassphrase, "contribution-first");
    const second = await signIn("luane-test", secondPassphrase, "contribution-second");
    const ideaId = await createPlanningIdea({ title: "Writing together" });
    const schedule = await createTestSchedule(ideaId);
    const memory = await datedService.dateSchedule(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      schedule.id,
      new Date("2026-10-11T12:00:00.000Z"),
    );
    const originalDueAt = memory.captureDueAt!.toISOString();

    const whitespace = await authorizedRequest(`/api/memories/${memory.id}/contributions`, first.token!, {
      method: "POST",
      body: JSON.stringify({ kind: "TEXT", text: "   " }),
    });
    expect(whitespace.status).toBe(400);

    const forged = await authorizedRequest(`/api/memories/${memory.id}/contributions`, first.token!, {
      method: "POST",
      body: JSON.stringify({
        kind: "TEXT",
        text: "First perspective",
        authorId: env.DUODATE_USER_TWO_ID,
      }),
    });
    expect(forged.status).toBe(400);

    const firstResponse = await authorizedRequest(
      `/api/memories/${memory.id}/contributions`,
      first.token!,
      { method: "POST", body: JSON.stringify({ kind: "TEXT", text: "  First perspective  " }) },
    );
    expect(firstResponse.status).toBe(201);
    const firstData = ((await firstResponse.json()) as {
      data: {
        contribution: { id: string; authorId: string; text: string };
        memory: { status: string; resolvedAt: string };
      };
    }).data;
    expect(firstData.contribution).toMatchObject({
      authorId: env.DUODATE_USER_ONE_ID,
      text: "First perspective",
    });
    expect(firstData.memory.status).toBe("CONTENT_VALID");
    const firstResolvedAt = firstData.memory.resolvedAt;

    const secondResponse = await authorizedRequest(
      `/api/memories/${memory.id}/contributions`,
      second.token!,
      { method: "POST", body: JSON.stringify({ kind: "TEXT", text: "Second perspective" }) },
    );
    expect(secondResponse.status).toBe(201);
    const secondData = ((await secondResponse.json()) as {
      data: {
        contribution: { id: string; authorId: string };
        memory: { resolvedAt: string };
      };
    }).data;
    expect(secondData.contribution.authorId).toBe(env.DUODATE_USER_TWO_ID);
    expect(secondData.memory.resolvedAt).toBe(firstResolvedAt);

    const forgedEdit = await authorizedRequest(
      `/api/memories/${memory.id}/contributions/${firstData.contribution.id}`,
      second.token!,
      {
        method: "PATCH",
        body: JSON.stringify({ text: "Edited together", authorId: env.DUODATE_USER_TWO_ID }),
      },
    );
    expect(forgedEdit.status).toBe(400);

    const edited = await authorizedRequest(
      `/api/memories/${memory.id}/contributions/${firstData.contribution.id}`,
      second.token!,
      { method: "PATCH", body: JSON.stringify({ text: "Edited together" }) },
    );
    expect(edited.status).toBe(200);
    expect(
      await prisma.memoryContribution.findUnique({ where: { id: firstData.contribution.id } }),
    ).toMatchObject({
      authorId: env.DUODATE_USER_ONE_ID,
      text: "Edited together",
    });

    const deleteSecond = await authorizedRequest(
      `/api/memories/${memory.id}/contributions/${secondData.contribution.id}`,
      first.token!,
      { method: "DELETE" },
    );
    expect(deleteSecond.status).toBe(200);
    expect(((await deleteSecond.json()) as { data: { status: string } }).data.status).toBe(
      "CONTENT_VALID",
    );

    const deleteLast = await authorizedRequest(
      `/api/memories/${memory.id}/contributions/${firstData.contribution.id}`,
      second.token!,
      { method: "DELETE" },
    );
    expect(deleteLast.status).toBe(200);
    const unresolved = ((await deleteLast.json()) as {
      data: { status: string; resolvedAt: null; captureDueAt: string };
    }).data;
    expect(unresolved.status).toBe("CAPTURE_REQUIRED");
    expect(unresolved.resolvedAt).toBeNull();
    expect(unresolved.captureDueAt).toBe(originalDueAt);
    expect(await prisma.schedule.findUnique({ where: { id: schedule.id } })).toMatchObject({
      status: "COMPLETED",
    });
    expect(await prisma.idea.findUnique({ where: { id: ideaId } })).toMatchObject({
      lifecycle: "COMPLETED",
    });
  });

  test("text contribution idempotency replays the original without changing Memory state", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "text-idempotency-replay");
    const memory = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      { title: "Retry writing", startDate: "2026-10-10" as CalendarDate },
    );
    const clientRequestId = crypto.randomUUID();
    const post = (text: string, sortOrder: number) => authorizedRequest(
      `/api/memories/${memory.id}/contributions`, token!,
      { method: "POST", body: JSON.stringify({ kind: "TEXT", text, sortOrder, clientRequestId }) },
    );
    const first = await post("  Our lasting memory  ", 3);
    expect(first.status).toBe(201);
    const original = await first.json() as {
      data: { contribution: { id: string; text: string; sortOrder: number }; memory: { id: string; status: string; contributionCount: number } };
    };
    expect(original.data.contribution).toMatchObject({ id: clientRequestId, text: "Our lasting memory", sortOrder: 3 });
    expect(original.data.memory).toMatchObject({ id: memory.id, status: "CONTENT_VALID", contributionCount: 1 });
    const storedBefore = await prisma.memory.findUniqueOrThrow({ where: { id: memory.id } });
    const intentsBefore = await prisma.notificationIntent.findMany({ where: { memoryId: memory.id } });
    // Identity is memory + authenticated user + normalized text, not sort order.
    const replay = await post("Our lasting memory", 99);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(original);
    expect(await prisma.memory.findUniqueOrThrow({ where: { id: memory.id } })).toEqual(storedBefore);
    expect(await prisma.notificationIntent.findMany({ where: { memoryId: memory.id } })).toEqual(intentsBefore);
    expect(await prisma.memoryContribution.count({ where: { memoryId: memory.id } })).toBe(1);
  });

  test("text contribution idempotency concurrent same-key POSTs return one contribution", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "text-idempotency-concurrent");
    const memory = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      { title: "Concurrent retry", startDate: "2026-10-10" as CalendarDate },
    );
    const clientRequestId = crypto.randomUUID();
    const responses = await Promise.all(Array.from({ length: 6 }, () => authorizedRequest(
      `/api/memories/${memory.id}/contributions`, token!,
      { method: "POST", body: JSON.stringify({ kind: "TEXT", text: "One shared request", clientRequestId }) },
    )));
    expect(responses.map(({ status }) => status)).toEqual(Array(6).fill(201));
    const bodies = await Promise.all(responses.map((response) => response.json()));
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    const stored = await prisma.memory.findUniqueOrThrow({ where: { id: memory.id }, include: { contributions: true } });
    expect(stored.status).toBe("CONTENT_VALID");
    expect(stored.resolvedAt).not.toBeNull();
    expect(stored.contributions).toHaveLength(1);
    expect(stored.contributions[0]).toMatchObject({ id: clientRequestId, text: "One shared request", authorId: env.DUODATE_USER_ONE_ID });
  });

  test("text contribution idempotency rejects reused keys for different text, user or Memory", async () => {
    const first = await signIn("pablo-test", firstPassphrase, "text-idempotency-conflict-one");
    const second = await signIn("luane-test", secondPassphrase, "text-idempotency-conflict-two");
    const memory = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID, env.DUODATE_USER_ONE_ID,
      { title: "Original request", startDate: "2026-10-10" as CalendarDate },
    );
    const otherMemory = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID, env.DUODATE_USER_ONE_ID,
      { title: "Another memory", startDate: "2026-10-10" as CalendarDate },
    );
    const clientRequestId = crypto.randomUUID();
    const original = await memoryService.addContribution(
      env.DUODATE_HOUSEHOLD_ID, env.DUODATE_USER_ONE_ID, memory.id,
      { kind: "TEXT", text: "Original text", sortOrder: 0, clientRequestId },
    );
    const storedBefore = await prisma.memory.findUniqueOrThrow({ where: { id: memory.id } });
    for (const [id, token, text] of [
      [memory.id, first.token!, "Different text"],
      [memory.id, second.token!, "Original text"],
      [otherMemory.id, first.token!, "Original text"],
    ]) {
      const response = await authorizedRequest(`/api/memories/${id}/contributions`, token!, {
        method: "POST", body: JSON.stringify({ kind: "TEXT", text, clientRequestId }),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: {
        code: "CLIENT_REQUEST_ID_CONFLICT",
        message: "Client request ID has already been used for a different contribution",
      } });
    }
    expect(await prisma.memoryContribution.count()).toBe(1);
    expect(await prisma.memoryContribution.findUniqueOrThrow({ where: { id: clientRequestId }, include: { author: { select: { id: true, displayName: true } } } })).toEqual(original.contribution);
    expect(await prisma.memory.findUniqueOrThrow({ where: { id: memory.id } })).toEqual(storedBefore);
    expect(await prisma.memory.findUniqueOrThrow({ where: { id: otherMemory.id } })).toMatchObject({ status: "CAPTURE_REQUIRED", resolvedAt: null });
  });

  test("text contribution idempotency concurrent conflicting requests preserve the winner", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "text-idempotency-race-conflict");
    const memory = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID, env.DUODATE_USER_ONE_ID,
      { title: "Conflicting retries", startDate: "2026-10-10" as CalendarDate },
    );
    const clientRequestId = crypto.randomUUID();
    const responses = await Promise.all(["First text", "Second text"].map((text) => authorizedRequest(
      `/api/memories/${memory.id}/contributions`, token!,
      { method: "POST", body: JSON.stringify({ kind: "TEXT", text, clientRequestId }) },
    )));
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    const winner = await responses.find(({ status }) => status === 201)!.json() as { data: { contribution: { id: string; text: string } } };
    const loser = await responses.find(({ status }) => status === 409)!.json() as { error: { code: string } };
    expect(loser.error.code).toBe("CLIENT_REQUEST_ID_CONFLICT");
    expect(await prisma.memoryContribution.count({ where: { memoryId: memory.id } })).toBe(1);
    expect(await prisma.memoryContribution.findUniqueOrThrow({ where: { id: clientRequestId } })).toMatchObject({
      id: winner.data.contribution.id, text: winner.data.contribution.text,
    });
  });

  test("text contribution idempotency resolves a uniqueness race outside the rolled-back transaction", async () => {
    const memory = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID, env.DUODATE_USER_ONE_ID,
      { title: "External insert race", startDate: "2026-10-10" as CalendarDate },
    );
    const clientRequestId = crypto.randomUUID();
    // Insert an actual DB winner after the replay lookup misses, as another
    // process could do. The create then hits the real primary-key constraint.
    const transaction = prisma.$transaction;
    let injectWinner = true;
    prisma.$transaction = (async (...args: Parameters<typeof transaction>) => {
      if (injectWinner) {
        injectWinner = false;
        await transaction.call(prisma, async (tx) => {
          await tx.memoryContribution.create({ data: {
            id: clientRequestId, memoryId: memory.id, authorId: env.DUODATE_USER_ONE_ID,
            kind: "TEXT", text: "Race winner", sortOrder: 4,
          } });
          await recomputeMemoryContentState(tx, memory.id, env.DUODATE_USER_ONE_ID);
        });
      }
      return transaction.apply(prisma, args);
    }) as typeof transaction;
    try {
      const result = await memoryService.addContribution(
        env.DUODATE_HOUSEHOLD_ID, env.DUODATE_USER_ONE_ID, memory.id,
        { kind: "TEXT", text: "Race winner", sortOrder: 0, clientRequestId },
      );
      expect(result.contribution).toMatchObject({ id: clientRequestId, text: "Race winner", sortOrder: 4 });
      expect(result.memory).toMatchObject({ id: memory.id, status: "CONTENT_VALID", contributionCount: 1 });
      expect(await prisma.memoryContribution.count({ where: { memoryId: memory.id } })).toBe(1);
    } finally {
      prisma.$transaction = transaction;
    }
  });

  test("text contribution idempotency remains optional and validates UUIDs only on text POST", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "text-idempotency-legacy");
    const memory = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID, env.DUODATE_USER_ONE_ID,
      { title: "Legacy writing", startDate: "2026-10-10" as CalendarDate },
    );
    for (const clientRequestId of ["not-a-uuid", "", null]) {
      const response = await authorizedRequest(`/api/memories/${memory.id}/contributions`, token!, {
        method: "POST", body: JSON.stringify({ kind: "TEXT", text: "Legacy text", clientRequestId }),
      });
      expect(response.status).toBe(400);
    }
    expect(await prisma.memoryContribution.count({ where: { memoryId: memory.id } })).toBe(0);
    const ids: string[] = [];
    for (let index = 0; index < 2; index++) {
      const response = await authorizedRequest(`/api/memories/${memory.id}/contributions`, token!, {
        method: "POST", body: JSON.stringify({ kind: "TEXT", text: "Legacy text" }),
      });
      expect(response.status).toBe(201);
      const body = await response.json() as { data: { contribution: { id: string } } };
      ids.push(body.data.contribution.id);
    }
    expect(new Set(ids).size).toBe(2);
    expect(await prisma.memoryContribution.count({ where: { memoryId: memory.id } })).toBe(2);
    const patch = await authorizedRequest(`/api/memories/${memory.id}/contributions/${ids[0]}`, token!, {
      method: "PATCH", body: JSON.stringify({ text: "Updated", clientRequestId: crypto.randomUUID() }),
    });
    expect(patch.status).toBe(400);
    const create = await authorizedRequest("/api/memories", token!, {
      method: "POST", body: JSON.stringify({ title: "Not an idempotent endpoint", clientRequestId: crypto.randomUUID() }),
    });
    expect(create.status).toBe(400);
  });

  test("concurrent first contributions are both preserved and resolve once", async () => {
    const memory = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      { title: "Concurrent writing", startDate: "2026-10-10" as CalendarDate },
    );
    const firstNow = new Date("2026-10-11T12:00:00.000Z");
    const secondNow = new Date("2026-10-11T12:00:01.000Z");

    await Promise.all([
      memoryService.addContribution(
        env.DUODATE_HOUSEHOLD_ID,
        env.DUODATE_USER_ONE_ID,
        memory.id,
        { kind: "TEXT", text: "First", sortOrder: 0 },
        firstNow,
      ),
      memoryService.addContribution(
        env.DUODATE_HOUSEHOLD_ID,
        env.DUODATE_USER_TWO_ID,
        memory.id,
        { kind: "TEXT", text: "Second", sortOrder: 0 },
        secondNow,
      ),
    ]);

    const stored = await prisma.memory.findUniqueOrThrow({
      where: { id: memory.id },
      include: { contributions: true },
    });
    expect(stored.status).toBe("CONTENT_VALID");
    expect(stored.contributions).toHaveLength(2);
    expect(new Set(stored.contributions.map(({ authorId }) => authorId))).toEqual(
      new Set([env.DUODATE_USER_ONE_ID, env.DUODATE_USER_TWO_ID]),
    );
    expect([firstNow.toISOString(), secondNow.toISOString()]).toContain(
      stored.resolvedAt!.toISOString(),
    );
  });

  test("spontaneous Memories use Household-local dates and optional initial text", async () => {
    const localNow = new Date("2026-09-09T22:30:00.000Z");
    const empty = await memoryService.createSpontaneous(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      "Europe/Berlin",
      { title: "Late evening" },
      localNow,
    );
    expect(empty).toMatchObject({
      startDate: "2026-09-10",
      endDate: null,
      sourceIdeaId: null,
      sourceScheduleId: null,
      status: "CAPTURE_REQUIRED",
      captureDueAt: null,
      resolvedAt: null,
      contributionCount: 0,
    });

    const withText = await memoryService.createSpontaneous(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_TWO_ID,
      "Europe/Berlin",
      {
        title: "Weekend away",
        startDate: "2026-10-10" as CalendarDate,
        endDate: "2026-10-12" as CalendarDate,
        specificLocation: "Brandenburg",
        initialText: "A peaceful weekend",
      },
      localNow,
    );
    expect(withText).toMatchObject({
      startDate: "2026-10-10",
      endDate: "2026-10-12",
      locationSnapshot: "Brandenburg",
      status: "CONTENT_VALID",
      captureDueAt: null,
      createdById: env.DUODATE_USER_TWO_ID,
      contributionCount: 1,
    });
    expect(withText.contributions[0]).toMatchObject({
      authorId: env.DUODATE_USER_TWO_ID,
      text: "A peaceful weekend",
    });

    const { token } = await signIn("pablo-test", firstPassphrase, "spontaneous-api");
    const forged = await authorizedRequest("/api/memories", token!, {
      method: "POST",
      body: JSON.stringify({
        title: "Forged",
        createdById: env.DUODATE_USER_TWO_ID,
      }),
    });
    expect(forged.status).toBe(400);
    const reversed = await authorizedRequest("/api/memories", token!, {
      method: "POST",
      body: JSON.stringify({
        title: "Wrong range",
        startDate: "2026-10-12",
        endDate: "2026-10-10",
      }),
    });
    expect(reversed.status).toBe(400);
  });

  test("Memory reads and contribution writes stay Household-scoped", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "memory-ownership");
    await prisma.household.create({
      data: { id: "foreign-memory-household", suggestionSeed: "foreign-memory-seed" },
    });
    const foreignMemory = await prisma.memory.create({
      data: {
        householdId: "foreign-memory-household",
        createdById: env.DUODATE_USER_ONE_ID,
        updatedById: env.DUODATE_USER_ONE_ID,
        title: "Foreign memory",
        startDate: "2026-09-10",
      },
    });

    const read = await authorizedRequest(`/api/memories/${foreignMemory.id}`, token!);
    expect(read.status).toBe(404);
    const contribution = await authorizedRequest(
      `/api/memories/${foreignMemory.id}/contributions`,
      token!,
      { method: "POST", body: JSON.stringify({ kind: "TEXT", text: "Not ours" }) },
    );
    expect(contribution.status).toBe(404);
    expect(await prisma.memoryContribution.count({ where: { memoryId: foreignMemory.id } })).toBe(0);
  });

  test("Memory metadata edits preserve protected lifecycle and source fields", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "memory-metadata");
    const ideaId = await createPlanningIdea({ title: "Metadata source" });
    const schedule = await createTestSchedule(ideaId);
    const memory = await datedService.dateSchedule(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      schedule.id,
      new Date("2026-10-11T12:00:00.000Z"),
    );

    const forged = await authorizedRequest(`/api/memories/${memory.id}`, token!, {
      method: "PATCH",
      body: JSON.stringify({
        title: "Forged metadata",
        sourceIdeaId: "another-idea",
        status: "CONTENT_VALID",
      }),
    });
    expect(forged.status).toBe(400);

    const reversed = await authorizedRequest(`/api/memories/${memory.id}`, token!, {
      method: "PATCH",
      body: JSON.stringify({ startDate: "2026-10-12", endDate: "2026-10-11" }),
    });
    expect(reversed.status).toBe(400);

    const updated = await authorizedRequest(`/api/memories/${memory.id}`, token!, {
      method: "PATCH",
      body: JSON.stringify({
        title: "Edited memory",
        startDate: "2026-10-11",
        endDate: "2026-10-12",
        specificLocation: "New memory location",
      }),
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { data: Record<string, unknown> }).data).toMatchObject({
      title: "Edited memory",
      startDate: "2026-10-11",
      endDate: "2026-10-12",
      locationSnapshot: "New memory location",
      sourceIdeaId: ideaId,
      sourceScheduleId: schedule.id,
      status: "CAPTURE_REQUIRED",
    });
  });

  test("Do Again reuses the source Idea without changing historical records", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "do-again");
    const ideaId = await createPlanningIdea({
      title: "One-time exhibition",
      availability: {
        mode: "DATE_RANGE",
        rangeStartDate: "2026-09-01",
        rangeEndDate: "2026-09-02",
      },
    });
    const schedule = await createTestSchedule(ideaId);
    const memory = await datedService.dateSchedule(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      schedule.id,
      new Date("2026-10-11T12:00:00.000Z"),
    );
    await memoryService.addContribution(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      memory.id,
      { kind: "TEXT", text: "We went", sortOrder: 0 },
    );
    const memoryBefore = await prisma.memory.findUniqueOrThrow({ where: { id: memory.id } });
    const contributionBefore = await prisma.memoryContribution.findMany({
      where: { memoryId: memory.id },
    });

    const first = await authorizedRequest(`/api/memories/${memory.id}/do-again`, token!, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { data: { reactivated: boolean } }).data.reactivated).toBe(true);
    const second = await authorizedRequest(`/api/memories/${memory.id}/do-again`, token!, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(second.status).toBe(200);
    expect(((await second.json()) as { data: { reactivated: boolean } }).data.reactivated).toBe(false);

    expect(await prisma.idea.count({ where: { id: ideaId } })).toBe(1);
    expect(await prisma.idea.findUnique({ where: { id: ideaId } })).toMatchObject({
      lifecycle: "ACTIVE",
    });
    expect(await prisma.memory.findUniqueOrThrow({ where: { id: memory.id } })).toEqual(
      memoryBefore,
    );
    expect(await prisma.memoryContribution.findMany({ where: { memoryId: memory.id } })).toEqual(
      contributionBefore,
    );
    expect(await prisma.schedule.findUnique({ where: { id: schedule.id } })).toMatchObject({
      status: "COMPLETED",
    });

    const context = await planningContextService.resolveSpace(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      "space-berlin",
    );
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(ideaId),
        eligibilityRequest(context, "2026-10-10"),
      ),
    ).toMatchObject({ eligible: false, reason: "EXPIRED" });

    await prisma.idea.update({ where: { id: ideaId }, data: { deletedAt: new Date() } });
    const deleted = await authorizedRequest(`/api/memories/${memory.id}/do-again`, token!, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(deleted.status).toBe(409);
    expect(((await deleted.json()) as { error: { code: string } }).error.code).toBe(
      "SOURCE_IDEA_UNAVAILABLE",
    );
  });

  test("Do Again does not override destination dormancy", async () => {
    const destination = await prisma.destination.create({
      data: {
        householdId: env.DUODATE_HOUSEHOLD_ID,
        name: "Dormant destination",
        timeZone: "Europe/Lisbon",
      },
    });
    const ideaId = await createPlanningIdea({
      title: "Dormant activity",
      lifecycle: "COMPLETED",
      spaceIds: [],
      destinationIds: [destination.id],
    });
    const memory = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      {
        title: "Dormant activity",
        startDate: "2026-09-01" as CalendarDate,
        sourceIdeaId: ideaId,
      },
    );
    await memoryService.doAgain(env.DUODATE_HOUSEHOLD_ID, memory.id);

    const context = await planningContextService.resolveDefault(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      new Date("2026-09-09T12:00:00.000Z"),
    );
    expect(
      evaluateIdeaEligibility(
        await loadPlanningIdea(ideaId),
        eligibilityRequest(context, "2026-09-09"),
      ),
    ).toMatchObject({ eligible: false, reason: "OUTSIDE_CONTEXT" });
  });

  test("unresolved Memory filtering exposes derived overdue state without executing reminders", async () => {
    const overdue = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      {
        title: "Overdue capture",
        startDate: "2026-09-01" as CalendarDate,
        captureDueAt: new Date("2026-09-03T00:00:00.000Z"),
      },
    );
    const spontaneous = await memoryService.createSpontaneous(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_TWO_ID,
      "Europe/Berlin",
      { title: "No deadline" },
      new Date("2026-09-04T12:00:00.000Z"),
    );
    await memoryService.createSpontaneous(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      "Europe/Berlin",
      { title: "Resolved", initialText: "Already captured" },
      new Date("2026-09-04T12:00:00.000Z"),
    );

    const unresolved = await memoryService.list(
      env.DUODATE_HOUSEHOLD_ID,
      { captureState: "CAPTURE_REQUIRED" },
      new Date("2026-09-04T12:00:00.000Z"),
    );
    expect(new Set(unresolved.map(({ id }) => id))).toEqual(
      new Set([overdue.id, spontaneous.id]),
    );
    expect(unresolved.find(({ id }) => id === overdue.id)?.captureOverdue).toBe(true);
    expect(unresolved.find(({ id }) => id === spontaneous.id)?.captureOverdue).toBe(false);

    const { token } = await signIn("pablo-test", firstPassphrase, "unresolved-query");
    const response = await authorizedRequest(
      "/api/memories?captureState=CAPTURE_REQUIRED",
      token!,
    );
    expect(response.status).toBe(200);
    const responseIds = ((await response.json()) as { data: Array<{ id: string }> }).data.map(
      ({ id }) => id,
    );
    expect(new Set(responseIds)).toEqual(new Set([overdue.id, spontaneous.id]));
  });

  test("Dated completion invalidates a persisted Let's Date item without moving survivors", async () => {
    for (let index = 0; index < 5; index += 1) {
      await createPlanningIdea({ title: `Phase C candidate ${index}` });
    }
    const request = {
      context: { kind: "SPACE" as const, id: "space-berlin" },
      targetDate: "2026-10-12" as CalendarDate,
      weather: [],
    };
    const initial = await letsDateService.suggest(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      request,
    );
    const completed = initial.suggestions[1]!;
    const schedule = await createTestSchedule(completed.idea.id, {
      scheduledDate: "2026-10-12",
      cleanupDueAt: new Date("2026-10-15T00:00:00.000Z"),
    });
    await datedService.dateSchedule(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      schedule.id,
      new Date("2026-10-13T00:00:00.000Z"),
    );

    const repaired = await letsDateService.suggest(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      request,
      new Date("2026-10-13T00:00:00.000Z"),
    );
    expect(repaired.suggestions.find(({ position }) => position === 1)?.idea.id).toBe(
      initial.suggestions.find(({ position }) => position === 1)?.idea.id,
    );
    expect(repaired.suggestions.find(({ position }) => position === 3)?.idea.id).toBe(
      initial.suggestions.find(({ position }) => position === 3)?.idea.id,
    );
    expect(repaired.suggestions.find(({ position }) => position === completed.position)?.idea.id)
      .not.toBe(completed.idea.id);
    const completedIdea = await loadPlanningIdea(completed.idea.id);
    expect(completedIdea.lifecycle).toBe("COMPLETED");
    const context = await planningContextService.resolveSpace(
      env.DUODATE_HOUSEHOLD_ID,
      "Europe/Berlin",
      "space-berlin",
    );
    expect(
      evaluateIdeaEligibility(
        completedIdea,
        eligibilityRequest(context, "2026-10-12", { mode: "ACTIVE_BROWSE" }),
      ),
    ).toMatchObject({ eligible: false, reason: "INACTIVE" });
  });
});

describe("Foundation Phase D private Memory media", () => {
  test("AES-256-GCM envelope encryption round-trips and rejects tampering or wrong keys", () => {
    const plaintext = new TextEncoder().encode("private DuoDate media payload");
    const context: MediaAssociatedData = {
      mediaId: "media-encryption-test",
      householdId: env.DUODATE_HOUSEHOLD_ID,
      memoryId: "memory-encryption-test",
      uploaderId: env.DUODATE_USER_ONE_ID,
      kind: "PHOTO",
      contentType: "image/jpeg",
      byteSize: plaintext.byteLength,
      encryptionVersion: MEDIA_ENCRYPTION_VERSION,
      keyVersion: 1,
    };
    const encrypted = encryptMediaObject(plaintext, mediaMasterKey, context);

    expect(encrypted.ciphertext).not.toEqual(plaintext);
    expect(decryptMediaObject(encrypted.ciphertext, encrypted, mediaMasterKey, context)).toEqual(
      plaintext,
    );

    const tamperedCiphertext = Uint8Array.from(encrypted.ciphertext);
    tamperedCiphertext[0] = tamperedCiphertext[0]! ^ 1;
    expect(() =>
      decryptMediaObject(tamperedCiphertext, encrypted, mediaMasterKey, context),
    ).toThrow(MediaIntegrityError);

    const tamperedTag = {
      ...encrypted,
      authTag: Buffer.from(new Uint8Array(16).fill(9)).toString("base64"),
    };
    expect(() =>
      decryptMediaObject(encrypted.ciphertext, tamperedTag, mediaMasterKey, context),
    ).toThrow(MediaIntegrityError);
    expect(() =>
      decryptMediaObject(encrypted.ciphertext, encrypted, new Uint8Array(32).fill(99), context),
    ).toThrow(MediaIntegrityError);
  });

  test("media receipt retries reuse the same contribution after a lost response", async () => {
    const first = await signIn("pablo-test", firstPassphrase, "receipt-retry");
    const memory = await memoryService.createDraft(env.DUODATE_HOUSEHOLD_ID, env.DUODATE_USER_ONE_ID,
      { title: "Receipt retry", startDate: "2026-10-10" as CalendarDate });
    const clientRequestId = crypto.randomUUID();
    const input = { kind: "PHOTO" as const, contentType: "image/jpeg", bytes: photoBytes("retry"), extra: { clientRequestId } };
    const firstUpload = await uploadMedia(first.token!, memory.id, input);
    expect(firstUpload.status).toBe(201);
    const retry = await uploadMedia(first.token!, memory.id, input);
    expect(retry.status).toBe(201);
    expect((await retry.json()) as unknown).toMatchObject({ data: { media: { id: clientRequestId } } });
    expect(await prisma.memoryMedia.count({ where: { memoryId: memory.id } })).toBe(1);
    const conflict = await uploadMedia(first.token!, memory.id, { ...input, bytes: photoBytes("different size") });
    expect(conflict.status).toBe(409);
  });

  test("authenticated uploads encrypt bytes, derive authorship, and expose only safe metadata", async () => {
    const first = await signIn("pablo-test", firstPassphrase, "media-upload-first");
    const second = await signIn("luane-test", secondPassphrase, "media-upload-second");
    const memory = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      { title: "Private photo", startDate: "2026-10-10" as CalendarDate },
    );
    const bytes = photoBytes("plaintext must never reach storage");
    const unauthorizedForm = new FormData();
    unauthorizedForm.append("kind", "PHOTO");
    unauthorizedForm.append("file", new File([bytes], "memory.jpg", { type: "image/jpeg" }));
    const unauthorized = await app.request(`http://duodate.test/api/memories/${memory.id}/media`, {
      method: "POST",
      body: unauthorizedForm,
    });
    expect(unauthorized.status).toBe(401);

    const forged = await uploadMedia(first.token!, memory.id, {
      kind: "PHOTO",
      bytes,
      contentType: "image/jpeg",
      extra: { uploaderId: env.DUODATE_USER_TWO_ID },
    });
    expect(forged.status).toBe(400);

    const uploaded = await uploadMedia(second.token!, memory.id, {
      kind: "PHOTO",
      bytes,
      contentType: "image/jpeg",
      caption: "First photo",
    });
    expect(uploaded.status).toBe(201);
    const payload = ((await uploaded.json()) as {
      data: {
        media: {
          id: string;
          uploader: { id: string };
          contentPath: string;
          isCover: boolean;
        };
        memory: {
          status: string;
          resolvedAt: string;
          coverMediaId: string;
          mediaItems: Array<{ id: string; uploader: { id: string } }>;
        };
      };
    }).data;
    expect(payload.media.uploader.id).toBe(env.DUODATE_USER_TWO_ID);
    expect(payload.media.contentPath).toBe(`/api/media/${payload.media.id}/content`);
    expect(payload.media.isCover).toBe(true);
    expect(payload.memory).toMatchObject({
      status: "CONTENT_VALID",
      coverMediaId: payload.media.id,
    });
    expect(payload.memory.resolvedAt).toBeTruthy();
    expect(payload.memory.mediaItems).toMatchObject([
      {
        id: payload.media.id,
        uploader: { id: env.DUODATE_USER_TWO_ID },
      },
    ]);

    const readAfterUpload = await authorizedRequest(`/api/memories/${memory.id}`, first.token!);
    expect(readAfterUpload.status).toBe(200);
    expect(((await readAfterUpload.json()) as {
      data: { status: string; mediaItems: Array<{ id: string }> };
    }).data).toMatchObject({
      status: "CONTENT_VALID",
      mediaItems: [{ id: payload.media.id }],
    });

    const stored = await prisma.memoryMedia.findUniqueOrThrow({ where: { id: payload.media.id } });
    const ciphertext = mediaStorage.peekObject(stored.storageObjectKey);
    expect(ciphertext).toBeDefined();
    expect(ciphertext).not.toEqual(bytes);
    const safeJson = JSON.stringify(payload);
    for (const forbidden of [
      "storageObjectKey",
      "encryptedDataKey",
      "keyWrapNonce",
      "keyWrapAuthTag",
      "authTag",
      "keyVersion",
      "encryptionVersion",
      "households/",
    ]) {
      expect(safeJson).not.toContain(forbidden);
    }

    const content = await authorizedRequest(`/api/media/${payload.media.id}/content`, first.token!);
    expect(content.status).toBe(200);
    expect(content.headers.get("Content-Type")).toBe("image/jpeg");
    expect(content.headers.get("Cache-Control")).toBe("private, no-store");
    expect(content.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(bytes);

    const ranged = await authorizedRequest(`/api/media/${payload.media.id}/content`, first.token!, {
      headers: { Range: "bytes=0-4" },
    });
    expect(ranged.status).toBe(416);
  });

  test("all supported media kinds make an empty Memory CONTENT_VALID while pending and failed media do not", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "media-kinds");
    const cases = [
      { kind: "PHOTO" as const, bytes: photoBytes(), contentType: "image/jpeg" },
      { kind: "VIDEO" as const, bytes: videoBytes(), contentType: "video/mp4" },
      { kind: "VOICE_NOTE" as const, bytes: voiceBytes(), contentType: "audio/wav" },
    ];

    for (const [index, media] of cases.entries()) {
      const memory = await memoryService.createDraft(
        env.DUODATE_HOUSEHOLD_ID,
        env.DUODATE_USER_ONE_ID,
        { title: media.kind, startDate: `2026-10-1${index}` as CalendarDate },
      );
      const response = await uploadMedia(token!, memory.id, media);
      expect(response.status).toBe(201);
      expect(((await response.json()) as { data: { memory: { status: string } } }).data.memory.status)
        .toBe("CONTENT_VALID");
    }

    const pendingMemory = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      { title: "Pending media", startDate: "2026-10-20" as CalendarDate },
    );
    await prisma.memoryMedia.create({
      data: {
        id: "pending-media",
        memoryId: pendingMemory.id,
        uploaderId: env.DUODATE_USER_ONE_ID,
        kind: "PHOTO",
        state: "PENDING",
        storageObjectKey: "pending/object.enc",
        contentType: "image/jpeg",
        byteSize: 4,
        encryptedDataKey: "pending",
        keyWrapNonce: "pending",
        keyWrapAuthTag: "pending",
        nonce: "pending",
        authTag: "pending",
      },
    });
    await prisma.$transaction((tx) =>
      recomputeMemoryContentState(tx, pendingMemory.id, env.DUODATE_USER_ONE_ID),
    );
    expect(await prisma.memory.findUnique({ where: { id: pendingMemory.id } })).toMatchObject({
      status: "CAPTURE_REQUIRED",
      resolvedAt: null,
    });

    const failedMemory = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      { title: "Failed media", startDate: "2026-10-21" as CalendarDate },
    );
    mediaStorage.failNextPut = true;
    const failed = await uploadMedia(token!, failedMemory.id, cases[0]!);
    expect(failed.status).toBe(503);
    expect(await prisma.memory.findUnique({ where: { id: failedMemory.id } })).toMatchObject({
      status: "CAPTURE_REQUIRED",
      resolvedAt: null,
    });
    expect(await prisma.memoryMedia.count({ where: { memoryId: failedMemory.id } })).toBe(0);
  });

  test("media access and ordering never cross Memory or Household boundaries", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "media-boundaries");
    const memory = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      { title: "Local media", startDate: "2026-10-10" as CalendarDate },
    );
    const otherMemory = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      { title: "Other media", startDate: "2026-10-11" as CalendarDate },
    );
    const localUpload = await uploadMedia(token!, memory.id, {
      kind: "PHOTO",
      bytes: photoBytes("local"),
      contentType: "image/jpeg",
    });
    const localId = ((await localUpload.json()) as { data: { media: { id: string } } }).data.media.id;
    const otherUpload = await uploadMedia(token!, otherMemory.id, {
      kind: "PHOTO",
      bytes: photoBytes("other"),
      contentType: "image/jpeg",
    });
    const otherId = ((await otherUpload.json()) as { data: { media: { id: string } } }).data.media.id;

    const crossMemoryOrder = await authorizedRequest(`/api/memories/${memory.id}/media-order`, token!, {
      method: "PUT",
      body: JSON.stringify({ mediaIds: [localId, otherId] }),
    });
    expect(crossMemoryOrder.status).toBe(400);
    const crossMemoryCover = await authorizedRequest(`/api/memories/${memory.id}/cover`, token!, {
      method: "PUT",
      body: JSON.stringify({ mediaId: otherId }),
    });
    expect(crossMemoryCover.status).toBe(400);

    await prisma.household.create({
      data: { id: "foreign-media-household", suggestionSeed: "foreign-media" },
    });
    const foreignMemory = await prisma.memory.create({
      data: {
        id: "foreign-media-memory",
        householdId: "foreign-media-household",
        createdById: env.DUODATE_USER_ONE_ID,
        updatedById: env.DUODATE_USER_ONE_ID,
        title: "Foreign private media",
        startDate: "2026-10-10",
      },
    });
    await prisma.memoryMedia.create({
      data: {
        id: "foreign-media",
        memoryId: foreignMemory.id,
        uploaderId: env.DUODATE_USER_ONE_ID,
        kind: "PHOTO",
        state: "ACTIVE",
        storageObjectKey: "foreign/object.enc",
        contentType: "image/jpeg",
        byteSize: 4,
        encryptedDataKey: "private",
        keyWrapNonce: "private",
        keyWrapAuthTag: "private",
        nonce: "private",
        authTag: "private",
      },
    });
    const crossHousehold = await authorizedRequest("/api/media/foreign-media/content", token!);
    expect(crossHousehold.status).toBe(404);
    const foreignOrder = await authorizedRequest(`/api/memories/${memory.id}/media-order`, token!, {
      method: "PUT",
      body: JSON.stringify({ mediaIds: ["foreign-media"] }),
    });
    expect(foreignOrder.status).toBe(400);
    const foreignCover = await authorizedRequest(`/api/memories/${memory.id}/cover`, token!, {
      method: "PUT",
      body: JSON.stringify({ mediaId: "foreign-media" }),
    });
    expect(foreignCover.status).toBe(400);
    const crossHouseholdUpload = await uploadMedia(token!, foreignMemory.id, {
      kind: "PHOTO",
      bytes: photoBytes("forbidden"),
      contentType: "image/jpeg",
    });
    expect(crossHouseholdUpload.status).toBe(404);
  });

  test("captions, explicit ordering, and photo-only cover selection work deterministically", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "media-metadata");
    const memory = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      { title: "Ordered media", startDate: "2026-10-10" as CalendarDate },
    );
    const firstPhotoResponse = await uploadMedia(token!, memory.id, {
      kind: "PHOTO",
      bytes: photoBytes("first"),
      contentType: "image/jpeg",
      sortOrder: 10,
    });
    const firstPhoto = ((await firstPhotoResponse.json()) as { data: { media: { id: string } } }).data.media;
    const videoResponse = await uploadMedia(token!, memory.id, {
      kind: "VIDEO",
      bytes: videoBytes(),
      contentType: "video/mp4",
      sortOrder: 20,
    });
    const video = ((await videoResponse.json()) as { data: { media: { id: string } } }).data.media;
    const secondPhotoResponse = await uploadMedia(token!, memory.id, {
      kind: "PHOTO",
      bytes: photoBytes("second"),
      contentType: "image/jpeg",
      sortOrder: 30,
    });
    const secondPhoto = ((await secondPhotoResponse.json()) as { data: { media: { id: string } } }).data.media;

    expect(await prisma.memory.findUnique({ where: { id: memory.id } })).toMatchObject({
      coverMediaId: firstPhoto.id,
    });
    const invalidVideoCover = await authorizedRequest(`/api/memories/${memory.id}/cover`, token!, {
      method: "PUT",
      body: JSON.stringify({ mediaId: video.id }),
    });
    expect(invalidVideoCover.status).toBe(400);
    const selected = await authorizedRequest(`/api/memories/${memory.id}/cover`, token!, {
      method: "PUT",
      body: JSON.stringify({ mediaId: secondPhoto.id }),
    });
    expect(selected.status).toBe(200);
    expect(((await selected.json()) as { data: { coverMediaId: string } }).data.coverMediaId).toBe(
      secondPhoto.id,
    );

    const caption = await authorizedRequest(
      `/api/memories/${memory.id}/media/${video.id}`,
      token!,
      { method: "PATCH", body: JSON.stringify({ caption: "  Listen to the rain  " }) },
    );
    expect(caption.status).toBe(200);
    expect(((await caption.json()) as { data: { caption: string } }).data.caption).toBe(
      "Listen to the rain",
    );

    const order = [video.id, firstPhoto.id, secondPhoto.id];
    const reordered = await authorizedRequest(`/api/memories/${memory.id}/media-order`, token!, {
      method: "PUT",
      body: JSON.stringify({ mediaIds: order }),
    });
    expect(reordered.status).toBe(200);
    expect(
      ((await reordered.json()) as { data: { mediaItems: Array<{ id: string }> } }).data.mediaItems.map(
        ({ id }) => id,
      ),
    ).toEqual(order);

    const deletedCover = await authorizedRequest(
      `/api/memories/${memory.id}/media/${secondPhoto.id}`,
      token!,
      { method: "DELETE" },
    );
    expect(deletedCover.status).toBe(200);
    expect(await prisma.memory.findUnique({ where: { id: memory.id } })).toMatchObject({
      coverMediaId: firstPhoto.id,
    });
    await authorizedRequest(`/api/memories/${memory.id}/media/${firstPhoto.id}`, token!, {
      method: "DELETE",
    });
    expect(await prisma.memory.findUnique({ where: { id: memory.id } })).toMatchObject({
      coverMediaId: null,
    });
  });

  test("deleting final media restores CAPTURE_REQUIRED without undoing Dated history", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "media-delete-invariant");
    const ideaId = await createPlanningIdea({ title: "Media-only date" });
    const schedule = await createTestSchedule(ideaId);
    const memory = await datedService.dateSchedule(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      schedule.id,
      new Date("2026-10-11T12:00:00.000Z"),
    );
    const originalDueAt = memory.captureDueAt!.toISOString();
    const upload = await uploadMedia(token!, memory.id, {
      kind: "VIDEO",
      bytes: videoBytes("dated"),
      contentType: "video/mp4",
    });
    const mediaId = ((await upload.json()) as { data: { media: { id: string } } }).data.media.id;
    expect(await prisma.memory.findUnique({ where: { id: memory.id } })).toMatchObject({
      status: "CONTENT_VALID",
    });

    const deleted = await authorizedRequest(`/api/memories/${memory.id}/media/${mediaId}`, token!, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(await prisma.memory.findUnique({ where: { id: memory.id } })).toMatchObject({
      status: "CAPTURE_REQUIRED",
      resolvedAt: null,
      captureDueAt: new Date(originalDueAt),
    });
    expect(await prisma.schedule.findUnique({ where: { id: schedule.id } })).toMatchObject({
      status: "COMPLETED",
    });
    expect(await prisma.idea.findUnique({ where: { id: ideaId } })).toMatchObject({
      lifecycle: "COMPLETED",
    });
  });

  test("deleting final media keeps CONTENT_VALID when valid text remains", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "media-delete-with-text");
    const memory = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      { title: "Text and audio", startDate: "2026-10-10" as CalendarDate },
    );
    await memoryService.addContribution(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      memory.id,
      { kind: "TEXT", text: "The written memory remains", sortOrder: 0 },
    );
    const upload = await uploadMedia(token!, memory.id, {
      kind: "VOICE_NOTE",
      bytes: voiceBytes(),
      contentType: "audio/wav",
    });
    const mediaId = ((await upload.json()) as { data: { media: { id: string } } }).data.media.id;
    await authorizedRequest(`/api/memories/${memory.id}/media/${mediaId}`, token!, {
      method: "DELETE",
    });
    expect(await prisma.memory.findUnique({ where: { id: memory.id } })).toMatchObject({
      status: "CONTENT_VALID",
    });
  });

  test("failed provider deletion remains tombstoned and a retry safely finishes cleanup", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "media-delete-retry");
    const memory = await memoryService.createDraft(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      { title: "Retry deletion", startDate: "2026-10-10" as CalendarDate },
    );
    const upload = await uploadMedia(token!, memory.id, {
      kind: "PHOTO",
      bytes: photoBytes("delete retry"),
      contentType: "image/jpeg",
    });
    const mediaId = ((await upload.json()) as { data: { media: { id: string } } }).data.media.id;
    const stored = await prisma.memoryMedia.findUniqueOrThrow({ where: { id: mediaId } });

    mediaStorage.failNextDelete = true;
    const firstDelete = await authorizedRequest(`/api/memories/${memory.id}/media/${mediaId}`, token!, {
      method: "DELETE",
    });
    expect(firstDelete.status).toBe(202);
    expect(await prisma.memoryMedia.findUnique({ where: { id: mediaId } })).toMatchObject({
      state: "DELETION_PENDING",
      cleanupAttempts: 1,
      lastStorageError: "STORAGE_DELETE_FAILED",
    });
    expect(await prisma.memory.findUnique({ where: { id: memory.id } })).toMatchObject({
      status: "CAPTURE_REQUIRED",
      coverMediaId: null,
    });
    expect(mediaStorage.hasObject(stored.storageObjectKey)).toBe(true);
    const inaccessible = await authorizedRequest(`/api/media/${mediaId}/content`, token!);
    expect(inaccessible.status).toBe(404);

    const retry = await authorizedRequest(`/api/memories/${memory.id}/media/${mediaId}`, token!, {
      method: "DELETE",
    });
    expect(retry.status).toBe(200);
    expect(await prisma.memoryMedia.findUnique({ where: { id: mediaId } })).toBeNull();
    expect(mediaStorage.hasObject(stored.storageObjectKey)).toBe(false);
  });
});

describe("Idea website links", () => {
  test("create, add, and edit normalize domains into HTTP or HTTPS website URLs", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "idea-website-normalize");
    const created = await createIdea(token!, { links: [{ url: "  abc.com  " }] });
    expect(created.response.status).toBe(201);
    const response = await authorizedRequest(`/api/ideas/${created.idea.id}`, token!);
    const idea = ((await response.json()) as { data: { links: Array<{ id: string; url: string }> } }).data;
    expect(idea.links[0]?.url).toBe("https://abc.com/");
    const firstLink = idea.links[0]!;
    const updated = await authorizedRequest(`/api/ideas/${created.idea.id}/links/${firstLink.id}`, token!, {
      method: "PATCH", body: JSON.stringify({ url: "www.abc.com/path" }),
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { data: { url: string } }).data.url).toBe("https://www.abc.com/path");
    const urls = [
      ["//abc.com", "https://abc.com/"],
      [" http://abc.com/path?q=1#part ", "http://abc.com/path?q=1#part"],
      ["https://abc.com", "https://abc.com/"],
    ];
    for (const [url, expected] of urls) {
      const added = await authorizedRequest(`/api/ideas/${created.idea.id}/links`, token!, {
        method: "POST", body: JSON.stringify({ url }),
      });
      expect(added.status).toBe(201);
      expect(((await added.json()) as { data: { url: string } }).data.url).toBe(expected!);
    }
    const persisted = await prisma.ideaLink.findMany({ where: { ideaId: created.idea.id } });
    expect(persisted.map((link) => link.url).sort()).toEqual([
      "https://www.abc.com/path", "https://abc.com/", "http://abc.com/path?q=1#part", "https://abc.com/",
    ].sort());
  });

  test("unsafe or malformed websites are rejected without changing saved links", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "idea-website-invalid");
    const created = await createIdea(token!, { links: [{ url: "https://abc.com/" }] });
    const link = await prisma.ideaLink.findFirstOrThrow({ where: { ideaId: created.idea.id } });
    for (const url of [
      "javascript:alert(1)", "file:///tmp/private", "ftp://abc.com/file", "not-a-domain",
      "localhost", "https://user:secret@abc.com", "https://abc.com/a path", "abc .com", "",
    ]) {
      const rejectedCreate = await createIdea(token!, { links: [{ url }] });
      expect(rejectedCreate.response.status).toBe(400);
      const rejectedAdd = await authorizedRequest(`/api/ideas/${created.idea.id}/links`, token!, {
        method: "POST", body: JSON.stringify({ url }),
      });
      expect(rejectedAdd.status).toBe(400);
      const rejectedEdit = await authorizedRequest(`/api/ideas/${created.idea.id}/links/${link.id}`, token!, {
        method: "PATCH", body: JSON.stringify({ url }),
      });
      expect(rejectedEdit.status).toBe(400);
    }
    expect(await prisma.idea.count()).toBe(1);
    expect(await prisma.ideaLink.count({ where: { ideaId: created.idea.id } })).toBe(1);
    expect((await prisma.ideaLink.findUniqueOrThrow({ where: { id: link.id } })).url).toBe("https://abc.com/");
  });
});

describe("private Idea image attachments", () => {
  test("authenticated Household members upload encrypted images and receive only public metadata", async () => {
    const first = await signIn("pablo-test", firstPassphrase, "idea-image-first");
    const second = await signIn("luane-test", secondPassphrase, "idea-image-second");
    const created = await createIdea(first.token!, { title: "Idea with a private flyer" });
    const bytes = photoBytes("private idea flyer bytes");

    const unauthorizedForm = new FormData();
    unauthorizedForm.append("file", new File([bytes], "flyer.jpg", { type: "image/jpeg" }));
    const unauthorized = await app.request(
      `http://duodate.test/api/ideas/${created.idea.id}/image`,
      { method: "PUT", body: unauthorizedForm },
    );
    expect(unauthorized.status).toBe(401);

    const forged = await uploadIdeaImage(first.token!, created.idea.id, {
      bytes,
      contentType: "image/jpeg",
      extra: { uploaderId: env.DUODATE_USER_TWO_ID },
    });
    expect(forged.status).toBe(400);

    const uploaded = await uploadIdeaImage(second.token!, created.idea.id, {
      bytes,
      contentType: "image/jpeg",
      width: 1200,
      height: 800,
    });
    expect(uploaded.status).toBe(201);
    const image = ((await uploaded.json()) as {
      data: {
        id: string;
        ideaId: string;
        uploader: { id: string; displayName: string };
        contentType: string;
        byteSize: number;
        width: number | null;
        height: number | null;
        contentPath: string;
      };
    }).data;
    expect(image).toMatchObject({
      ideaId: created.idea.id,
      uploader: { id: env.DUODATE_USER_TWO_ID, displayName: "Luane Test" },
      contentType: "image/jpeg",
      byteSize: bytes.byteLength,
      width: 1200,
      height: 800,
      contentPath: `/api/ideas/${created.idea.id}/image/content`,
    });
    const publicJson = JSON.stringify(image);
    for (const forbidden of [
      "storageObjectKey",
      "encryptedDataKey",
      "keyWrapNonce",
      "keyWrapAuthTag",
      "authTag",
      "keyVersion",
      "encryptionVersion",
      "households/",
      "http://",
      "https://",
    ]) {
      expect(publicJson).not.toContain(forbidden);
    }

    const stored = await prisma.ideaImage.findUniqueOrThrow({ where: { id: image.id } });
    expect(stored).toMatchObject({ state: "ACTIVE", activeSlot: created.idea.id });
    const ciphertext = mediaStorage.peekObject(stored.storageObjectKey);
    expect(ciphertext).toBeDefined();
    expect(ciphertext).not.toEqual(bytes);

    const content = await authorizedRequest(image.contentPath, first.token!);
    expect(content.status).toBe(200);
    expect(content.headers.get("Content-Type")).toBe("image/jpeg");
    expect(content.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(bytes);

    const ideaResponse = await authorizedRequest(`/api/ideas/${created.idea.id}`, first.token!);
    const idea = ((await ideaResponse.json()) as { data: { image: { id: string } | null } }).data;
    expect(idea.image?.id).toBe(image.id);
    expect(await prisma.schedule.count({ where: { ideaId: created.idea.id } })).toBe(0);
  });

  test("new Idea video uploads are rejected before creating records or replacing photos", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "idea-video-rejected");
    const created = await createIdea(token!);
    const rejected = await uploadIdeaImage(token!, created.idea.id, {
      kind: "VIDEO", bytes: videoBytes(), contentType: "video/mp4",
    });
    expect(rejected.status).toBe(400);
    expect((await rejected.json()) as unknown).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(await prisma.ideaImage.count({ where: { ideaId: created.idea.id } })).toBe(0);

    const photo = await uploadIdeaImage(token!, created.idea.id, {
      bytes: photoBytes(), contentType: "image/jpeg",
    });
    const image = ((await photo.json()) as { data: { id: string } }).data;
    const invalidMetadata = { kind: "VIDEO" } as unknown as import("./types").IdeaImageUploadMetadata;
    await expect(ideaImageService.upload(
      env.DUODATE_HOUSEHOLD_ID, env.DUODATE_USER_ONE_ID, created.idea.id,
      invalidMetadata, "video/mp4", videoBytes(),
    )).rejects.toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
    await expect(ideaImageService.upload(
      env.DUODATE_HOUSEHOLD_ID, env.DUODATE_USER_ONE_ID, created.idea.id,
      { kind: "PHOTO" }, "video/mp4", videoBytes(),
    )).rejects.toMatchObject({ status: 400, code: "UNSUPPORTED_MEDIA_TYPE" });
    expect(await prisma.ideaImage.count({ where: { ideaId: created.idea.id } })).toBe(1);
    expect((await prisma.ideaImage.findUniqueOrThrow({ where: { id: image.id } })).state).toBe("ACTIVE");
  });

  test("existing private Idea videos remain readable and can be replaced with a photo", async () => {
    const first = await signIn("pablo-test", firstPassphrase, "idea-video-first");
    const second = await signIn("luane-test", secondPassphrase, "idea-video-second");
    const created = await createIdea(first.token!, { title: "Idea with a legacy private video" });
    const bytes = videoBytes("private idea video bytes");
    // Seed an encrypted legacy record directly; new uploads no longer allow videos.
    const legacyId = "legacy-idea-video";
    const encrypted = encryptIdeaImageObject(bytes, mediaMasterKey, {
      imageId: legacyId,
      householdId: env.DUODATE_HOUSEHOLD_ID,
      ideaId: created.idea.id,
      uploaderId: env.DUODATE_USER_TWO_ID,
      contentType: "video/mp4",
      byteSize: bytes.byteLength,
      encryptionVersion: MEDIA_ENCRYPTION_VERSION,
      keyVersion: 1,
    });
    const storageObjectKey = `households/${env.DUODATE_HOUSEHOLD_ID}/ideas/${created.idea.id}/${legacyId}.enc`;
    await mediaStorage.putObject(storageObjectKey, encrypted.ciphertext);
    await prisma.ideaImage.create({
      data: {
        id: legacyId,
        ideaId: created.idea.id,
        uploaderId: env.DUODATE_USER_TWO_ID,
        state: "ACTIVE",
        activeSlot: created.idea.id,
        storageObjectKey,
        contentType: "video/mp4",
        byteSize: bytes.byteLength,
        width: 1920,
        height: 1080,
        encryptionVersion: MEDIA_ENCRYPTION_VERSION,
        keyVersion: 1,
        encryptedDataKey: encrypted.encryptedDataKey,
        keyWrapNonce: encrypted.keyWrapNonce,
        keyWrapAuthTag: encrypted.keyWrapAuthTag,
        nonce: encrypted.nonce,
        authTag: encrypted.authTag,
      },
    });
    const legacyResponse = await authorizedRequest(`/api/ideas/${created.idea.id}`, second.token!);
    const image = ((await legacyResponse.json()) as { data: { image: import("./types").PublicIdeaImageDto } }).data.image;
    expect(image).toMatchObject({
      ideaId: created.idea.id,
      contentType: "video/mp4",
      byteSize: bytes.byteLength,
      width: 1920,
      height: 1080,
      uploader: { id: env.DUODATE_USER_TWO_ID, displayName: "Luane Test" },
      contentPath: `/api/ideas/${created.idea.id}/image/content`,
    });
    expect(Object.keys(image).sort()).toEqual([
      "id", "ideaId", "contentType", "byteSize", "width", "height",
      "createdAt", "updatedAt", "uploader", "contentPath",
    ].sort());
    const stored = await prisma.ideaImage.findUniqueOrThrow({ where: { id: image.id } });
    expect(stored).toMatchObject({ state: "ACTIVE", activeSlot: created.idea.id, contentType: "video/mp4" });
    expect(stored.storageObjectKey).toEndWith(".enc");
    expect(mediaStorage.peekObject(stored.storageObjectKey)).not.toEqual(bytes);

    expect((await app.request(`http://duodate.test${image.contentPath}`)).status).toBe(401);
    const content = await authorizedRequest(image.contentPath, first.token!);
    expect(content.status).toBe(200);
    expect(content.headers.get("Content-Type")).toBe("video/mp4");
    expect(content.headers.get("Content-Length")).toBe(String(bytes.byteLength));
    expect(content.headers.get("Cache-Control")).toBe("private, no-store");
    expect(content.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(content.headers.get("Accept-Ranges")).toBe("none");
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(bytes);
    const range = await authorizedRequest(image.contentPath, first.token!, {
      headers: { Range: "bytes=0-4" },
    });
    expect(range.status).toBe(416);
    expect((await range.json()) as unknown).toMatchObject({ error: { code: "MEDIA_RANGE_NOT_SUPPORTED" } });

    const ideaResponse = await authorizedRequest(`/api/ideas/${created.idea.id}`, first.token!);
    expect(ideaResponse.status).toBe(200);
    expect(((await ideaResponse.json()) as { data: { image: unknown } }).data.image).toEqual(image);
    const listResponse = await authorizedRequest("/api/ideas", first.token!);
    expect(((await listResponse.json()) as { data: Array<{ id: string; image: unknown }> }).data
      .find((idea) => idea.id === created.idea.id)?.image).toEqual(image);

    const photo = await uploadIdeaImage(first.token!, created.idea.id, {
      kind: "PHOTO",
      bytes: photoBytes("replacement photo"),
      contentType: "image/jpeg",
    });
    expect(photo.status).toBe(201);
    expect(await prisma.ideaImage.findUnique({ where: { id: image.id } })).toBeNull();
    expect(mediaStorage.hasObject(stored.storageObjectKey)).toBe(false);
    expect(await prisma.ideaImage.count({ where: { ideaId: created.idea.id, state: "ACTIVE" } })).toBe(1);
    const replacement = ((await photo.json()) as { data: { contentPath: string } }).data;
    expect((await authorizedRequest(replacement.contentPath, first.token!)).headers.get("Content-Type"))
      .toBe("image/jpeg");
  });

  test("Idea attachments reject invalid kinds, incompatible MIME types, and forged signatures", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "idea-video-validation");
    const created = await createIdea(token!);
    const invalidUploads = [
      { extra: { kind: "VOICE_NOTE" }, contentType: "audio/wav", bytes: voiceBytes(), code: "VALIDATION_ERROR" },
      { extra: { kind: "video" }, contentType: "video/mp4", bytes: videoBytes(), code: "VALIDATION_ERROR" },
      { extra: { kind: "" }, contentType: "video/mp4", bytes: videoBytes(), code: "VALIDATION_ERROR" },
      { kind: "VIDEO" as const, contentType: "image/jpeg", bytes: photoBytes(), code: "VALIDATION_ERROR" },
      { kind: "PHOTO" as const, contentType: "video/mp4", bytes: videoBytes(), code: "UNSUPPORTED_MEDIA_TYPE" },
      { contentType: "video/mp4", bytes: videoBytes(), code: "UNSUPPORTED_MEDIA_TYPE" },
      { kind: "VIDEO" as const, contentType: "audio/mp4", bytes: videoBytes(), code: "VALIDATION_ERROR" },
      { kind: "VIDEO" as const, contentType: "video/mp4", bytes: photoBytes(), code: "VALIDATION_ERROR" },
      { kind: "PHOTO" as const, contentType: "image/jpeg", bytes: videoBytes(), code: "MEDIA_SIGNATURE_MISMATCH" },
    ];
    for (const input of invalidUploads) {
      const response = await uploadIdeaImage(token!, created.idea.id, input);
      expect(response.status).toBe(400);
      expect((await response.json()) as unknown).toMatchObject({ error: { code: input.code } });
    }
    expect(await prisma.ideaImage.count({ where: { ideaId: created.idea.id } })).toBe(0);
    const duplicateForm = new FormData();
    duplicateForm.append("kind", "VIDEO");
    duplicateForm.append("kind", "PHOTO");
    duplicateForm.append("file", new File([videoBytes()], "duplicate.mp4", { type: "video/mp4" }));
    expect((await authorizedRequest(`/api/ideas/${created.idea.id}/image`, token!, {
      method: "PUT", body: duplicateForm,
    })).status).toBe(400);
  });

  test("Idea attachments apply the photo size limit and keep the saved photo after rejection", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "idea-photo-size");
    const created = await createIdea(token!);
    const photoLimit = env.MEDIA_PHOTO_MAX_BYTES;
    env.MEDIA_PHOTO_MAX_BYTES = 16;
    try {
      const photo = new Uint8Array(16);
      photo.set(photoBytes("flyer"));
      expect((await uploadIdeaImage(token!, created.idea.id, {
        kind: "PHOTO", contentType: "image/jpeg", bytes: photo,
      })).status).toBe(201);
      const tooLarge = new Uint8Array(17);
      tooLarge.set(photoBytes("flyer"));
      const rejectedPhoto = await uploadIdeaImage(token!, created.idea.id, {
        kind: "PHOTO", contentType: "image/jpeg", bytes: tooLarge,
      });
      expect(rejectedPhoto.status).toBe(413);
      expect((await rejectedPhoto.json()) as unknown).toMatchObject({ error: { code: "MEDIA_TOO_LARGE" } });
      expect((await uploadIdeaImage(token!, created.idea.id, {
        kind: "VIDEO", contentType: "video/mp4", bytes: videoBytes(),
      })).status).toBe(400);
      expect(await prisma.ideaImage.count({ where: { ideaId: created.idea.id } })).toBe(1);
      const content = await authorizedRequest(`/api/ideas/${created.idea.id}/image/content`, token!);
      expect(new Uint8Array(await content.arrayBuffer())).toEqual(photo);
    } finally {
      env.MEDIA_PHOTO_MAX_BYTES = photoLimit;
    }
  });

  test("Idea image validation and Household boundaries reject unsafe access", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "idea-image-boundary");
    const created = await createIdea(token!, { title: "Local image validation" });

    const mismatched = await uploadIdeaImage(token!, created.idea.id, {
      bytes: new TextEncoder().encode("not a jpeg"),
      contentType: "image/jpeg",
    });
    expect(mismatched.status).toBe(400);
    const unsupported = await uploadIdeaImage(token!, created.idea.id, {
      bytes: videoBytes("not an Idea image"),
      contentType: "video/mp4",
    });
    expect(unsupported.status).toBe(400);
    expect(await prisma.ideaImage.count({ where: { ideaId: created.idea.id } })).toBe(0);

    await prisma.household.create({
      data: { id: "foreign-idea-image-household", suggestionSeed: "foreign-image" },
    });
    const foreignIdea = await prisma.idea.create({
      data: {
        id: "foreign-idea-image",
        householdId: "foreign-idea-image-household",
        createdById: env.DUODATE_USER_ONE_ID,
        title: "Foreign private flyer",
      },
    });
    const foreignImage = await ideaImageService.upload(
      "foreign-idea-image-household",
      env.DUODATE_USER_ONE_ID,
      foreignIdea.id,
      { kind: "PHOTO" },
      "image/jpeg",
      photoBytes("foreign private bytes"),
    );
    expect(
      (await authorizedRequest(`/api/ideas/${foreignIdea.id}/image/content`, token!)).status,
    ).toBe(404);
    expect(
      (await authorizedRequest(`/api/ideas/${foreignIdea.id}/image`, token!, { method: "DELETE" })).status,
    ).toBe(404);
    expect(mediaStorage.hasObject(
      (await prisma.ideaImage.findUniqueOrThrow({ where: { id: foreignImage.id } })).storageObjectKey,
    )).toBe(true);
  });

  test("replacement and deletion keep at most one active image and safely retry cleanup", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "idea-image-replace-delete");
    const created = await createIdea(token!, { title: "Replaceable flyer" });
    const firstBytes = photoBytes("first flyer");
    const secondBytes = photoBytes("second flyer");

    const firstUpload = await uploadIdeaImage(token!, created.idea.id, {
      bytes: firstBytes,
      contentType: "image/jpeg",
    });
    const firstImage = ((await firstUpload.json()) as { data: { id: string } }).data;
    const firstStored = await prisma.ideaImage.findUniqueOrThrow({ where: { id: firstImage.id } });

    const secondUpload = await uploadIdeaImage(token!, created.idea.id, {
      bytes: secondBytes,
      contentType: "image/jpeg",
    });
    expect(secondUpload.status).toBe(201);
    const secondImage = ((await secondUpload.json()) as { data: { id: string; contentPath: string } }).data;
    const secondStored = await prisma.ideaImage.findUniqueOrThrow({ where: { id: secondImage.id } });
    expect(await prisma.ideaImage.findUnique({ where: { id: firstImage.id } })).toBeNull();
    expect(mediaStorage.hasObject(firstStored.storageObjectKey)).toBe(false);
    expect(await prisma.ideaImage.count({ where: { ideaId: created.idea.id, state: "ACTIVE" } })).toBe(1);
    expect(new Uint8Array(
      await (await authorizedRequest(secondImage.contentPath, token!)).arrayBuffer(),
    )).toEqual(secondBytes);

    mediaStorage.failNextDelete = true;
    const firstDelete = await authorizedRequest(`/api/ideas/${created.idea.id}/image`, token!, {
      method: "DELETE",
    });
    expect(firstDelete.status).toBe(202);
    expect(await prisma.ideaImage.findUnique({ where: { id: secondImage.id } })).toMatchObject({
      state: "DELETION_PENDING",
      activeSlot: null,
      cleanupAttempts: 1,
      lastStorageError: "STORAGE_DELETE_FAILED",
    });
    expect((await authorizedRequest(secondImage.contentPath, token!)).status).toBe(404);
    const ideaAfterDelete = await authorizedRequest(`/api/ideas/${created.idea.id}`, token!);
    expect(((await ideaAfterDelete.json()) as { data: { image: unknown } }).data.image).toBeNull();
    expect(mediaStorage.hasObject(secondStored.storageObjectKey)).toBe(true);

    const retry = await authorizedRequest(`/api/ideas/${created.idea.id}/image`, token!, {
      method: "DELETE",
    });
    expect(retry.status).toBe(200);
    expect(await prisma.ideaImage.findUnique({ where: { id: secondImage.id } })).toBeNull();
    expect(mediaStorage.hasObject(secondStored.storageObjectKey)).toBe(false);
  });
});

describe("private Trip hero images", () => {
  async function createHeroTrip(id: string, householdId = env.DUODATE_HOUSEHOLD_ID) {
    const destination = await prisma.destination.create({
      data: {
        id: `${id}-destination`,
        householdId,
        name: `${id} destination`,
        timeZone: "Europe/Lisbon",
      },
    });
    return prisma.trip.create({
      data: {
        id,
        householdId,
        destinationId: destination.id,
        startDate: "2026-11-10",
        endDate: "2026-11-15",
      },
    });
  }

  test("authenticated Household members upload encrypted heroes exposed only as private DTOs", async () => {
    const first = await signIn("pablo-test", firstPassphrase, "trip-hero-first");
    const second = await signIn("luane-test", secondPassphrase, "trip-hero-second");
    const trip = await createHeroTrip("trip-private-hero");
    const bytes = photoBytes("private Trip hero bytes");

    const unauthorizedForm = new FormData();
    unauthorizedForm.append("file", new File([bytes], "hero.jpg", { type: "image/jpeg" }));
    expect((await app.request(`http://duodate.test/api/trips/${trip.id}/hero`, {
      method: "PUT",
      body: unauthorizedForm,
    })).status).toBe(401);

    const forged = await uploadTripHero(first.token!, trip.id, {
      bytes,
      contentType: "image/jpeg",
      extra: { uploaderId: env.DUODATE_USER_ONE_ID },
    });
    expect(forged.status).toBe(400);

    const uploaded = await uploadTripHero(second.token!, trip.id, {
      bytes,
      contentType: "image/jpeg",
      width: 1600,
      height: 900,
    });
    expect(uploaded.status).toBe(201);
    const hero = ((await uploaded.json()) as {
      data: {
        id: string;
        tripId: string;
        uploader: { id: string; displayName: string };
        contentType: string;
        byteSize: number;
        width: number | null;
        height: number | null;
        contentPath: string;
      };
    }).data;
    expect(hero).toMatchObject({
      tripId: trip.id,
      uploader: { id: env.DUODATE_USER_TWO_ID, displayName: "Luane Test" },
      contentType: "image/jpeg",
      byteSize: bytes.byteLength,
      width: 1600,
      height: 900,
      contentPath: `/api/trips/${trip.id}/hero`,
    });
    const publicJson = JSON.stringify(hero);
    for (const forbidden of [
      "storageObjectKey",
      "encryptedDataKey",
      "keyWrapNonce",
      "keyWrapAuthTag",
      "authTag",
      "keyVersion",
      "encryptionVersion",
      "households/",
      "http://",
      "https://",
    ]) {
      expect(publicJson).not.toContain(forbidden);
    }

    const stored = await prisma.tripHeroImage.findUniqueOrThrow({ where: { id: hero.id } });
    expect(stored).toMatchObject({ state: "ACTIVE", activeSlot: trip.id });
    expect(mediaStorage.peekObject(stored.storageObjectKey)).not.toEqual(bytes);
    expect((await app.request(`http://duodate.test${hero.contentPath}`)).status).toBe(401);
    const content = await authorizedRequest(hero.contentPath, first.token!);
    expect(content.status).toBe(200);
    expect(content.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(bytes);

    const overview = await authorizedRequest("/api/trips?planningDate=2026-09-01", first.token!);
    const overviewTrip = ((await overview.json()) as {
      data: Array<{ id: string; hero: { id: string } | null }>;
    }).data.find(({ id }) => id === trip.id);
    expect(overviewTrip?.hero?.id).toBe(hero.id);
    const detail = await authorizedRequest(`/api/trips/${trip.id}`, first.token!);
    expect(((await detail.json()) as { data: { hero: { id: string } | null } }).data.hero?.id).toBe(hero.id);

    expect((await authorizedRequest(`/api/trips/${trip.id}`, first.token!, {
      method: "DELETE",
    })).status).toBe(204);
    expect(await prisma.tripHeroImage.findUnique({ where: { id: hero.id } })).not.toBeNull();
    expect((await authorizedRequest(hero.contentPath, first.token!)).status).toBe(200);
    const cancelledOverview = await travelService.listTrips(
      env.DUODATE_HOUSEHOLD_ID,
      undefined,
      new Date("2026-09-14T12:00:00.000Z"),
    );
    expect(cancelledOverview.find(({ id }) => id === trip.id)?.hero?.id).toBe(hero.id);
  });

  test("hero replacement, removal, and Household boundaries preserve privacy", async () => {
    const { token } = await signIn("pablo-test", firstPassphrase, "trip-hero-boundary");
    const trip = await createHeroTrip("trip-replaceable-hero");
    const firstBytes = photoBytes("first Trip hero");
    const secondBytes = photoBytes("second Trip hero");
    const firstUpload = await uploadTripHero(token!, trip.id, {
      bytes: firstBytes,
      contentType: "image/jpeg",
    });
    const firstHero = ((await firstUpload.json()) as { data: { id: string } }).data;
    const firstStored = await prisma.tripHeroImage.findUniqueOrThrow({ where: { id: firstHero.id } });

    const secondUpload = await uploadTripHero(token!, trip.id, {
      bytes: secondBytes,
      contentType: "image/jpeg",
    });
    const secondHero = ((await secondUpload.json()) as {
      data: { id: string; contentPath: string };
    }).data;
    const secondStored = await prisma.tripHeroImage.findUniqueOrThrow({ where: { id: secondHero.id } });
    expect(await prisma.tripHeroImage.findUnique({ where: { id: firstHero.id } })).toBeNull();
    expect(mediaStorage.hasObject(firstStored.storageObjectKey)).toBe(false);
    expect(await prisma.tripHeroImage.count({ where: { tripId: trip.id, state: "ACTIVE" } })).toBe(1);

    await prisma.household.create({
      data: { id: "foreign-trip-hero-household", suggestionSeed: "foreign-trip-hero" },
    });
    const foreignTrip = await createHeroTrip("foreign-trip-hero", "foreign-trip-hero-household");
    const foreignHero = await tripHeroImageService.upload(
      "foreign-trip-hero-household",
      env.DUODATE_USER_ONE_ID,
      foreignTrip.id,
      {},
      "image/jpeg",
      photoBytes("foreign Trip hero bytes"),
    );
    expect((await authorizedRequest(foreignHero.contentPath, token!)).status).toBe(404);
    expect((await authorizedRequest(foreignHero.contentPath, token!, { method: "DELETE" })).status).toBe(404);
    expect(mediaStorage.hasObject(
      (await prisma.tripHeroImage.findUniqueOrThrow({ where: { id: foreignHero.id } })).storageObjectKey,
    )).toBe(true);

    mediaStorage.failNextDelete = true;
    const firstDelete = await authorizedRequest(secondHero.contentPath, token!, { method: "DELETE" });
    expect(firstDelete.status).toBe(202);
    expect(await prisma.tripHeroImage.findUnique({ where: { id: secondHero.id } })).toMatchObject({
      state: "DELETION_PENDING",
      activeSlot: null,
      cleanupAttempts: 1,
      lastStorageError: "STORAGE_DELETE_FAILED",
    });
    expect((await authorizedRequest(secondHero.contentPath, token!)).status).toBe(404);
    expect(mediaStorage.hasObject(secondStored.storageObjectKey)).toBe(true);

    const retry = await authorizedRequest(secondHero.contentPath, token!, { method: "DELETE" });
    expect(retry.status).toBe(200);
    expect(await prisma.tripHeroImage.findUnique({ where: { id: secondHero.id } })).toBeNull();
    expect(mediaStorage.hasObject(secondStored.storageObjectKey)).toBe(false);
  });
});

describe("Foundation Phase E notifications", () => {
  async function createDatedFixture(
    actorUserId = env.DUODATE_USER_ONE_ID,
    now = new Date(),
  ) {
    const ideaId = await createPlanningIdea({
      title: "Private riverside surprise",
      specificLocation: "Private hidden location",
    });
    const schedule = await createTestSchedule(ideaId);
    const memory = await datedService.dateSchedule(
      env.DUODATE_HOUSEHOLD_ID,
      actorUserId,
      schedule.id,
      now,
    );
    return { ideaId, schedule, memory, now };
  }

  test("Device registration binds the authenticated session and safely transfers an installation", async () => {
    const first = await signIn("pablo-test", firstPassphrase, "notification-device-first");
    const second = await signIn("luane-test", secondPassphrase, "notification-device-second");

    const invalidToken = await registerDevice(
      first.token!,
      "notification-installation",
      "not-an-expo-token",
    );
    expect(invalidToken.status).toBe(400);

    const firstRegistration = await registerDevice(
      first.token!,
      "notification-installation",
      "ExpoPushToken[first-device-token]",
    );
    expect(firstRegistration.status).toBe(201);
    const firstDevice = await prisma.device.findUniqueOrThrow({
      where: {
        userId_installationId: {
          userId: env.DUODATE_USER_ONE_ID,
          installationId: "notification-installation",
        },
      },
    });
    expect(firstDevice.authSessionId).not.toBeNull();

    const transferred = await registerDevice(
      second.token!,
      "notification-installation",
      "ExpoPushToken[second-device-token]",
    );
    expect(transferred.status).toBe(201);
    expect(await prisma.device.findUnique({ where: { id: firstDevice.id } })).toMatchObject({
      pushToken: null,
      authSessionId: null,
    });
    expect((await prisma.device.findUnique({ where: { id: firstDevice.id } }))?.revokedAt).not.toBeNull();

    const activeDevice = await prisma.device.findUniqueOrThrow({
      where: {
        userId_installationId: {
          userId: env.DUODATE_USER_TWO_ID,
          installationId: "notification-installation",
        },
      },
    });
    expect(activeDevice.pushToken).toBe("ExpoPushToken[second-device-token]");
    expect(activeDevice.authSessionId).not.toBeNull();

    const logout = await authorizedRequest("/api/auth/session/revoke", second.token!, { method: "POST" });
    expect(logout.status).toBe(204);
    expect(await prisma.device.findUnique({ where: { id: activeDevice.id } })).toMatchObject({
      pushToken: null,
      authSessionId: null,
    });
    expect((await prisma.device.findUnique({ where: { id: activeDevice.id } }))?.revokedAt).not.toBeNull();
  });

  test("Dated creates deduplicated partner and reminder intents with a private minimal payload", async () => {
    const partner = await signIn("luane-test", secondPassphrase, "notification-partner");
    expect(await registerDevice(
      partner.token!,
      "notification-partner-device",
      "ExpoPushToken[partner-private-token]",
    )).toHaveProperty("status", 201);
    const { memory, now } = await createDatedFixture();

    await Promise.all([
      dispatchContributionInvite(memory.id, now),
      runNotificationSweep(now),
    ]);

    const intents = await prisma.notificationIntent.findMany({
      where: { memoryId: memory.id },
      orderBy: [{ type: "asc" }, { recipientUserId: "asc" }],
    });
    expect(intents).toHaveLength(3);
    expect(intents.filter(({ type }) => type === "MEMORY_CONTRIBUTION_INVITE")).toHaveLength(1);
    expect(intents.find(({ type }) => type === "MEMORY_CONTRIBUTION_INVITE")).toMatchObject({
      actorUserId: env.DUODATE_USER_ONE_ID,
      recipientUserId: env.DUODATE_USER_TWO_ID,
    });
    expect(intents.filter(({ type }) => type === "MEMORY_CAPTURE_REMINDER").map(({ recipientUserId }) => recipientUserId).sort()).toEqual(
      [env.DUODATE_USER_ONE_ID, env.DUODATE_USER_TWO_ID].sort(),
    );
    expect(pushProvider.sentMessages).toHaveLength(1);
    expect(pushProvider.sentMessages[0]).toEqual({
      to: "ExpoPushToken[partner-private-token]",
      title: "DuoDate",
      body: "Pablo Test added a date to your memories. Add something from your side ♡",
      data: { type: "MEMORY_CONTRIBUTION_INVITE", memoryId: memory.id },
      channelId: "memory-prompts",
    });
    const serializedPayload = JSON.stringify(pushProvider.sentMessages[0]);
    expect(serializedPayload).not.toContain("Private riverside surprise");
    expect(serializedPayload).not.toContain("Private hidden location");

    await dispatchContributionInvite(memory.id, new Date(now.getTime() + 1_000));
    expect(pushProvider.sentMessages).toHaveLength(1);
    expect(await prisma.notificationIntent.count({ where: { memoryId: memory.id } })).toBe(3);
  });

  test("a stale session cannot receive private pushes and re-registration restores eligibility", async () => {
    const firstSession = await signIn("luane-test", secondPassphrase, "notification-stale-session");
    await registerDevice(
      firstSession.token!,
      "notification-stale-device",
      "ExpoPushToken[stale-session-token]",
    );
    const device = await prisma.device.findFirstOrThrow({
      where: { installationId: "notification-stale-device" },
    });
    await prisma.authSession.update({
      where: { id: device.authSessionId! },
      data: { revokedAt: new Date() },
    });
    const { memory, now } = await createDatedFixture();
    await dispatchContributionInvite(memory.id, now);
    expect(pushProvider.sentMessages).toHaveLength(0);
    expect(await prisma.notificationIntent.findFirst({
      where: { memoryId: memory.id, type: "MEMORY_CONTRIBUTION_INVITE" },
    })).toMatchObject({ attemptCount: 1, lastErrorCode: "NO_ELIGIBLE_DEVICE" });

    const replacementSession = await signIn("luane-test", secondPassphrase, "notification-replacement-session");
    await registerDevice(
      replacementSession.token!,
      "notification-stale-device",
      "ExpoPushToken[replacement-session-token]",
    );
    await dispatchContributionInvite(memory.id, new Date(now.getTime() + 16 * 60 * 1000));
    expect(pushProvider.sentMessages.map(({ to }) => to)).toEqual([
      "ExpoPushToken[replacement-session-token]",
    ]);
  });

  test("a temporarily ineligible delivery resumes after the same installation re-registers", async () => {
    const firstSession = await signIn("luane-test", secondPassphrase, "notification-resume-first");
    await registerDevice(
      firstSession.token!,
      "notification-resume-device",
      "ExpoPushToken[resume-first-token]",
    );
    pushProvider.queueSendResult({ status: "transient", code: "MessageRateExceeded" });

    const { memory, now } = await createDatedFixture();
    await dispatchContributionInvite(memory.id, now);
    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { intent: { memoryId: memory.id, type: "MEMORY_CONTRIBUTION_INVITE" } },
      include: { device: true },
    });
    expect(delivery).toMatchObject({ status: "PENDING", attemptCount: 1 });

    await prisma.authSession.update({
      where: { id: delivery.device.authSessionId! },
      data: { revokedAt: new Date() },
    });
    await dispatchContributionInvite(memory.id, new Date(now.getTime() + 16 * 60 * 1000));
    expect(await prisma.notificationDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({
      status: "CANCELLED",
      lastErrorCode: "DEVICE_NO_LONGER_ELIGIBLE",
    });

    const replacementSession = await signIn(
      "luane-test",
      secondPassphrase,
      "notification-resume-replacement",
    );
    await registerDevice(
      replacementSession.token!,
      "notification-resume-device",
      "ExpoPushToken[resume-replacement-token]",
    );
    await dispatchContributionInvite(memory.id, new Date(now.getTime() + 32 * 60 * 1000));

    expect(pushProvider.sentMessages.map(({ to }) => to)).toEqual([
      "ExpoPushToken[resume-first-token]",
      "ExpoPushToken[resume-replacement-token]",
    ]);
    expect(await prisma.notificationDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({
      status: "RECEIPT_PENDING",
      attemptCount: 2,
      cancelledAt: null,
      lastErrorCode: null,
    });
  });

  test("per-device retries do not resend to a device that already has an accepted ticket", async () => {
    const firstSession = await signIn("luane-test", secondPassphrase, "notification-multi-device-one");
    await registerDevice(
      firstSession.token!,
      "notification-device-one",
      "ExpoPushToken[multi-device-one]",
    );
    const secondSession = await signIn("luane-test", secondPassphrase, "notification-multi-device-two");
    await registerDevice(
      secondSession.token!,
      "notification-device-two",
      "ExpoPushToken[multi-device-two]",
    );
    pushProvider.queueSendResult({ status: "accepted", ticketId: "accepted-device-ticket" });
    pushProvider.queueSendResult({ status: "transient", code: "MessageRateExceeded" });

    const { memory, now } = await createDatedFixture();
    await dispatchContributionInvite(memory.id, now);
    expect(pushProvider.sentMessages).toHaveLength(2);
    const deliveries = await prisma.notificationDelivery.findMany({
      where: { intent: { memoryId: memory.id, type: "MEMORY_CONTRIBUTION_INVITE" } },
      include: { device: true },
    });
    const acceptedToken = deliveries.find(({ status }) => status === "RECEIPT_PENDING")?.device.pushToken;
    const retryToken = deliveries.find(({ status }) => status === "PENDING")?.device.pushToken;
    expect(acceptedToken).toBeString();
    expect(retryToken).toBeString();

    await dispatchContributionInvite(memory.id, new Date(now.getTime() + 16 * 60 * 1000));
    expect(pushProvider.sentMessages.filter(({ to }) => to === acceptedToken)).toHaveLength(1);
    expect(pushProvider.sentMessages.filter(({ to }) => to === retryToken)).toHaveLength(2);
  });

  test("receipts finalize delivery and DeviceNotRegistered disables only the invalid Device", async () => {
    const firstSession = await signIn("luane-test", secondPassphrase, "notification-receipt-one");
    await registerDevice(
      firstSession.token!,
      "notification-receipt-device-one",
      "ExpoPushToken[receipt-device-one]",
    );
    const secondSession = await signIn("luane-test", secondPassphrase, "notification-receipt-two");
    await registerDevice(
      secondSession.token!,
      "notification-receipt-device-two",
      "ExpoPushToken[receipt-device-two]",
    );
    pushProvider.queueSendResult({ status: "accepted", ticketId: "receipt-delivered-ticket" });
    pushProvider.queueSendResult({ status: "accepted", ticketId: "receipt-invalid-ticket" });

    const { memory, now } = await createDatedFixture();
    await dispatchContributionInvite(memory.id, now);
    pushProvider.setReceipt("receipt-delivered-ticket", { status: "delivered" });
    pushProvider.setReceipt("receipt-invalid-ticket", {
      status: "permanent",
      code: "DeviceNotRegistered",
    });
    const sweep = await runNotificationSweep(new Date(now.getTime() + 16 * 60 * 1000));
    expect(sweep.receiptsChecked).toBe(2);

    const intent = await prisma.notificationIntent.findFirstOrThrow({
      where: { memoryId: memory.id, type: "MEMORY_CONTRIBUTION_INVITE" },
    });
    expect(intent.status).toBe("SENT");
    const invalidDelivery = await prisma.notificationDelivery.findUniqueOrThrow({
      where: { expoTicketId: "receipt-invalid-ticket" },
      include: { device: true },
    });
    expect(invalidDelivery.status).toBe("FAILED");
    expect(invalidDelivery.device).toMatchObject({ disabledAt: expect.any(Date), pushToken: null });
  });

  test("no-device retries are delayed and bounded", async () => {
    const { memory, now } = await createDatedFixture();
    const intent = await prisma.notificationIntent.findFirstOrThrow({
      where: { memoryId: memory.id, type: "MEMORY_CONTRIBUTION_INVITE" },
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await processNotificationIntent(intent.id, new Date(now.getTime() + attempt * 24 * 60 * 60 * 1000));
    }
    expect(await prisma.notificationIntent.findUnique({ where: { id: intent.id } })).toMatchObject({
      status: "FAILED",
      attemptCount: 5,
      lastErrorCode: "NO_ELIGIBLE_DEVICE",
    });
    expect(pushProvider.sentMessages).toHaveLength(0);
  });

  test("an unresolved Memory sends one due reminder per eligible member Device", async () => {
    const first = await signIn("pablo-test", firstPassphrase, "notification-reminder-first");
    const second = await signIn("luane-test", secondPassphrase, "notification-reminder-second");
    await registerDevice(first.token!, "notification-reminder-one", "ExpoPushToken[reminder-one]");
    await registerDevice(second.token!, "notification-reminder-two", "ExpoPushToken[reminder-two]");
    const { memory, now } = await createDatedFixture();

    await runNotificationSweep(new Date(memory.captureDueAt!.getTime() - 1));
    expect(pushProvider.sentMessages.filter(({ data }) => data.type === "MEMORY_CAPTURE_REMINDER")).toHaveLength(0);
    await runNotificationSweep(memory.captureDueAt!);
    await runNotificationSweep(new Date(memory.captureDueAt!.getTime() + 1_000));

    const reminders = pushProvider.sentMessages.filter(
      ({ data }) => data.type === "MEMORY_CAPTURE_REMINDER",
    );
    expect(reminders).toHaveLength(2);
    expect(new Set(reminders.map(({ to }) => to))).toEqual(
      new Set(["ExpoPushToken[reminder-one]", "ExpoPushToken[reminder-two]"]),
    );
    expect(reminders.every(({ data }) => data.memoryId === memory.id)).toBe(true);
    expect(reminders.every(({ body }) => !body.includes("Private riverside surprise"))).toBe(true);
    expect(await prisma.notificationIntent.count({
      where: { memoryId: memory.id, type: "MEMORY_CAPTURE_REMINDER" },
    })).toBe(2);
    expect(now.getTime()).toBeLessThan(memory.captureDueAt!.getTime());
  });

  test("valid content cancels reminders permanently even if final content is later deleted", async () => {
    const { memory } = await createDatedFixture();
    const contribution = await memoryService.addContribution(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      memory.id,
      { kind: "TEXT", text: "A private shared detail", sortOrder: 0 },
    );
    expect(await prisma.notificationIntent.findMany({
      where: { memoryId: memory.id, type: "MEMORY_CAPTURE_REMINDER" },
    })).toEqual([
      expect.objectContaining({ status: "CANCELLED", lastErrorCode: "MEMORY_CONTENT_VALID" }),
      expect.objectContaining({ status: "CANCELLED", lastErrorCode: "MEMORY_CONTENT_VALID" }),
    ]);

    await memoryService.deleteContribution(
      env.DUODATE_HOUSEHOLD_ID,
      env.DUODATE_USER_ONE_ID,
      memory.id,
      contribution.contribution.id,
    );
    expect(await prisma.memory.findUnique({ where: { id: memory.id } })).toMatchObject({
      status: "CAPTURE_REQUIRED",
      captureDueAt: memory.captureDueAt,
    });
    await runNotificationSweep(new Date(memory.captureDueAt!.getTime() + 24 * 60 * 60 * 1000));
    expect(await prisma.notificationIntent.count({
      where: { memoryId: memory.id, type: "MEMORY_CAPTURE_REMINDER" },
    })).toBe(2);
    expect(pushProvider.sentMessages.filter(({ data }) => data.type === "MEMORY_CAPTURE_REMINDER")).toHaveLength(0);
  });

  test("transient provider request failures remain retryable without rolling back Dated", async () => {
    const partner = await signIn("luane-test", secondPassphrase, "notification-provider-failure");
    await registerDevice(
      partner.token!,
      "notification-provider-failure-device",
      "ExpoPushToken[provider-failure-token]",
    );
    pushProvider.queueSendResult(new PushProviderRequestError("EXPO_UNAVAILABLE", true));
    const { memory, schedule, ideaId, now } = await createDatedFixture();

    await dispatchContributionInvite(memory.id, now);
    expect(await prisma.schedule.findUnique({ where: { id: schedule.id } })).toMatchObject({
      status: "COMPLETED",
    });
    expect(await prisma.idea.findUnique({ where: { id: ideaId } })).toMatchObject({
      lifecycle: "COMPLETED",
    });
    expect(await prisma.memory.findUnique({ where: { id: memory.id } })).not.toBeNull();
    expect(await prisma.notificationDelivery.findFirst({
      where: { intent: { memoryId: memory.id, type: "MEMORY_CONTRIBUTION_INVITE" } },
    })).toMatchObject({ status: "PENDING", lastErrorCode: "EXPO_UNAVAILABLE" });

    await dispatchContributionInvite(memory.id, new Date(now.getTime() + 16 * 60 * 1000));
    expect(pushProvider.sentMessages).toHaveLength(2);
  });
});
