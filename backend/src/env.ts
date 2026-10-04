import { z } from "zod";

const optionalEnvString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

const mediaMasterKeySchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z
    .string()
    .regex(/^[A-Za-z0-9+/]{43}=$/, "MEDIA_MASTER_KEY must be standard base64")
    .refine((value) => Buffer.from(value, "base64").byteLength === 32, {
      message: "MEDIA_MASTER_KEY must decode to exactly 32 bytes",
    })
    .optional(),
);

const booleanEnvSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "") return undefined;
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return value;
}, z.boolean().optional());

export const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1).default("file:./dev.db"),
  BACKEND_URL: z.string().url().default("http://localhost:3000"),
  DUODATE_HOUSEHOLD_ID: z.string().min(1).default("duodate-household"),
  DUODATE_USER_ONE_ID: z.string().min(1).default("duodate-user-one"),
  DUODATE_USER_TWO_ID: z.string().min(1).default("duodate-user-two"),
  // Available by default only in development; an explicit false still disables it.
  DUODATE_DEV_AUTH_BYPASS: booleanEnvSchema,
  DUODATE_DEFAULT_TIME_ZONE: z.string().min(1).default("Europe/Berlin"),
  DUODATE_USER_ONE_DISPLAY_NAME: z.string().min(1).optional(),
  DUODATE_USER_ONE_HANDLE: z.string().min(1).optional(),
  DUODATE_USER_ONE_PASSPHRASE: z.string().min(12).optional(),
  DUODATE_USER_TWO_DISPLAY_NAME: z.string().min(1).optional(),
  DUODATE_USER_TWO_HANDLE: z.string().min(1).optional(),
  DUODATE_USER_TWO_PASSPHRASE: z.string().min(12).optional(),
  AUTH_SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(180),
  AUTH_ROLLING_WINDOW_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  EXPO_PUSH_ACCESS_TOKEN: optionalEnvString,
  MEDIA_STORAGE_ENDPOINT: optionalEnvString,
  MEDIA_STORAGE_ACCESS_KEY_ID: optionalEnvString,
  MEDIA_STORAGE_SECRET_ACCESS_KEY: optionalEnvString,
  MEDIA_STORAGE_BUCKET: optionalEnvString,
  MEDIA_STORAGE_REGION: z.string().min(1).default("auto"),
  MEDIA_STORAGE_DIRECTORY: optionalEnvString,
  MEDIA_MASTER_KEY: mediaMasterKeySchema,
  MEDIA_MASTER_KEY_VERSION: z.coerce.number().int().positive().default(1),
  MEDIA_PHOTO_MAX_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  MEDIA_VIDEO_MAX_BYTES: z.coerce.number().int().positive().default(250 * 1024 * 1024),
  MEDIA_VOICE_NOTE_MAX_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  MEDIA_PENDING_CLEANUP_MINUTES: z.coerce.number().int().min(5).default(60),
}).transform((value) => ({
  ...value,
  DUODATE_DEV_AUTH_BYPASS:
    value.DUODATE_DEV_AUTH_BYPASS ?? value.NODE_ENV === "development",
})).superRefine((value, context) => {
  const s3StorageValues = [
    value.MEDIA_STORAGE_ENDPOINT,
    value.MEDIA_STORAGE_ACCESS_KEY_ID,
    value.MEDIA_STORAGE_SECRET_ACCESS_KEY,
    value.MEDIA_STORAGE_BUCKET,
  ];
  const configuredS3ValueCount = s3StorageValues.filter(Boolean).length;
  if (configuredS3ValueCount !== 0 && configuredS3ValueCount !== s3StorageValues.length) {
    context.addIssue({
      code: "custom",
      path: ["MEDIA_STORAGE_ENDPOINT"],
      message:
        "S3 media storage is partially configured; endpoint, access key, secret key, and bucket must be supplied together",
    });
  }
  if (configuredS3ValueCount > 0 && !value.MEDIA_MASTER_KEY) {
    context.addIssue({
      code: "custom",
      path: ["MEDIA_MASTER_KEY"],
      message: "MEDIA_MASTER_KEY is required when S3 media storage is configured",
    });
  }
  if (value.DUODATE_DEV_AUTH_BYPASS && value.NODE_ENV !== "development") {
    context.addIssue({
      code: "custom",
      path: ["DUODATE_DEV_AUTH_BYPASS"],
      message: "DUODATE_DEV_AUTH_BYPASS may only be enabled in development",
    });
  }
});

function validateEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error("Environment variable validation failed:");
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  console.log("Environment variables validated successfully");
  return parsed.data;
}

export const env = validateEnv();
export type Env = z.infer<typeof envSchema>;
