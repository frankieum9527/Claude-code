import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Readable } from 'node:stream';
import type {
  CreateSubmissionResponse,
  MySubmissionsResponse,
  ReviewQueueResponse,
  SubmissionStatus,
} from '@athlete-guide/shared-types';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../auth.js';
import { storage } from '../storage.js';
import { queueAnalysis } from '../ai/worker.js';

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

function isUnder13(birthdate: Date | null): boolean {
  if (!birthdate) return false;
  return Date.now() - birthdate.getTime() < 13 * YEAR_MS;
}

/**
 * Video visibility is minimal by default (docs/ARCHITECTURE.md §8): the
 * player themself, and coaches of a team the player belongs to. Guardians
 * are added when guardian accounts land.
 */
async function canAccessSubmission(viewerId: string, playerId: string): Promise<boolean> {
  if (viewerId === playerId) return true;
  const coachOfSharedTeam = await prisma.teamMembership.findFirst({
    where: {
      userId: viewerId,
      role: 'coach',
      team: { memberships: { some: { userId: playerId } } },
    },
  });
  return coachOfSharedTeam !== null;
}

export async function submissionRoutes(app: FastifyInstance) {
  // Player: start a submission for a drill. Returns the URL to PUT bytes to.
  // (Same two-step shape as a cloud signed-URL flow, so swapping storage
  // backends doesn't change the client.)
  app.post('/submissions', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = z.object({ drillId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    // COPPA gate: under-13 players need parental consent before any video
    // leaves the device. Consent UX is the guardian-accounts follow-up;
    // the enforcement point exists from day one.
    if (isUnder13(user.birthdate) && !user.videoConsentAt) {
      return reply.code(403).send({
        error: 'consent_required',
        hint: 'A parent or guardian must approve video uploads for this player',
      });
    }

    const drill = await prisma.drill.findUnique({ where: { id: parsed.data.drillId } });
    if (!drill) return reply.code(404).send({ error: 'Drill not found' });

    const storageKey = `videos/${user.id}/${randomUUID()}.mp4`;
    const submission = await prisma.videoSubmission.create({
      data: { playerId: user.id, drillId: drill.id, storageKey },
    });
    const response: CreateSubmissionResponse = {
      id: submission.id,
      uploadUrl: `/uploads/${storageKey}`,
    };
    return reply.code(201).send(response);
  });

  // Receive the video bytes (dev-mode stand-in for a signed cloud upload).
  app.put(
    '/uploads/*',
    { bodyLimit: 512 * 1024 * 1024 },
    async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user) return;
      const storageKey = (req.params as { '*': string })['*'];
      const submission = await prisma.videoSubmission.findUnique({ where: { storageKey } });
      if (!submission) return reply.code(404).send({ error: 'Unknown upload target' });
      if (submission.playerId !== user.id) {
        return reply.code(403).send({ error: 'Not your submission' });
      }
      if (submission.status !== 'pending_upload') {
        return reply.code(409).send({ error: 'Already uploaded' });
      }

      await storage.putStream(storageKey, req.body as Readable);
      await prisma.videoSubmission.update({
        where: { id: submission.id },
        data: { status: 'ready_for_review' },
      });
      queueAnalysis(submission.id, req.log);
      return reply.send({ ok: true, status: 'ready_for_review' });
    },
  );

  // Player: my uploads with any feedback.
  app.get('/me/submissions', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const submissions = await prisma.videoSubmission.findMany({
      where: { playerId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        drill: { select: { id: true, title: true } },
        // AI rows are coach-only drafts; players see only coach-sent feedback.
        feedback: {
          where: { author: { not: 'ai' } },
          orderBy: { createdAt: 'asc' },
          include: { authorUser: true },
        },
      },
    });
    const response: MySubmissionsResponse = {
      submissions: submissions.map((s) => ({
        id: s.id,
        status: s.status as SubmissionStatus,
        createdAt: s.createdAt.toISOString(),
        drill: s.drill,
        feedback: s.feedback.map((f) => ({
          id: f.id,
          author: f.author as 'coach' | 'ai',
          authorName: f.authorUser?.name ?? null,
          body: f.body,
          createdAt: f.createdAt.toISOString(),
        })),
      })),
    };
    return reply.send(response);
  });

  // Coach: submissions from this team's players awaiting review.
  app.get('/teams/:teamId/review-queue', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { teamId } = req.params as { teamId: string };
    const membership = await prisma.teamMembership.findUnique({
      where: { userId_teamId: { userId: user.id, teamId } },
    });
    if (membership?.role !== 'coach') {
      return reply.code(403).send({ error: 'Only a team coach can view the review queue' });
    }

    const items = await prisma.videoSubmission.findMany({
      where: {
        status: 'ready_for_review',
        player: { memberships: { some: { teamId } } },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        player: { select: { name: true } },
        drill: { select: { title: true } },
        feedback: { where: { author: 'ai' }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const response: ReviewQueueResponse = {
      items: items.map((s) => ({
        id: s.id,
        playerName: s.player.name,
        drillTitle: s.drill.title,
        createdAt: s.createdAt.toISOString(),
        aiDraft: s.feedback[0]?.body ?? null,
      })),
    };
    return reply.send(response);
  });

  // Stream the video to the player or their coach.
  app.get('/submissions/:id/video', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const submission = await prisma.videoSubmission.findUnique({ where: { id } });
    if (!submission) return reply.code(404).send({ error: 'Submission not found' });
    if (!(await canAccessSubmission(user.id, submission.playerId))) {
      return reply.code(403).send({ error: 'Not allowed to view this video' });
    }
    if (!(await storage.exists(submission.storageKey))) {
      return reply.code(404).send({ error: 'Video not uploaded yet' });
    }
    reply.header('content-type', 'video/mp4');
    return reply.send(await storage.getStream(submission.storageKey));
  });

  // Coach: leave feedback; marks the submission reviewed.
  app.post('/submissions/:id/feedback', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const parsed = z.object({ body: z.string().min(1).max(4000) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const submission = await prisma.videoSubmission.findUnique({ where: { id } });
    if (!submission) return reply.code(404).send({ error: 'Submission not found' });
    if (submission.playerId === user.id || !(await canAccessSubmission(user.id, submission.playerId))) {
      return reply.code(403).send({ error: 'Only the player’s coach can leave feedback' });
    }

    const feedback = await prisma.feedback.create({
      data: { submissionId: id, authorId: user.id, author: 'coach', body: parsed.data.body },
    });
    await prisma.videoSubmission.update({ where: { id }, data: { status: 'reviewed' } });
    return reply.code(201).send({
      id: feedback.id,
      author: 'coach',
      body: feedback.body,
      createdAt: feedback.createdAt.toISOString(),
    });
  });
}
