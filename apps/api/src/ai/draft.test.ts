import { afterEach, describe, expect, it } from 'vitest';
import { draftFeedback, fakeDraft, renderDraft } from './draft.js';

const frames = [{ mediaType: 'image/png' as const, data: 'aGVsbG8=' }];

const input = {
  drillTitle: 'Stickhandling figure-8s',
  drillDescription: 'Ball around two cones in a figure-8.',
  rubric: '- Head up, eyes off the ball\n- Knees bent',
  frames,
};

afterEach(() => {
  delete process.env.AI_FAKE;
});

describe('renderDraft', () => {
  it('formats the three coaching sections', () => {
    const text = renderDraft({
      lookingGood: ['Great stance.'],
      improvements: ['Keep your head up.'],
      focusCue: 'Eyes on the far wall',
    });
    expect(text).toContain('What looked good: Great stance.');
    expect(text).toContain('What to work on: Keep your head up.');
    expect(text).toContain('Focus cue: Eyes on the far wall');
  });
});

describe('draftFeedback', () => {
  it('returns null with no frames — never fabricate form observations', async () => {
    process.env.AI_FAKE = '1';
    await expect(draftFeedback({ ...input, frames: [] })).resolves.toBeNull();
  });

  it('produces a deterministic rubric-grounded draft in fake mode', async () => {
    process.env.AI_FAKE = '1';
    const draft = await draftFeedback(input);
    expect(draft).toBe(fakeDraft(input));
    expect(draft).toContain('head up, eyes off the ball');
  });

  it('fake mode copes with a missing rubric', () => {
    const draft = fakeDraft({ ...input, rubric: null });
    expect(draft).toContain('the basics of the drill');
  });
});
