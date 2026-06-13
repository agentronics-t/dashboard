// Object storage behind one interface: GCS in prod, local FS in tests.
// Keys are the canonical paths from @agentronics/intel-schema (no gs:// prefix).

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";

export interface ObjectStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  /** Fully-qualified URI for job bookkeeping (gs://… or file://…). */
  uri(key: string): string;
}

export class LocalFsStorage implements ObjectStorage {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  private resolve(key: string): string {
    const path = normalize(join(this.rootDir, key));
    if (!path.startsWith(normalize(this.rootDir) + sep)) {
      throw new Error(`key escapes storage root: ${key}`);
    }
    return path;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.resolve(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  uri(key: string): string {
    return `file://${this.resolve(key)}`;
  }
}

export class GcsStorage implements ObjectStorage {
  // Lazy import keeps @google-cloud/storage out of unit tests.
  private bucketPromise: Promise<import("@google-cloud/storage").Bucket> | undefined;
  private readonly bucketName: string;

  constructor(bucketName: string) {
    this.bucketName = bucketName;
  }

  private async bucket() {
    this.bucketPromise ??= import("@google-cloud/storage").then(
      ({ Storage }) => new Storage().bucket(this.bucketName)
    );
    return this.bucketPromise;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const bucket = await this.bucket();
    await bucket.file(key).save(data, { resumable: false });
  }

  async get(key: string): Promise<Buffer> {
    const bucket = await this.bucket();
    const [data] = await bucket.file(key).download();
    return data;
  }

  async exists(key: string): Promise<boolean> {
    const bucket = await this.bucket();
    const [ok] = await bucket.file(key).exists();
    return ok;
  }

  uri(key: string): string {
    return `gs://${this.bucketName}/${key}`;
  }
}

export function storageFromEnv(): ObjectStorage {
  const bucket = process.env.GCS_BUCKET;
  if (!bucket) throw new Error("GCS_BUCKET is not set");
  return new GcsStorage(bucket);
}
