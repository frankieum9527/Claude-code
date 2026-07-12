import type { FastifyInstance } from 'fastify';
import type {
  ProgramDto,
  ProgramPlanDto,
  ProgramResponse,
  Sport,
  TeamProgramsResponse,
  TodayProgramDto,
} from '@athlete-guide/shared-types';
import { HOCKEY_FOCUS_AREAS } from '@athlete-guide/shared-types';
import { z } from 'zod';
import type { Program } from '@prisma/client';
import { prisma } from '../db.js';
import { requireUser } from '../auth.js';
import { generateProgram } from '../programs/generate.js';
import { MAX_WINDOW_DAYS, MIN_WINDOW_DAYS, todaySlice, windowDays } from '../programs/skeleton.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const atMidnight = (date: string) => new Date(`${date}T00:00:00.000Z`);

const CreateProgram = z.object({
  startsOn: z.string().regex(DATE_RE),
  endsOn: z.string().regex(DATE_RE),
  age: z.number().int().min(6).max(25),
  heightCm: z.number().int().min(90).max(230).optional(),
  weightKg: z.number().int().min(20).max(150).optional(),
  focusAreas: z.array(z.enum(HOCKEY_FOCUS_AREAS)).min(1).max(3),
  daysPerWeek: z.number().int().min(2).max(6),
});

function toDto(program: Program): ProgramDto {
  const inputs = JSON.parse(program.inputs) as { focusAreas?: string[] };
  return {
    id: program.id,
    sport: program.sport as Sport,
    status: program.status as 'active' | 'archived',
    startsOn: isoDate(program.startsOn),
    endsOn: isoDate(program.endsOn),
    focusAreas: inputs.focusAreas ?? [],
    plan: JSON.parse(program.plan) as ProgramPlanDto,
    createdAt: program.createdAt.toISOString(),
  };
}

/**
 * The Today view's program slice: the player's active program's phase and
 * session for `date`, or null when there's no program or the date is outside
 * its window. Used by GET /me/today on off-season days.
 */
export async function todayProgram(playerId: string, date: string): Promise<TodayProgramDto | null> {
  const program = await prisma.program.findFirst({
    where: {
      playerId,
      status: 'active',
      startsOn: { lte: atMidnight(date) },
      endsOn: { gte: atMidnight(date) },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!program) return null;
  return todaySlice(JSON.parse(program.plan) as ProgramPlanDto, date);
}

export async function programRoutes(app: FastifyInstance) {
  // Generate a personalized off-season program. Replaces (archives) any
  // existing active one — an athlete has one plan at a time.
  app.post('/me/program', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = CreateProgram.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const body = parsed.data;

    if (body.endsOn <= body.startsOn) {
      return reply.code(400).send({ error: 'endsOn must be after startsOn' });
    }
    const days = windowDays(body.startsOn, body.endsOn);
    if (days < MIN_WINDOW_DAYS || days > MAX_WINDOW_DAYS) {
      return reply.code(400).send({
        error: `The off-season window must be ${MIN_WINDOW_DAYS}–${MAX_WINDOW_DAYS} days (got ${days}).`,
      });
    }

    const membership = await prisma.teamMembership.findFirst({
      where: { userId: user.id },
      include: { team: true },
    });
    const sport = membership?.team.sport ?? 'hockey';

    const { plan, source } = await generateProgram(
      {
        startsOn: body.startsOn,
        endsOn: body.endsOn,
        age: body.age,
        heightCm: body.heightCm,
        weightKg: body.weightKg,
        focusAreas: body.focusAreas,
        daysPerWeek: body.daysPerWeek,
      },
      req.log,
    );

    const [, program] = await prisma.$transaction([
      prisma.program.updateMany({
        where: { playerId: user.id, status: 'active' },
        data: { status: 'archived' },
      }),
      prisma.program.create({
        data: {
          playerId: user.id,
          sport,
          startsOn: atMidnight(body.startsOn),
          endsOn: atMidnight(body.endsOn),
          inputs: JSON.stringify({
            age: body.age,
            heightCm: body.heightCm ?? null,
            weightKg: body.weightKg ?? null,
            focusAreas: body.focusAreas,
            daysPerWeek: body.daysPerWeek,
            source,
          }),
          plan: JSON.stringify(plan),
        },
      }),
    ]);

    const response: ProgramResponse = { program: toDto(program) };
    return reply.code(201).send(response);
  });

  // The player's active program (null when none).
  app.get('/me/program', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const program = await prisma.program.findFirst({
      where: { playerId: user.id, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    const response: ProgramResponse = { program: program ? toDto(program) : null };
    return reply.send(response);
  });

  // Coach: every roster player's off-season plan at a glance — who has one,
  // what they're working on, where they are in it, and what today asks of
  // them. Read-only visibility; players own their plans.
  app.get('/teams/:teamId/programs', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { teamId } = req.params as { teamId: string };
    const { date: dateParam } = req.query as { date?: string };
    if (dateParam && !DATE_RE.test(dateParam)) {
      return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
    }
    const date = dateParam ?? isoDate(new Date());

    const membership = await prisma.teamMembership.findUnique({
      where: { userId_teamId: { userId: user.id, teamId } },
    });
    if (membership?.role !== 'coach') {
      return reply.code(403).send({ error: 'Only a team coach can view player programs' });
    }

    const players = await prisma.teamMembership.findMany({
      where: { teamId, role: 'player' },
      include: { user: { select: { id: true, name: true } } },
    });
    const programs = await prisma.program.findMany({
      where: { playerId: { in: players.map((p) => p.user.id) }, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    const byPlayer = new Map<string, Program>();
    for (const program of programs) {
      if (!byPlayer.has(program.playerId)) byPlayer.set(program.playerId, program);
    }

    const response: TeamProgramsResponse = {
      date,
      players: players
        .map((p) => {
          const row = byPlayer.get(p.user.id);
          if (!row) return { playerId: p.user.id, playerName: p.user.name, program: null };
          const dto = toDto(row);
          const slice = todaySlice(dto.plan, date);
          return {
            playerId: p.user.id,
            playerName: p.user.name,
            program: {
              id: dto.id,
              startsOn: dto.startsOn,
              endsOn: dto.endsOn,
              focusAreas: dto.focusAreas,
              summary: dto.plan.summary,
              currentPhase: slice?.phaseName ?? null,
              todaySession: slice?.session?.title ?? null,
              phases: dto.plan.phases.map((phase) => ({
                name: phase.name,
                startsOn: phase.startsOn,
                endsOn: phase.endsOn,
                sessionsPerWeek: Object.values(phase.days).filter((s) => s !== null).length,
              })),
            },
          };
        })
        // Players mid-plan first, then plan-less players, alphabetical within.
        .sort(
          (a, b) =>
            Number(b.program !== null) - Number(a.program !== null) ||
            a.playerName.localeCompare(b.playerName),
        ),
    };
    return reply.send(response);
  });

  // Archive the active program (kept for history; a new POST also archives).
  app.delete('/me/program', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    await prisma.program.updateMany({
      where: { playerId: user.id, status: 'active' },
      data: { status: 'archived' },
    });
    return reply.code(204).send();
  });
}
