import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Frame } from './frames.js';

/**
 * Claude drafts structured coach feedback from video frames + the drill's
 * rubric. The draft goes to the COACH's review box (pre-filled, editable) —
 * players only ever see what the coach sends. Guardrails:
 *
 * - No frames → no draft. The model never comments on form it hasn't seen.
 * - Output is schema-constrained (what looked good / what to fix / one cue),
 *   keeping drafts concrete and consistent with the rubric.
 *
 * Modes:
 * - Real: requires Anthropic credentials (ANTHROPIC_API_KEY / auth token).
 * - Fake (AI_FAKE=1): deterministic rubric-derived draft for dev/demo — the
 *   pipeline runs end-to-end with no API access.
 */

export interface DraftInput {
  drillTitle: string;
  drillDescription: string;
  rubric: string | null;
  frames: Frame[];
}

const FeedbackDraft = z.object({
  lookingGood: z.array(z.string()),
  improvements: z.array(z.string()),
  focusCue: z.string(),
});

// Structured-outputs schema (kept in sync with FeedbackDraft above, which
// validates the response client-side).
const FEEDBACK_SCHEMA = {
  type: 'object',
  properties: {
    lookingGood: {
      type: 'array',
      items: { type: 'string' },
      description: '1-3 specific positives actually visible in the frames',
    },
    improvements: {
      type: 'array',
      items: { type: 'string' },
      description: '1-3 specific, kindly-worded corrections grounded in the rubric',
    },
    focusCue: {
      type: 'string',
      description: 'One short, memorable cue for the next attempt (max ~12 words)',
    },
  },
  required: ['lookingGood', 'improvements', 'focusCue'],
  additionalProperties: false,
};

const SYSTEM = `You are an assistant to a youth hockey coach, drafting feedback on a player's at-home drill video. The coach will review and edit your draft before the player sees anything.

Rules:
- Only describe what is actually visible in the provided frames. If something can't be judged from still frames (speed, rhythm), don't claim it.
- Ground corrections in the drill's rubric.
- Voice: encouraging, specific, age-appropriate for youth athletes. No jargon.
- Never mention that you are an AI or that these are frames from a video.`;

export function renderDraft(d: z.infer<typeof FeedbackDraft>): string {
  return [
    `What looked good: ${d.lookingGood.join(' ')}`,
    `What to work on: ${d.improvements.join(' ')}`,
    `Focus cue: ${d.focusCue}`,
  ].join('\n\n');
}

export function fakeDraft(input: DraftInput): string {
  const firstRubricLine =
    input.rubric?.split('\n')[0]?.replace(/^[-*]\s*/, '') ?? 'the basics of the drill';
  return renderDraft({
    lookingGood: [`Solid effort and setup on ${input.drillTitle.toLowerCase()}.`],
    improvements: [`Keep working on ${firstRubricLine.toLowerCase()} — it slips late in the rep.`],
    focusCue: firstRubricLine,
  });
}

export function isAiEnabled(): boolean {
  return (
    process.env.AI_FAKE === '1' ||
    Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
  );
}

let client: Anthropic | null = null;

/** Returns the draft text, or null when analysis isn't possible. */
export async function draftFeedback(input: DraftInput): Promise<string | null> {
  // Still frames are the evidence; without them there is nothing honest to say.
  if (input.frames.length === 0) return null;

  if (process.env.AI_FAKE === '1') return fakeDraft(input);

  client ??= new Anthropic();
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    system: SYSTEM,
    output_config: {
      format: { type: 'json_schema', schema: FEEDBACK_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: [
          ...input.frames.map(
            (frame) =>
              ({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: frame.mediaType,
                  data: frame.data,
                },
              }) as const,
          ),
          {
            type: 'text',
            text: [
              `Drill: ${input.drillTitle}`,
              `Instructions the player was given: ${input.drillDescription}`,
              `Coaching rubric:\n${input.rubric ?? '(none — use the drill instructions)'}`,
              '',
              'Draft feedback for the coach based on these frames from the player’s video.',
            ].join('\n'),
          },
        ],
      },
    ],
  });
  if (response.stop_reason === 'refusal') return null;
  const text = response.content.find((block) => block.type === 'text')?.text;
  if (!text) return null;
  const parsed = FeedbackDraft.safeParse(JSON.parse(text));
  return parsed.success ? renderDraft(parsed.data) : null;
}
