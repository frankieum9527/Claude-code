import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type {
  ProgramItemDto,
  ProgramPlanDto,
  ProgramSessionDto,
} from '@athlete-guide/shared-types';
import type { Guardrails } from './guardrails.js';
import { guardrailsForAge, sessionMinutes, validatePlan } from './guardrails.js';
import type { PhaseKey, Skeleton } from './skeleton.js';
import { buildSkeleton, windowDays } from './skeleton.js';

/**
 * Fill the periodized skeleton with sessions. Two fillers share the frame:
 *
 * - Stock: a deterministic, catalog-driven plan built entirely in code. Used
 *   in fake mode (AI_FAKE=1), when no Anthropic credentials are configured,
 *   and as the fallback whenever the AI's plan fails guardrail validation —
 *   so POST /me/program always succeeds and never stores an unsafe plan.
 * - AI: Claude personalizes sessions from age/height/weight/focus areas via
 *   structured outputs, then the result is validated against the same
 *   guardrails before it is accepted.
 */

export interface ProgramInput {
  startsOn: string;
  endsOn: string;
  age: number;
  heightCm?: number | null;
  weightKg?: number | null;
  focusAreas: string[];
  /** Already clamped to the age band's maxDaysPerWeek by the route. */
  daysPerWeek: number;
}

export interface GeneratedProgram {
  plan: ProgramPlanDto;
  source: 'ai' | 'stock';
}

// ---------------------------------------------------------------------------
// Stock filler
// ---------------------------------------------------------------------------

const WARMUP: ProgramItemDto = {
  name: 'Dynamic warm-up',
  detail: 'Easy jog, high knees, leg swings, arm circles.',
  durationMin: 5,
};

const CORE_FINISHER: ProgramItemDto = {
  name: 'Core circuit',
  detail: 'Front plank 30 s, side plank 20 s per side, dead bugs × 10.',
  durationMin: 5,
};

const RECOVERY_ITEMS: ProgramItemDto[] = [
  {
    name: 'Easy bike, swim, or walk',
    detail: 'Conversational pace — you should be able to chat the whole time.',
    durationMin: 15,
  },
  {
    name: 'Hip + ankle mobility flow',
    detail: 'Slow hip circles, lunge with reach, ankle rocks against a wall.',
    durationMin: 8,
  },
  {
    name: 'Play a different sport',
    detail: 'Soccer, basketball, biking — anything fun that is not hockey.',
    durationMin: 12,
  },
];

