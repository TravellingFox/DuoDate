import { z } from "zod";
import { normalizeWebsiteUrl } from "./lib/website";
import {
  calendarDateSchema,
  ianaTimeZoneSchema,
  localTimeSchema,
} from "./lib/date-time";

const idSchema = z.string().min(1);
const nullableText = z.string().trim().max(10_000).nullable().optional();
const sortOrderSchema = z.number().int().min(0).max(100_000);
const costCentsSchema = z.number().int().min(0).max(1_000_000_000);

export const authLoginSchema = z
  .object({
    handle: z.string().trim().min(1).max(80),
    passphrase: z.string().min(1).max(512),
    deviceLabel: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const devAuthProfileSchema = z.enum(["ONE", "TWO"]);

export const devAuthSessionSchema = z
  .object({
    profile: devAuthProfileSchema,
    deviceLabel: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const devAuthProfileSummarySchema = z
  .object({
    profile: devAuthProfileSchema,
    displayName: z.string().min(1),
  })
  .strict();

export const devAuthProfilesSchema = z.array(devAuthProfileSummarySchema);

export const householdMemberSummarySchema = z
  .object({
    id: idSchema,
    displayName: z.string().min(1),
  })
  .strict();

export const spaceCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    colorToken: z.string().trim().max(40).nullable().optional(),
    iconKey: z.string().trim().max(80).nullable().optional(),
    sortOrder: sortOrderSchema.default(0),
    timeZone: ianaTimeZoneSchema.nullable().optional(),
  })
  .strict();
export const spaceUpdateSchema = spaceCreateSchema.partial().strict();

export const categoryCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    sortOrder: sortOrderSchema.default(0),
  })
  .strict();
export const categoryUpdateSchema = categoryCreateSchema.partial().strict();

export const weatherSchema = z
  .object({
    sunny: z.enum(["NEUTRAL", "GOOD", "IMPOSSIBLE"]),
    rainy: z.enum(["NEUTRAL", "GOOD", "IMPOSSIBLE"]),
    indoor: z.enum(["NEUTRAL", "GOOD", "IMPOSSIBLE"]),
    outdoor: z.enum(["NEUTRAL", "GOOD", "IMPOSSIBLE"]),
  })
  .strict();

export const availabilitySchema = z
  .object({
    mode: z.enum(["ANYTIME", "DATE_RANGE", "SPECIFIC_OCCURRENCES"]),
    rangeStartDate: calendarDateSchema.nullable().optional(),
    rangeEndDate: calendarDateSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === "DATE_RANGE") {
      if (!value.rangeStartDate || !value.rangeEndDate) {
        context.addIssue({
          code: "custom",
          message: "DATE_RANGE requires rangeStartDate and rangeEndDate",
        });
      } else if (value.rangeStartDate > value.rangeEndDate) {
        context.addIssue({ code: "custom", message: "Availability start must not follow end" });
      }
    } else if (value.rangeStartDate || value.rangeEndDate) {
      context.addIssue({
        code: "custom",
        message: "Only DATE_RANGE availability may include range dates",
      });
    }
  });

export const recurrenceWeekdaySchema = z.enum([
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
]);

const recurrenceBoundsSchema = z
  .object({
    startDate: calendarDateSchema,
    endDate: calendarDateSchema.nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.endDate && value.startDate > value.endDate) {
      context.addIssue({ code: "custom", message: "Recurrence start must not follow end" });
    }
  });

const noRecurrenceSchema = z.object({ kind: z.literal("NONE") }).strict();
const weeklyRecurrenceSchema = recurrenceBoundsSchema
  .safeExtend({
    kind: z.literal("WEEKLY"),
    weekdays: z
      .array(recurrenceWeekdaySchema)
      .min(1)
      .max(7)
      .refine((weekdays) => new Set(weekdays).size === weekdays.length, {
        message: "Recurrence weekdays must be unique",
      }),
  })
  .strict();
const monthlyOrdinalWeekdayRecurrenceSchema = recurrenceBoundsSchema
  .safeExtend({
    kind: z.literal("MONTHLY_ORDINAL_WEEKDAY"),
    ordinal: z.number().int().min(1).max(5),
    weekday: recurrenceWeekdaySchema,
  })
  .strict();

export const ideaRecurrenceSchema = z.discriminatedUnion("kind", [
  noRecurrenceSchema,
  weeklyRecurrenceSchema,
  monthlyOrdinalWeekdayRecurrenceSchema,
]);

