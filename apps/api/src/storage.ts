import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, access, unlink } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

/**
 * Blob storage behind an interface so the domain flow doesn't care where
 * video bytes live. Dev uses the local filesystem; production swaps in a
 * GCS/Firebase Storage adapter (same three methods, keys become object
 * names, uploadUrl becomes a V4 signed URL) without touching route code.
 */
export interface BlobStorage {
  putStream(key: string, stream: Readable): Promise<void>;
  getStream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
}

export class LocalBlobStorage implements BlobStorage {
  constructor(private baseDir: string) {}

  private pathFor(key: string): string {
    const path = normalize(join(this.baseDir, key));
    if (!path.startsWith(this.baseDir)) throw new Error('Invalid storage key');
    return path;
  }

  async putStream(key: string, stream: Readable): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(stream, createWriteStream(path));
  }

  async getStream(key: string): Promise<Readable> {
    return createReadStream(this.pathFor(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch {
      // already gone
    }
  }
}

// Gitignored local directory next to the API (apps/api/var/uploads).
const defaultDir =
  process.env.UPLOADS_DIR ?? fileURLToPath(new URL('../var/uploads', import.meta.url));

export const storage: BlobStorage = new LocalBlobStorage(defaultDir);