/** Two work items per focus area per training phase; all bodyweight/band/ball. */
const CATALOG: Record<string, Record<Exclude<PhaseKey, 'recovery'>, ProgramItemDto[]>> = {
  'Skating speed': {
    base: [
      { name: 'Split squats', detail: 'Slow down, drive up. Back knee kisses the floor.', sets: 3, reps: 8 },
      { name: 'Lateral bounds', detail: 'Push sideways off one leg, stick the landing for a full second.', sets: 3, reps: 6 },
    ],
    skills: [
      { name: 'Skater hops', detail: 'Continuous side-to-side hops in a low skating stance.', sets: 3, reps: 10 },
      { name: 'Wall sit stride holds', detail: 'Skating-depth wall sit; extend one leg out like a stride.', sets: 3, reps: 5 },
    ],
    ramp: [
      { name: 'Sprint intervals', detail: '6 × 15 s hard run or bike, 45 s easy between.', durationMin: 6 },
      { name: 'Acceleration starts', detail: 'From a crouch, explode into a 10 m sprint. Walk back to recover.', sets: 3, reps: 4 },
    ],
  },
  'Shot power': {
    base: [
      { name: 'Push-ups', detail: 'Chest to fist-height, elbows at 45°. Elevate hands to scale down.', sets: 3, reps: 10 },
      { name: 'Med-ball rotational throws', detail: 'Throw against a wall from an athletic stance; rotate from the hips.', sets: 3, reps: 6 },
    ],
    skills: [
      { name: 'Wrist shots', detail: '50 shots at a target, pick corners. Weight transfer front-foot.', durationMin: 12 },
      { name: 'Snap shots off the back foot', detail: '25 quick releases — the puck should surprise you.', durationMin: 8 },
    ],
    ramp: [
      { name: 'Quick-release reps', detail: '30 shots, catch-and-shoot in one motion from a self-pass.', durationMin: 10 },
      { name: 'One-timers', detail: 'Off a rebounder or a partner feed; time the swing, not the strength.', durationMin: 8 },
    ],
  },
  Stickhandling: {
    base: [
      { name: 'Ball stickhandling', detail: 'Golf or lacrosse ball, narrow-wide-narrow pattern while standing.', durationMin: 8 },
      { name: 'Around-the-body handling', detail: 'Move the ball around your feet and body without looking down.', durationMin: 6 },
    ],
    skills: [
      { name: 'Figure-8s around cones', detail: 'Two cones a stick-length apart; keep your head up.', durationMin: 8 },
      { name: 'Toe-drag reps', detail: 'Pull the ball across your body with the toe of the blade.', sets: 3, reps: 10 },
    ],
    ramp: [
      { name: 'Heads-up handling', detail: 'Stickhandle while a partner flashes fingers you call out.', durationMin: 8 },
      { name: 'Obstacle dangles at speed', detail: 'Weave a line of objects as fast as clean control allows.', durationMin: 8 },
    ],
  },
  Conditioning: {
    base: [
      { name: 'Bike or run intervals', detail: '5 × 2 min brisk, 1 min easy between.', durationMin: 15 },
      { name: 'Bear crawls', detail: 'Crawl 10 m forward and back, hips low and level.', sets: 3, reps: 2 },
    ],
    skills: [
      { name: 'Jump rope', detail: 'Two feet, then alternating. Rest when form breaks.', durationMin: 8 },
      { name: 'Mountain climbers', detail: 'Steady rhythm, shoulders over wrists.', sets: 3, reps: 15 },
    ],
    ramp: [
      { name: 'Shuttle runs', detail: '6 × 30 s hard shuttles over 10 m, 30 s rest — shift-length efforts.', durationMin: 8 },
      { name: 'Burpee intervals', detail: '4 × 30 s steady burpees, 30 s rest.', durationMin: 5 },
    ],
  },
  Strength: {
    base: [
      { name: 'Bodyweight squats', detail: 'Sit between your hips, heels down, chest proud.', sets: 3, reps: 12 },
      { name: 'Band or towel rows', detail: 'Squeeze shoulder blades together at the back.', sets: 3, reps: 10 },
    ],
    skills: [
      { name: 'Single-leg glute bridges', detail: 'Drive through the heel; hips stay level.', sets: 3, reps: 8 },
      { name: 'Step-ups', detail: 'Stairs or a sturdy box, knee height. Control the way down.', sets: 3, reps: 8 },
    ],
    ramp: [
      { name: 'Squat jumps', detail: 'Land soft and quiet, reset each rep.', sets: 3, reps: 6 },
      { name: 'Push-up to shoulder tap', detail: 'Fight the twist as you tap the opposite shoulder.', sets: 3, reps: 8 },
    ],
  },
  Agility: {
    base: [
      { name: 'Lateral line hops', detail: 'Quick two-foot hops over a line, 20 s per set.', sets: 3, reps: 1 },
      { name: 'Single-leg balance reaches', detail: 'Stand on one leg, reach the other to 3 points of a clock.', sets: 2, reps: 5 },
    ],
    skills: [
      { name: 'T-drill', detail: 'Sprint, shuffle, backpedal through a T of cones. Walk-back recovery.', sets: 4, reps: 1 },
      { name: 'Box drill', detail: 'Four cones in a square: sprint, shuffle, backpedal, shuffle.', sets: 4, reps: 1 },
    ],
    ramp: [
      { name: '5-10-5 pro agility', detail: 'Full-speed direction changes; stay low through the cuts.', sets: 6, reps: 1 },
      { name: 'Mirror drill', detail: 'Shadow a partner’s side-to-side cuts for 15 s bursts.', sets: 4, reps: 1 },
    ],
  },
};

