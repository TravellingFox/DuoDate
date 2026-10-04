import { fileURLToPath } from "node:url";
import { env } from "../env";
import { AppError } from "../lib/errors";
import { FileObjectStorage, loadOrCreateFileMasterKey } from "./file-object-storage";
import type { ObjectStorage } from "./object-storage";
import { R2ObjectStorage } from "./r2-object-storage";

export interface MediaStorageRuntime {
  storage: ObjectStorage;
  masterKeys: ReadonlyMap<number, Uint8Array>;
  currentKeyVersion: number;
}

let testRuntime: MediaStorageRuntime | undefined;
let configuredRuntime: MediaStorageRuntime | null | undefined;

function defaultLocalStorageDirectory(): string {
  if (env.NODE_ENV === "production") return "/data/private-media";
  return fileURLToPath(new URL("../../prisma/private-media", import.meta.url));
}

function buildConfiguredRuntime(): MediaStorageRuntime {
  const hasS3Storage = Boolean(
    env.MEDIA_STORAGE_ENDPOINT &&
    env.MEDIA_STORAGE_ACCESS_KEY_ID &&
    env.MEDIA_STORAGE_SECRET_ACCESS_KEY &&
    env.MEDIA_STORAGE_BUCKET,
  );
  const localDirectory = env.MEDIA_STORAGE_DIRECTORY ?? defaultLocalStorageDirectory();
  const masterKey = env.MEDIA_MASTER_KEY
    ? Uint8Array.from(Buffer.from(env.MEDIA_MASTER_KEY, "base64"))
    : loadOrCreateFileMasterKey(localDirectory, env.MEDIA_MASTER_KEY_VERSION);
  const storage = hasS3Storage
    ? new R2ObjectStorage({
        endpoint: env.MEDIA_STORAGE_ENDPOINT!,
        accessKeyId: env.MEDIA_STORAGE_ACCESS_KEY_ID!,
        secretAccessKey: env.MEDIA_STORAGE_SECRET_ACCESS_KEY!,
        bucket: env.MEDIA_STORAGE_BUCKET!,
        region: env.MEDIA_STORAGE_REGION,
      })
    : new FileObjectStorage(localDirectory);

  return {
    storage,
    masterKeys: new Map([[env.MEDIA_MASTER_KEY_VERSION, masterKey]]),
    currentKeyVersion: env.MEDIA_MASTER_KEY_VERSION,
  };
}

export function getMediaStorageRuntime(): MediaStorageRuntime {
  const runtime = testRuntime ?? (configuredRuntime ??= buildConfiguredRuntime());
  if (!runtime) {
    throw new AppError(
      503,
      "MEDIA_STORAGE_NOT_CONFIGURED",
      "Private media storage is not configured",
    );
  }
  return runtime;
}

export function setMediaStorageRuntimeForTests(runtime: MediaStorageRuntime | undefined): void {
  testRuntime = runtime;
}
