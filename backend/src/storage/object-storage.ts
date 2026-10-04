export interface ObjectStorage {
  putObject(key: string, ciphertext: Uint8Array): Promise<void>;
  getObject(key: string): Promise<Uint8Array>;
  deleteObject(key: string): Promise<void>;
}

export class FakeObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, Uint8Array>();
  failNextPut = false;
  failNextGet = false;
  failNextDelete = false;

  async putObject(key: string, ciphertext: Uint8Array): Promise<void> {
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error("Fake object write failed");
    }
    this.objects.set(key, Uint8Array.from(ciphertext));
  }

  async getObject(key: string): Promise<Uint8Array> {
    if (this.failNextGet) {
      this.failNextGet = false;
      throw new Error("Fake object read failed");
    }
    const object = this.objects.get(key);
    if (!object) throw new Error("Object not found");
    return Uint8Array.from(object);
  }

  async deleteObject(key: string): Promise<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error("Fake object deletion failed");
    }
    this.objects.delete(key);
  }

  peekObject(key: string): Uint8Array | undefined {
    const object = this.objects.get(key);
    return object ? Uint8Array.from(object) : undefined;
  }

  hasObject(key: string): boolean {
    return this.objects.has(key);
  }

  clear(): void {
    this.objects.clear();
    this.failNextPut = false;
    this.failNextGet = false;
    this.failNextDelete = false;
  }
}