/** Trim a session until it fits the band's item-count and minute caps. */
function fitSession(session: ProgramSessionDto, g: Guardrails): ProgramSessionDto {
  const items = session.items.slice(0, g.maxItemsPerSession).map((item) => ({
    ...item,
    sets: item.sets != null ? Math.min(item.sets, g.maxSets) : undefined,
    reps: item.reps != null ? Math.min(item.reps, g.maxReps) : undefined,
  }));
  // Drop from the end (finisher first, warm-up last) until minutes fit.
  while (items.length > 1 && sessionMinutes({ ...session, items }) > g.maxSessionMinutes) {
    items.pop();
  }
  return { ...session, items };
}

/**
 * Deterministic catalog plan: each training day rotates through the athlete's
 * focus areas, with a shared warm-up and core finisher around the focus work.
 */
export function stockPlan(input: ProgramInput, skeleton: Skeleton, g: Guardrails): ProgramPlanDto {
  const weeks = Math.round(windowDays(input.startsOn, input.endsOn) / 7);
  const phases = skeleton.phases.map((phase) => {
    const days: Record<string, ProgramSessionDto | null> = {};
    for (let weekday = 0; weekday < 7; weekday++) days[String(weekday)] = null;
    phase.trainingWeekdays.forEach((weekday, i) => {
      let session: ProgramSessionDto;
      if (phase.key === 'recovery') {
        session = { title: 'Active recovery', items: RECOVERY_ITEMS };
      } else {
        const focus = input.focusAreas[i % input.focusAreas.length];
        const pool = CATALOG[focus]?.[phase.key] ?? CATALOG.Conditioning[phase.key];
        session = {
          title: `${phase.name}: ${focus.toLowerCase()}`,
          items: [WARMUP, ...pool, CORE_FINISHER],
        };
      }
      days[String(weekday)] = fitSession(session, g);
    });
    return {
      name: phase.name,
      emphasis: phase.emphasis,
      startsOn: phase.startsOn,
      endsOn: phase.endsOn,
      days,
    };
  });
  return {
    summary:
      `${weeks}-week off-season plan building from recovery to a pre-season ramp, ` +
      `focused on ${input.focusAreas.join(', ').toLowerCase()}. ` +
      `Sized for the ${g.band} age band: ${input.daysPerWeek} days/week at most, all equipment-light.`,
    phases,
  };
}

// ---------------------------------------------------------------------------
// AI filler
// ---------------------------------------------------------------------------

const GeneratedItem = z.object({
  name: z.string(),
  detail: z.string(),
  sets: z.number().int().optional(),
  reps: z.number().int().optional(),
  durationMin: z.number().int().optional(),
});

const GeneratedPlan = z.object({
  summary: z.string(),
  phases: z.array(
    z.object({
      name: z.string(),
      sessions: z.array(
        z.object({
          weekday: z.number().int().min(0).max(6),
          title: z.string(),
          items: z.array(GeneratedItem),
        }),
      ),
    }),
  ),
});

// Structured-outputs schema, kept in sync with GeneratedPlan above (which
// validates the response client-side). Sessions are a weekday-keyed array
// because JSON Schema can't express "an object with exactly these dynamic
// weekday keys"; the merge step turns them into the DTO's days record.
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: "2-3 sentences: the plan's arc and how it serves the athlete's focus areas",
    },
    phases: {
      type: 'array',
      description: 'One entry per skeleton phase, in the same order',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Must match the skeleton phase name exactly' },
          sessions: {
            type: 'array',
            description: 'Exactly one session per training weekday listed for this phase',
            items: {
              type: 'object',
              properties: {
                weekday: { type: 'integer', minimum: 0, maximum: 6 },
                title: { type: 'string' },
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      detail: {
                        type: 'string',
                        description: 'One coaching sentence: how to do it and what to feel',
                      },
                      sets: { type: 'integer' },
                      reps: { type: 'integer' },
                      durationMin: { type: 'integer' },
                    },
                    required: ['name', 'detail'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['weekday', 'title', 'items'],
              additionalProperties: false,
            },
          },
        },
        required: ['name', 'sessions'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'phases'],
  additionalProperties: false,
};

