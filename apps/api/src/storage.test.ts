import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { LocalBlobStorage } from './storage.js';

const collect = async (stream: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
};

describe('LocalBlobStorage', () => {
  const store = new LocalBlobStorage(mkdtempSync(join(tmpdir(), 'blob-test-')));

  it('round-trips bytes through put/get', async () => {
    const payload = Buffer.from('fake video bytes 🎥');
    await store.putStream('videos/abc/clip.mp4', Readable.from(payload));
    expect(await store.exists('videos/abc/clip.mp4')).toBe(true);
    expect((await collect(await store.getStream('videos/abc/clip.mp4'))).equals(payload)).toBe(
      true,
    );
  });

  it('reports missing keys', async () => {
    expect(await store.exists('videos/nope.mp4')).toBe(false);
  });

  it('rejects path-traversal keys', async () => {
    await expect(store.putStream('../escape.mp4', Readable.from('x'))).rejects.toThrow(
      /Invalid storage key/,
    );
  });

  it('removes blobs idempotently', async () => {
    await store.putStream('videos/gone.mp4', Readable.from('x'));
    await store.remove('videos/gone.mp4');
    await store.remove('videos/gone.mp4');
    expect(await store.exists('videos/gone.mp4')).toBe(false);
  });
});