export const ideaLinkInputSchema = z
  .object({
    url: z.string().transform((value, context) => {
      const normalized = normalizeWebsiteUrl(value);
      if (!normalized) {
        context.addIssue({ code: "custom", message: "Enter a website such as abc.com or https://abc.com" });
        return z.NEVER;
      }
      return normalized;
    }),
    label: z.string().trim().max(120).nullable().optional(),
    sortOrder: sortOrderSchema.default(0),
  })
  .strict();

export const costBandSchema = z.enum([
  "FREE",
  "UNDER_20",
  "FROM_20_TO_50",
  "FROM_50_TO_100",
  "FROM_100",
]);
export const durationBandSchema = z.enum([
  "UNDER_ONE_HOUR",
  "ONE_TO_TWO_HOURS",
  "TWO_TO_FOUR_HOURS",
  "HALF_DAY",
  "FULL_DAY",
  "OVERNIGHT_OR_MULTI_DAY",
]);

export const occurrenceCreateSchema = z
  .object({
    localDate: calendarDateSchema,
    startLocalTime: localTimeSchema.nullable().optional(),
    endLocalTime: localTimeSchema.nullable().optional(),
    timeZone: ianaTimeZoneSchema.nullable().optional(),
  })
  .strict();

export const ideaCreateSchema = z
  .object({
    clientRequestId: z.string().trim().min(8).max(200).optional(),
    title: z.string().trim().min(1).max(200),
    categoryId: idSchema.nullable().optional(),
    specificLocation: z.string().trim().max(300).nullable().optional(),
    notes: nullableText,
    lifecycle: z.enum(["ACTIVE", "COMPLETED", "EXPIRED"]).optional(),
    costBand: costBandSchema.nullable().optional(),
    exactCostCents: costCentsSchema.nullable().optional(),
    durationBand: durationBandSchema.nullable().optional(),
    durationRank: z.number().int().min(1).max(6).nullable().optional(),
    spaceIds: z.array(idSchema).max(50).default([]),
    destinationIds: z.array(idSchema).max(50).default([]),
    links: z.array(ideaLinkInputSchema).max(30).default([]),
    weather: weatherSchema.optional(),
    availability: availabilitySchema.optional(),
    recurrence: ideaRecurrenceSchema.default({ kind: "NONE" }),
    occurrences: z.array(occurrenceCreateSchema).max(100).default([]),
  })
  .strict();

export const ideaUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    categoryId: idSchema.nullable().optional(),
    specificLocation: z.string().trim().max(300).nullable().optional(),
    notes: nullableText,
    lifecycle: z.enum(["ACTIVE", "COMPLETED", "EXPIRED"]).optional(),
    costBand: costBandSchema.nullable().optional(),
    exactCostCents: costCentsSchema.nullable().optional(),
    durationBand: durationBandSchema.nullable().optional(),
    durationRank: z.number().int().min(1).max(6).nullable().optional(),
    recurrence: ideaRecurrenceSchema.optional(),
  })
  .strict();

export const ideaSpacesSchema = z.object({ spaceIds: z.array(idSchema).max(50) }).strict();
export const ideaDestinationsSchema = z
  .object({ destinationIds: z.array(idSchema).max(50) })
  .strict();

export const occurrenceUpdateSchema = occurrenceCreateSchema.partial().strict();

export const destinationCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    timeZone: ianaTimeZoneSchema,
    country: z.string().trim().max(100).nullable().optional(),
    notes: nullableText,
    colorToken: z.string().trim().max(40).nullable().optional(),
  })
  .strict();
export const destinationUpdateSchema = destinationCreateSchema.partial().strict();

export const tripStatusSchema = z.enum(["ACTIVE", "UPCOMING", "PAST", "CANCELLED"]);

export const tripCreateSchema = z
  .object({
    destinationId: idSchema,
    name: z.string().trim().max(160).nullable().optional(),
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.startDate > value.endDate) {
      context.addIssue({ code: "custom", message: "Trip start must not follow trip end" });
    }
  });
export const tripUpdateSchema = z
  .object({
    destinationId: idSchema.optional(),
    name: z.string().trim().max(160).nullable().optional(),
    startDate: calendarDateSchema.optional(),
    endDate: calendarDateSchema.optional(),
  })
  .strict();

export const scheduleCreateSchema = z
  .object({
    ideaId: idSchema,
    occurrenceId: idSchema.nullable().optional(),
    scheduledDate: calendarDateSchema,
    startLocalTime: localTimeSchema.nullable().optional(),
    endLocalTime: localTimeSchema.nullable().optional(),
    timeZone: ianaTimeZoneSchema,
  })
  .strict();
