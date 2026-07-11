import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db.js';
import { storage } from '../storage.js';
import { extractFrames } from './frames.js';
import { draftFeedback, isAiEnabled } from './draft.js';

/**
 * In-process analysis worker, same pattern as the ICS scheduler: video
 * upload completion enqueues a job here; when Redis/BullMQ land, this
 * becomes a queue processor and `analyzeSubmission` carries over unchanged.
 */

export async function analyzeSubmission(
  submissionId: string,
  logger?: FastifyBaseLogger,
): Promise<void> {
  if (!isAiEnabled()) return;

  const submission = await prisma.videoSubmission.findUnique({
    where: { id: submissionId },
    include: { drill: true, feedback: { where: { author: 'ai' } } },
  });
  if (!submission || submission.status !== 'ready_for_review') return;
  if (submission.feedback.length > 0) return; // already drafted

  const dir = await mkdtemp(join(tmpdir(), 'analysis-'));
  const videoPath = join(dir, 'video.mp4');
  try {
    await pipeline(await storage.getStream(submission.storageKey), createWriteStream(videoPath));
    const frames = await extractFrames(videoPath);
    const draft = await draftFeedback({
      drillTitle: submission.drill.title,
      drillDescription: submission.drill.description,
      rubric: submission.drill.rubric,
      frames,
    });
    if (!draft) {
      logger?.info({ submissionId }, 'ai draft skipped (video not analyzable)');
      return;
    }
    await prisma.feedback.create({
      data: { submissionId, author: 'ai', authorId: null, body: draft },
    });
    logger?.info({ submissionId }, 'ai draft created');
  } catch (e) {
    // Error isolation: a failed analysis never blocks the coach-manual path.
    logger?.warn({ submissionId, err: e }, 'ai draft failed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Fire-and-forget enqueue (called from the upload route). */
export function queueAnalysis(submissionId: string, logger?: FastifyBaseLogger): void {
  setImmediate(() => void analyzeSubmission(submissionId, logger));
}

/** Boot-time catch-up: draft anything that was uploaded while we were down. */
export async function sweepPendingAnalyses(logger?: FastifyBaseLogger): Promise<void> {
  if (!isAiEnabled()) return;
  const pending = await prisma.videoSubmission.findMany({
    where: { status: 'ready_for_review', feedback: { none: { author: 'ai' } } },
    select: { id: true },
  });
  for (const { id } of pending) {
    await analyzeSubmission(id, logger);
  }
}
