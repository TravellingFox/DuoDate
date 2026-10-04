import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ObjectStorage } from "./object-storage";

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function loadOrCreateFileMasterKey(directory: string, keyVersion: number): Uint8Array {
  const root = resolve(directory);
  const keyPath = join(root, `.master-key-v${keyVersion}`);
  mkdirSync(root, { recursive: true, mode: 0o700 });

  try {
    const existing = readFileSync(keyPath);
    if (existing.byteLength !== 32) throw new Error("Local media master key must be exactly 32 bytes");
    return Uint8Array.from(existing);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  const generated = randomBytes(32);
  try {
    writeFileSync(keyPath, generated, { flag: "wx", mode: 0o600 });
    return Uint8Array.from(generated);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    const existing = readFileSync(keyPath);
    if (existing.byteLength !== 32) throw new Error("Local media master key must be exactly 32 bytes");
    return Uint8Array.from(existing);
  }
}

export class FileObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(directory: string) {
    this.root = resolve(directory);
  }

  private objectPath(key: string): string {
    if (!key) throw new Error("Object key is required");
    const target = resolve(this.root, key);
    const pathFromRoot = relative(this.root, target);
    if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
      throw new Error("Object key must stay inside the private media directory");
    }
    return target;
  }

  async putObject(key: string, ciphertext: Uint8Array): Promise<void> {
    const target = this.objectPath(key);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporary, ciphertext, { flag: "wx", mode: 0o600 });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async getObject(key: string): Promise<Uint8Array> {
    return Uint8Array.from(await readFile(this.objectPath(key)));
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.objectPath(key), { force: true });
  }
}