export const scheduleUpdateSchema = z
  .object({
    occurrenceId: idSchema.nullable().optional(),
    scheduledDate: calendarDateSchema.optional(),
    startLocalTime: localTimeSchema.nullable().optional(),
    endLocalTime: localTimeSchema.nullable().optional(),
    timeZone: ianaTimeZoneSchema.optional(),
  })
  .strict();

export const ideaListQuerySchema = z
  .object({
    contextKind: z.enum(["SPACE", "TRIP"]).optional(),
    contextId: idSchema.optional(),
    targetDate: calendarDateSchema.optional(),
    scope: z.enum(["ELIGIBLE", "SAVED"]).default("ELIGIBLE"),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.contextKind === undefined) !== (value.contextId === undefined)) {
      context.addIssue({
        code: "custom",
        message: "contextKind and contextId must be supplied together",
      });
    }
  });

const letsDateContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("SPACE"), id: idSchema }).strict(),
  z.object({ kind: z.literal("TRIP"), id: idSchema }).strict(),
]);

const maximumBudgetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("BAND"),
      costBand: z.enum(["FREE", "UNDER_20", "FROM_20_TO_50", "FROM_50_TO_100"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("EXACT"),
      exactCostCents: costCentsSchema,
    })
    .strict(),
]);

export const letsDateRequestSchema = z
  .object({
    context: letsDateContextSchema.nullable().optional(),
    targetDate: calendarDateSchema.optional(),
    maximumBudget: maximumBudgetSchema.nullable().optional(),
    maximumDuration: durationBandSchema.nullable().optional(),
    weather: z.array(z.enum(["SUNNY", "RAINY", "INDOOR", "OUTDOOR"])).max(4).default([]),
  })
  .strict();

const expoPushTokenSchema = z
  .string()
  .trim()
  .max(500)
  .regex(/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/);

export const deviceRegistrationSchema = z
  .object({
    installationId: z.string().trim().min(8).max(200),
    pushToken: expoPushTokenSchema.nullable().optional(),
    platform: z.literal("ANDROID").default("ANDROID"),
    label: z.string().trim().max(120).nullable().optional(),
  })
  .strict();

export const deviceInstallationSchema = z
  .object({ installationId: z.string().trim().min(8).max(200) })
  .strict();

export const notificationTypeSchema = z.enum([
  "MEMORY_CONTRIBUTION_INVITE",
  "MEMORY_CAPTURE_REMINDER",
]);

export const notificationDataSchema = z
  .object({
    type: notificationTypeSchema,
    memoryId: idSchema,
  })
  .strict();

export const datedScheduleSchema = z.object({}).strict();

export const memoryListQuerySchema = z
  .object({
    captureState: z.enum(["CAPTURE_REQUIRED", "CONTENT_VALID"]).optional(),
  })
  .strict();

export const spontaneousMemoryCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    startDate: calendarDateSchema.optional(),
    endDate: calendarDateSchema.nullable().optional(),
    specificLocation: z.string().trim().max(300).nullable().optional(),
    initialText: z.string().trim().min(1).max(20_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.startDate && value.endDate && value.startDate > value.endDate) {
      context.addIssue({ code: "custom", message: "Memory start must not follow end" });
    }
  });

export const memoryUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    startDate: calendarDateSchema.optional(),
    endDate: calendarDateSchema.nullable().optional(),
    specificLocation: z.string().trim().max(300).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one Memory field is required");

export const memoryContributionCreateSchema = z
  .object({
    kind: z.literal("TEXT"),
    text: z.string().trim().min(1).max(20_000),
    sortOrder: sortOrderSchema.default(0),
    // Text POST only: reuse the contribution primary key, with no schema migration.
    clientRequestId: z.string().uuid().optional(),
  })
  .strict();

export const memoryContributionUpdateSchema = z
  .object({
    text: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const mediaKindSchema = z.enum(["PHOTO", "VIDEO", "VOICE_NOTE"]);

const optionalMultipartInteger = (maximum: number) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? undefined : value),
    z.coerce.number().int().min(0).max(maximum).optional(),
  );

export const memoryMediaUploadMetadataSchema = z
  .object({
    kind: mediaKindSchema,
    // Stable media primary key makes interrupted multipart retries idempotent.
    clientRequestId: z.string().uuid().optional(),
    caption: z.string().trim().max(2_000).optional(),
    sortOrder: optionalMultipartInteger(100_000),
    width: optionalMultipartInteger(100_000),
    height: optionalMultipartInteger(100_000),
    durationMs: optionalMultipartInteger(86_400_000),
  })
  .strict();

// New Idea attachments are photo-only. Existing attachment DTOs retain their
// contentType so previously stored videos remain readable.
export const ideaImageUploadMetadataSchema = z
  .object({
    kind: z.literal("PHOTO").default("PHOTO"),
    width: optionalMultipartInteger(100_000),
    height: optionalMultipartInteger(100_000),
  })
  .strict();
