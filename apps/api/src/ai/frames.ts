import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';

export interface Frame {
  mediaType: 'image/png';
  /** base64-encoded PNG bytes */
  data: string;
}

/**
 * Sample up to `count` evenly-spaced frames from a video file, downscaled to
 * keep vision-token cost low. Returns [] when ffmpeg is unavailable or the
 * file isn't decodable — the caller treats that as "cannot analyze" and
 * produces no draft (never fabricate form observations).
 */
export async function extractFrames(videoPath: string, count = 4): Promise<Frame[]> {
  const outDir = await mkdtemp(join(tmpdir(), 'frames-'));
  try {
    await execFileAsync(
      FFMPEG,
      [
        '-i', videoPath,
        // 1 fps sampling, capped at 768px wide — deliberately uses only
        // core ffmpeg features (scale filter + output rate) so trimmed
        // builds work too.
        '-vf', `scale='min(768,iw)':-2`,
        '-r', '1',
        '-frames:v', String(count),
        join(outDir, 'frame-%02d.png'),
      ],
      { timeout: 60_000 },
    );
    const files = (await readdir(outDir)).filter((f) => f.endsWith('.png')).sort();
    const frames: Frame[] = [];
    for (const file of files.slice(0, count)) {
      frames.push({
        mediaType: 'image/png',
        data: (await readFile(join(outDir, file))).toString('base64'),
      });
    }
    return frames;
  } catch {
    return [];
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}
