import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
export const MEDIA_ENCRYPTION_VERSION = 1;

export interface MediaAssociatedData {
  mediaId: string;
  householdId: string;
  memoryId: string;
  uploaderId: string;
  kind: "PHOTO" | "VIDEO" | "VOICE_NOTE";
  contentType: string;
  byteSize: number;
  encryptionVersion: number;
  keyVersion: number;
}

export interface IdeaImageAssociatedData {
  imageId: string;
  householdId: string;
  ideaId: string;
  uploaderId: string;
  contentType: string;
  byteSize: number;
  encryptionVersion: number;
  keyVersion: number;
}

export interface TripHeroImageAssociatedData {
  imageId: string;
  householdId: string;
  tripId: string;
  uploaderId: string;
  contentType: string;
  byteSize: number;
  encryptionVersion: number;
  keyVersion: number;
}

export interface EncryptedMediaObject {
  ciphertext: Uint8Array;
  encryptedDataKey: string;
  keyWrapNonce: string;
  keyWrapAuthTag: string;
  nonce: string;
  authTag: string;
}

export interface StoredEncryptionMetadata {
  encryptedDataKey: string;
  keyWrapNonce: string;
  keyWrapAuthTag: string;
  nonce: string;
  authTag: string;
}

export class MediaIntegrityError extends Error {
  constructor() {
    super("Media authentication failed");
    this.name = "MediaIntegrityError";
  }
}

function mediaAssociatedDataBytes(data: MediaAssociatedData): Buffer {
  return Buffer.from(
    JSON.stringify([
      "duodate-media",
      data.mediaId,
      data.householdId,
      data.memoryId,
      data.uploaderId,
      data.kind,
      data.contentType,
      data.byteSize,
      data.encryptionVersion,
      data.keyVersion,
    ]),
    "utf8",
  );
}

function ideaImageAssociatedDataBytes(data: IdeaImageAssociatedData): Buffer {
  return Buffer.from(
    JSON.stringify([
      "duodate-idea-image",
      data.imageId,
      data.householdId,
      data.ideaId,
      data.uploaderId,
      data.contentType,
      data.byteSize,
      data.encryptionVersion,
      data.keyVersion,
    ]),
    "utf8",
  );
}

function tripHeroImageAssociatedDataBytes(data: TripHeroImageAssociatedData): Buffer {
  return Buffer.from(
    JSON.stringify([
      "duodate-trip-hero-image",
      data.imageId,
      data.householdId,
      data.tripId,
      data.uploaderId,
      data.contentType,
      data.byteSize,
      data.encryptionVersion,
      data.keyVersion,
    ]),
    "utf8",
  );
}

function wrapAssociatedDataBytes(associatedData: Buffer): Buffer {
  return Buffer.concat([associatedData, Buffer.from("|wrapped-data-key", "utf8")]);
}

function decodeBase64(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (!value || decoded.length === 0) throw new MediaIntegrityError();
  return decoded;
}

export function decodeMediaMasterKey(value: string): Uint8Array {
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32) throw new Error("Media master key must decode to exactly 32 bytes");
  return Uint8Array.from(key);
}

function encryptPrivateObject(
  plaintext: Uint8Array,
  masterKey: Uint8Array,
  associatedData: Buffer,
): EncryptedMediaObject {
  if (masterKey.byteLength !== 32) throw new Error("Media master key must be 32 bytes");

  const dataKey = randomBytes(32);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, dataKey, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(associatedData);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const keyWrapNonce = randomBytes(NONCE_BYTES);
  const keyCipher = createCipheriv(ALGORITHM, masterKey, keyWrapNonce, {
    authTagLength: TAG_BYTES,
  });
  keyCipher.setAAD(wrapAssociatedDataBytes(associatedData));
  const encryptedDataKey = Buffer.concat([keyCipher.update(dataKey), keyCipher.final()]);
  const keyWrapAuthTag = keyCipher.getAuthTag();
  dataKey.fill(0);

  return {
    ciphertext: Uint8Array.from(ciphertext),
    encryptedDataKey: encryptedDataKey.toString("base64"),
    keyWrapNonce: keyWrapNonce.toString("base64"),
    keyWrapAuthTag: keyWrapAuthTag.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

function decryptPrivateObject(
  ciphertext: Uint8Array,
  metadata: StoredEncryptionMetadata,
  masterKey: Uint8Array,
  associatedData: Buffer,
): Uint8Array {
  if (masterKey.byteLength !== 32) throw new MediaIntegrityError();

  let dataKey: Buffer | undefined;
  try {
    const keyDecipher = createDecipheriv(
      ALGORITHM,
      masterKey,
      decodeBase64(metadata.keyWrapNonce),
      { authTagLength: TAG_BYTES },
    );
    keyDecipher.setAAD(wrapAssociatedDataBytes(associatedData));
    keyDecipher.setAuthTag(decodeBase64(metadata.keyWrapAuthTag));
    dataKey = Buffer.concat([
      keyDecipher.update(decodeBase64(metadata.encryptedDataKey)),
      keyDecipher.final(),
    ]);
    if (dataKey.byteLength !== 32) throw new MediaIntegrityError();

    const decipher = createDecipheriv(
      ALGORITHM,
      dataKey,
      decodeBase64(metadata.nonce),
      { authTagLength: TAG_BYTES },
    );
    decipher.setAAD(associatedData);
    decipher.setAuthTag(decodeBase64(metadata.authTag));
    return Uint8Array.from(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  } catch {
    throw new MediaIntegrityError();
  } finally {
    dataKey?.fill(0);
  }
}

export function encryptMediaObject(
  plaintext: Uint8Array,
  masterKey: Uint8Array,
  associatedData: MediaAssociatedData,
): EncryptedMediaObject {
  return encryptPrivateObject(plaintext, masterKey, mediaAssociatedDataBytes(associatedData));
}

export function decryptMediaObject(
  ciphertext: Uint8Array,
  metadata: StoredEncryptionMetadata,
  masterKey: Uint8Array,
  associatedData: MediaAssociatedData,
): Uint8Array {
  return decryptPrivateObject(
    ciphertext,
    metadata,
    masterKey,
    mediaAssociatedDataBytes(associatedData),
  );
}

export function encryptIdeaImageObject(
  plaintext: Uint8Array,
  masterKey: Uint8Array,
  associatedData: IdeaImageAssociatedData,
): EncryptedMediaObject {
  return encryptPrivateObject(plaintext, masterKey, ideaImageAssociatedDataBytes(associatedData));
}

export function decryptIdeaImageObject(
  ciphertext: Uint8Array,
  metadata: StoredEncryptionMetadata,
  masterKey: Uint8Array,
  associatedData: IdeaImageAssociatedData,
): Uint8Array {
  return decryptPrivateObject(
    ciphertext,
    metadata,
    masterKey,
    ideaImageAssociatedDataBytes(associatedData),
  );
}

export function encryptTripHeroImageObject(
  plaintext: Uint8Array,
  masterKey: Uint8Array,
  associatedData: TripHeroImageAssociatedData,
): EncryptedMediaObject {
  return encryptPrivateObject(plaintext, masterKey, tripHeroImageAssociatedDataBytes(associatedData));
}

export function decryptTripHeroImageObject(
  ciphertext: Uint8Array,
  metadata: StoredEncryptionMetadata,
  masterKey: Uint8Array,
  associatedData: TripHeroImageAssociatedData,
): Uint8Array {
  return decryptPrivateObject(
    ciphertext,
    metadata,
    masterKey,
    tripHeroImageAssociatedDataBytes(associatedData),
  );
}