const SYSTEM = `You are a youth hockey strength & conditioning coach designing an at-home off-season program. You are given a fixed periodized skeleton (phases, dates, training weekdays) and an athlete profile. Fill in the sessions; never change the structure.

Rules:
- Home settings only: bodyweight, bands, a stick and ball, cones or household stand-ins. No gym machines.
- Respect every limit you are given (items per session, sets, reps, session minutes, banned equipment/efforts). They are hard safety limits for this athlete's age.
- Every session starts with a short warm-up item.
- Voice: encouraging and concrete, written to the athlete. No jargon, no AI references.`;

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function buildPrompt(input: ProgramInput, skeleton: Skeleton, g: Guardrails): string {
  const profile = [
    `Age: ${input.age}`,
    input.heightCm ? `Height: ${input.heightCm} cm` : null,
    input.weightKg ? `Weight: ${input.weightKg} kg` : null,
    `Focus areas: ${input.focusAreas.join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n');
  const phases = skeleton.phases
    .map(
      (p) =>
        `- ${p.name} (${p.startsOn} to ${p.endsOn}) — ${p.emphasis} ` +
        `Training days: ${p.trainingWeekdays.map((d) => `${WEEKDAY_NAMES[d]} (weekday ${d})`).join(', ')}.`,
    )
    .join('\n');
  return [
    `Athlete profile:\n${profile}`,
    `Skeleton (fixed — one session per listed training day, nothing on other days):\n${phases}`,
    `Hard limits for this athlete (${g.band} band):`,
    `- At most ${g.maxItemsPerSession} items per session, ${g.maxSets} sets, ${g.maxReps} reps.`,
    `- A session's total minutes must stay under ${g.maxSessionMinutes} (items without durationMin count as 5).`,
    `- Never use: ${g.bannedTerms.join(', ')}.`,
    '',
    'Fill every training day of every phase with a session personalized to this athlete.',
  ].join('\n');
}

/** Reshape the AI's weekday-array output into the DTO's days record. */
function mergeIntoSkeleton(
  generated: z.infer<typeof GeneratedPlan>,
  skeleton: Skeleton,
): ProgramPlanDto {
  return {
    summary: generated.summary,
    phases: skeleton.phases.map((bone, i) => {
      const days: Record<string, ProgramSessionDto | null> = {};
      for (let weekday = 0; weekday < 7; weekday++) days[String(weekday)] = null;
      for (const session of generated.phases[i]?.sessions ?? []) {
        days[String(session.weekday)] = { title: session.title, items: session.items };
      }
      return {
        name: bone.name,
        emphasis: bone.emphasis,
        startsOn: bone.startsOn,
        endsOn: bone.endsOn,
        days,
      };
    }),
  };
}

let client: Anthropic | null = null;

async function aiPlan(
  input: ProgramInput,
  skeleton: Skeleton,
  g: Guardrails,
): Promise<ProgramPlanDto | null> {
  client ??= new Anthropic();
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 16_000,
    thinking: { type: 'adaptive' },
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: PLAN_SCHEMA } },
    messages: [{ role: 'user', content: buildPrompt(input, skeleton, g) }],
  });
  if (response.stop_reason === 'refusal') return null;
  const text = response.content.find((block) => block.type === 'text')?.text;
  if (!text) return null;
  const parsed = GeneratedPlan.safeParse(JSON.parse(text));
  if (!parsed.success) return null;
  const plan = mergeIntoSkeleton(parsed.data, skeleton);
  return validatePlan(plan, skeleton, g).length === 0 ? plan : null;
}

interface Logger {
  warn: (obj: object, msg: string) => void;
}

/**
 * Generate a validated plan for the athlete. Never throws for AI reasons:
 * any AI failure (no credentials, refusal, guardrail violations) falls back
 * to the stock catalog plan, which is valid by construction.
 */
export async function generateProgram(
  input: ProgramInput,
  logger?: Logger,
): Promise<GeneratedProgram> {
  const g = guardrailsForAge(input.age);
  const skeleton = buildSkeleton({
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    daysPerWeek: Math.min(input.daysPerWeek, g.maxDaysPerWeek),
  });

  const aiConfigured =
    process.env.AI_FAKE !== '1' &&
    Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  if (aiConfigured) {
    try {
      const plan = await aiPlan(input, skeleton, g);
      if (plan) return { plan, source: 'ai' };
      logger?.warn({}, 'AI program failed validation; using stock plan');
    } catch (err) {
      logger?.warn({ err }, 'AI program generation failed; using stock plan');
    }
  }
  return { plan: stockPlan(input, skeleton, g), source: 'stock' };
}
