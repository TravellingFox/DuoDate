import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileObjectStorage, loadOrCreateFileMasterKey } from "./file-object-storage";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "duodate-private-media-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("FileObjectStorage", () => {
  test("round-trips and deletes encrypted bytes", async () => {
    const directory = await temporaryDirectory();
    const storage = new FileObjectStorage(directory);
    const bytes = Uint8Array.from([9, 8, 7, 6]);

    await storage.putObject("households/one/media.enc", bytes);

    expect(await storage.getObject("households/one/media.enc")).toEqual(bytes);
    expect(new Uint8Array(await readFile(join(directory, "households/one/media.enc")))).toEqual(bytes);

    await storage.deleteObject("households/one/media.enc");
    await expect(storage.getObject("households/one/media.enc")).rejects.toThrow();
  });

  test("rejects object keys outside the private directory", async () => {
    const storage = new FileObjectStorage(await temporaryDirectory());

    expect(storage.putObject("../outside.enc", Uint8Array.from([1]))).rejects.toThrow(
      "Object key must stay inside the private media directory",
    );
  });

  test("creates one persistent 32-byte master key per version", async () => {
    const directory = await temporaryDirectory();
    const first = loadOrCreateFileMasterKey(directory, 1);
    const second = loadOrCreateFileMasterKey(directory, 1);

    expect(first.byteLength).toBe(32);
    expect(second).toEqual(first);
  });
});