export const tripHeroImageUploadMetadataSchema = ideaImageUploadMetadataSchema.omit({ kind: true });

export const memoryMediaCaptionUpdateSchema = z
  .object({ caption: z.string().trim().max(2_000).nullable() })
  .strict();

export const memoryMediaReorderSchema = z
  .object({ mediaIds: z.array(idSchema).max(500) })
  .strict()
  .refine((value) => new Set(value.mediaIds).size === value.mediaIds.length, {
    message: "Media IDs must be unique",
  });

export const memoryCoverUpdateSchema = z.object({ mediaId: idSchema.nullable() }).strict();

export const doAgainSchema = z.object({}).strict();

export type AuthLoginInput = z.infer<typeof authLoginSchema>;
export type DevAuthProfile = z.infer<typeof devAuthProfileSchema>;
export type DevAuthSessionInput = z.infer<typeof devAuthSessionSchema>;
export type DevAuthProfileSummary = z.infer<typeof devAuthProfileSummarySchema>;
export type HouseholdMemberSummary = z.infer<typeof householdMemberSummarySchema>;
export type SpaceCreateInput = z.infer<typeof spaceCreateSchema>;
export type SpaceUpdateInput = z.infer<typeof spaceUpdateSchema>;
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;
export type IdeaCreateInput = z.infer<typeof ideaCreateSchema>;
export type IdeaUpdateInput = z.infer<typeof ideaUpdateSchema>;
export type IdeaRecurrenceInput = z.infer<typeof ideaRecurrenceSchema>;
export type RecurrenceWeekday = z.infer<typeof recurrenceWeekdaySchema>;
export type AvailabilityInput = z.infer<typeof availabilitySchema>;
export type WeatherInput = z.infer<typeof weatherSchema>;
export type IdeaLinkInput = z.infer<typeof ideaLinkInputSchema>;
export type OccurrenceCreateInput = z.infer<typeof occurrenceCreateSchema>;
export type OccurrenceUpdateInput = z.infer<typeof occurrenceUpdateSchema>;
export type DestinationCreateInput = z.infer<typeof destinationCreateSchema>;
export type DestinationUpdateInput = z.infer<typeof destinationUpdateSchema>;
export type TripStatus = z.infer<typeof tripStatusSchema>;
export type TripCreateInput = z.infer<typeof tripCreateSchema>;
export type TripUpdateInput = z.infer<typeof tripUpdateSchema>;
export type ScheduleCreateInput = z.infer<typeof scheduleCreateSchema>;
export type ScheduleUpdateInput = z.infer<typeof scheduleUpdateSchema>;
export type IdeaListQuery = z.infer<typeof ideaListQuerySchema>;
export type LetsDateRequest = z.infer<typeof letsDateRequestSchema>;
export type DeviceRegistrationInput = z.infer<typeof deviceRegistrationSchema>;
export type DeviceInstallationInput = z.infer<typeof deviceInstallationSchema>;
export type NotificationType = z.infer<typeof notificationTypeSchema>;
export type NotificationData = z.infer<typeof notificationDataSchema>;
export type MemoryListQuery = z.infer<typeof memoryListQuerySchema>;
export type SpontaneousMemoryCreateInput = z.infer<typeof spontaneousMemoryCreateSchema>;
export type MemoryUpdateInput = z.infer<typeof memoryUpdateSchema>;
export type MemoryContributionCreateInput = z.infer<typeof memoryContributionCreateSchema>;
export type MemoryContributionUpdateInput = z.infer<typeof memoryContributionUpdateSchema>;
export type MemoryMediaUploadMetadata = z.infer<typeof memoryMediaUploadMetadataSchema>;
export type IdeaImageUploadMetadata = z.infer<typeof ideaImageUploadMetadataSchema>;
export type TripHeroImageUploadMetadata = z.infer<typeof tripHeroImageUploadMetadataSchema>;
export type MemoryMediaCaptionUpdate = z.infer<typeof memoryMediaCaptionUpdateSchema>;
export type MemoryMediaReorderInput = z.infer<typeof memoryMediaReorderSchema>;
export type MemoryCoverUpdateInput = z.infer<typeof memoryCoverUpdateSchema>;

export interface PublicIdeaImageDto {
  id: string;
  ideaId: string;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  updatedAt: string;
  uploader: { id: string; displayName: string };
  contentPath: string;
}

export interface PublicTripHeroImageDto {
  id: string;
  tripId: string;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  updatedAt: string;
  uploader: { id: string; displayName: string };
  contentPath: string;
}
