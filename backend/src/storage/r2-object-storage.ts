import type { ObjectStorage } from "./object-storage";

export interface S3CompatibleStorageConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
}

export class R2ObjectStorage implements ObjectStorage {
  private readonly client: Bun.S3Client;

  constructor(config: S3CompatibleStorageConfig) {
    this.client = new Bun.S3Client({
      endpoint: config.endpoint,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      bucket: config.bucket,
      region: config.region,
    });
  }

  async putObject(key: string, ciphertext: Uint8Array): Promise<void> {
    await this.client.write(key, ciphertext, { type: "application/octet-stream" });
  }

  async getObject(key: string): Promise<Uint8Array> {
    return new Uint8Array(await this.client.file(key).arrayBuffer());
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.delete(key);
  }
}
