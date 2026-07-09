/**
 * Seeds a demo hockey team with a season spanning today, a Tue/Thu practice +
 * Sat game schedule, and the three launch routines (practice warm-up, game
 * warm-up, off-day home session). Idempotent: safe to re-run.
 *
 * Run with: npm run db:seed --workspace apps/api
 */
import { prisma } from '../src/db.js';

type DrillSeed = { title: string; description: string; durationSec: number };
type RoutineSeed = {
  kind: 'practice_warmup' | 'game_warmup' | 'home_session';
  title: string;
  drills: DrillSeed[];
};

const ROUTINES: RoutineSeed[] = [
  {
    kind: 'practice_warmup',
    title: 'Pre-Practice Warm-Up',
    drills: [
      {
        title: 'Jumping jacks',
        description: 'Raise heart rate. Land soft, stay on the balls of your feet.',
        durationSec: 60,
      },
      {
        title: "World's greatest stretch",
        description:
          'Lunge, drop the inside elbow toward the floor, rotate and reach up. Opens hips and thoracic spine for skating posture.',
        durationSec: 90,
      },
      {
        title: 'Leg swings',
        description: 'Front-to-back and side-to-side, 10 each leg. Controlled, growing range.',
        durationSec: 60,
      },
      {
        title: 'Glute bridges',
        description: 'Two sets of 10. Drive through the heels — glutes power your stride.',
        durationSec: 90,
      },
      {
        title: 'Stickhandling wake-up',
        description: 'Ball or puck, narrow quick touches. Eyes up, soft top hand.',
        durationSec: 120,
      },
    ],
  },
  {
    kind: 'game_warmup',
    title: 'Game-Day Warm-Up',
    drills: [
      {
        title: 'Light jog and skips',
        description: 'Easy pace to break a light sweat before anything explosive.',
        durationSec: 120,
      },
      {
        title: 'Dynamic hip openers',
        description: 'Walking knee hugs into open-the-gate. Prime the hips for your stride.',
        durationSec: 90,
      },
      {
        title: 'Lateral bounds',
        description: 'Two sets of 6 per side. Stick each landing — this is your crossover power.',
        durationSec: 90,
      },
      {
        title: 'Quick feet',
        description: 'Fast line hops, 3 rounds of 15 seconds. Light, fast contacts.',
        durationSec: 60,
      },
      {
        title: 'Quick hands',
        description: 'Stickhandling, maximum speed with control. Finish with 10 hard fakes.',
        durationSec: 120,
      },
      {
        title: 'Breathing reset',
        description: 'One minute of slow nasal breathing. Visualize your first shift.',
        durationSec: 60,
      },
    ],
  },
  {
    kind: 'home_session',
    title: 'Off-Day Home Session',
    drills: [
      {
        title: 'Stickhandling figure-8s',
        description:
          'Ball around two cones (or shoes) in a figure-8. Head up the entire time — film this one for coach review.',
        durationSec: 180,
      },
      {
        title: 'Wrist shot form',
        description:
          '25 controlled wrist shots into a net or tarp. Weight transfer back-to-front, follow through at your target.',
        durationSec: 300,
      },
      {
        title: 'Bodyweight squats',
        description: 'Three sets of 12. Chest up, knees tracking over toes, full depth.',
        durationSec: 240,
      },
      {
        title: 'Single-leg balance',
        description:
          'Thirty seconds per leg, three rounds. Progress by closing your eyes or adding stickhandling.',
        durationSec: 180,
      },
      {
        title: 'Plank series',
        description: 'Front, left side, right side — 30 seconds each, two rounds.',
        durationSec: 180,
      },
    ],
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  // --- Users -----------------------------------------------------------------
  const coach = await prisma.user.upsert({
    where: { email: 'coach@example.com' },
    update: {},
    create: { email: 'coach@example.com', name: 'Casey Coach', role: 'coach' },
  });
  // Riley is under 13 → video uploads need parental consent; the seed
  // grants it so the demo review loop works out of the box.
  const consent = { videoConsentAt: new Date('2026-01-15T00:00:00.000Z') };
  const player = await prisma.user.upsert({
    where: { email: 'player@example.com' },
    update: consent,
    create: {
      email: 'player@example.com',
      name: 'Riley Player',
      role: 'player',
      birthdate: new Date('2012-03-14T00:00:00.000Z'),
      heightCm: 158,
      weightKg: 48,
      ...consent,
    },
  });

  // --- Team ------------------------------------------------------------------
  let team = await prisma.team.findUnique({ where: { joinCode: 'RAVENS26' } });
  team ??= await prisma.team.create({
    data: { name: 'Riverside Ravens', sport: 'hockey', joinCode: 'RAVENS26' },
  });
  for (const [userId, role] of [
    [coach.id, 'coach'],
    [player.id, 'player'],
  ] as const) {
    await prisma.teamMembership.upsert({
      where: { userId_teamId: { userId, teamId: team.id } },
      update: {},
      create: { userId, teamId: team.id, role },
    });
  }

  // --- Season spanning today, with Tue/Thu practices and Sat games ------------
  const today = new Date();
  const startsOn = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const endsOn = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 0));

  let season = await prisma.season.findFirst({ where: { teamId: team.id } });
  season ??= await prisma.season.create({
    data: { teamId: team.id, name: 'Summer League', startsOn, endsOn },
  });

  const existingEvents = await prisma.scheduleEvent.count({ where: { seasonId: season.id } });
  if (existingEvents === 0) {
    const events: { type: string; startsAt: Date; location: string }[] = [];
    for (let t = startsOn.getTime(); t <= endsOn.getTime(); t += DAY_MS) {
      const day = new Date(t);
      const dow = day.getUTCDay();
      if (dow === 2 || dow === 4) {
        // Tue/Thu practice, 18:00 UTC
        events.push({
          type: 'practice',
          startsAt: new Date(t + 18 * 60 * 60 * 1000),
          location: 'Riverside Arena — Rink B',
        });
      } else if (dow === 6) {
        // Sat game, 15:00 UTC
        events.push({
          type: 'game',
          startsAt: new Date(t + 15 * 60 * 60 * 1000),
          location: 'Riverside Arena — Rink A',
        });
      }
    }
    await prisma.scheduleEvent.createMany({
      data: events.map((e) => ({ ...e, seasonId: season.id, source: 'manual' })),
    });
    console.log(`Seeded ${events.length} schedule events`);
  }

  // --- Routines and drills -----------------------------------------------------
  for (const routineSeed of ROUTINES) {
    const existing = await prisma.routine.findUnique({
      where: { sport_kind: { sport: 'hockey', kind: routineSeed.kind } },
    });
    if (existing) continue;

    await prisma.routine.create({
      data: {
        sport: 'hockey',
        kind: routineSeed.kind,
        title: routineSeed.title,
        items: {
          create: routineSeed.drills.map((drill, i) => ({
            position: i + 1,
            durationSec: drill.durationSec,
            drill: {
              create: {
                sport: 'hockey',
                title: drill.title,
                description: drill.description,
              },
            },
          })),
        },
      },
    });
    console.log(`Seeded routine: ${routineSeed.title}`);
  }

  console.log('\nSeed complete.');
  console.log(`  Coach:  ${coach.id} (coach@example.com)`);
  console.log(`  Player: ${player.id} (player@example.com)`);
  console.log(`  Team:   ${team.name} — join code ${team.joinCode}`);
  console.log(`  Season: ${isoDate(startsOn)} → ${isoDate(endsOn)}`);
  console.log(`\nTry: curl -H "x-user-id: ${player.id}" http://localhost:3000/me/today`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
