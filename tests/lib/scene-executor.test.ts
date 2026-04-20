import { describe, expect, it } from 'vitest';
import { executeScenesWithPolicy } from '@/lib/generation/scene-executor';
import type { SceneOutcome } from '@/lib/types/generation';

function buildOutcome(
  index: number,
  overrides?: Partial<SceneOutcome>,
): SceneOutcome {
  return {
    index,
    title: `Scene ${index + 1}`,
    status: 'generated',
    stage: 'create',
    sceneId: `scene-${index}`,
    attempts: 1,
    retryable: false,
    code: 'scene_generated',
    message: 'ok',
    ...overrides,
  };
}

describe('executeScenesWithPolicy', () => {
  it('respects bounded concurrency and preserves outline order', async () => {
    let active = 0;
    let maxActive = 0;

    const summary = await executeScenesWithPolicy({
      items: Array.from({ length: 6 }, (_, index) => ({
        index,
        outline: {
          id: `outline-${index}`,
          type: 'slide' as const,
          title: `Scene ${index + 1}`,
          description: 'Desc',
          keyPoints: ['One'],
          order: index,
        },
      })),
      policy: {
        concurrency: 2,
        maxAttempts: 1,
        retryDelaysMs: [1],
        retryableErrorCodes: ['rate_limit'],
      },
      executeScene: async (item) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, item.index === 0 ? 40 : 10));
        active -= 1;
        return buildOutcome(item.index);
      },
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(summary.sceneIds).toEqual([
      'scene-0',
      'scene-1',
      'scene-2',
      'scene-3',
      'scene-4',
      'scene-5',
    ]);
    expect(summary.generatedScenes).toBe(6);
    expect(summary.failedScenes).toBe(0);
    expect(summary.completionStatus).toBe('complete');
  });

  it('retries retryable failures and records the final attempt count', async () => {
    const attempts = new Map<number, number>();

    const summary = await executeScenesWithPolicy({
      items: [
        {
          index: 0,
          outline: {
            id: 'outline-1',
            type: 'slide' as const,
            title: 'Scene 1',
            description: 'Desc',
            keyPoints: ['One'],
            order: 0,
          },
        },
      ],
      policy: {
        concurrency: 1,
        maxAttempts: 3,
        retryDelaysMs: [1, 1, 1],
        retryableErrorCodes: ['rate_limit'],
      },
      executeScene: async (item, attempt) => {
        attempts.set(item.index, attempt);
        if (attempt === 1) {
          return buildOutcome(item.index, {
            status: 'failed',
            stage: 'content',
            sceneId: undefined,
            retryable: true,
            code: 'rate_limit',
            message: 'rate limited',
          });
        }
        return buildOutcome(item.index, { attempts: attempt });
      },
    });

    expect(attempts.get(0)).toBe(2);
    expect(summary.sceneOutcomes[0]).toMatchObject({
      status: 'generated',
      attempts: 2,
    });
  });

  it('does not retry non-retryable failures and surfaces partial metadata', async () => {
    const summary = await executeScenesWithPolicy({
      items: [
        {
          index: 0,
          outline: {
            id: 'outline-1',
            type: 'slide' as const,
            title: 'Scene 1',
            description: 'Desc',
            keyPoints: ['One'],
            order: 0,
          },
        },
        {
          index: 1,
          outline: {
            id: 'outline-2',
            type: 'slide' as const,
            title: 'Scene 2',
            description: 'Desc',
            keyPoints: ['Two'],
            order: 1,
          },
        },
      ],
      policy: {
        concurrency: 2,
        maxAttempts: 3,
        retryDelaysMs: [1, 1, 1],
        retryableErrorCodes: ['rate_limit'],
      },
      executeScene: async (item) => {
        if (item.index === 0) {
          return buildOutcome(item.index, {
            status: 'failed',
            stage: 'content',
            sceneId: undefined,
            retryable: false,
            code: 'content_empty',
            message: 'Scene content generation returned no content',
          });
        }
        return buildOutcome(item.index);
      },
    });

    expect(summary.generatedScenes).toBe(1);
    expect(summary.failedScenes).toBe(1);
    expect(summary.completionStatus).toBe('partial');
    expect(summary.warnings).toEqual([
      expect.objectContaining({
        stage: 'scene',
        code: 'content_empty',
        sceneIndex: 0,
      }),
    ]);
    expect(summary.sceneOutcomes[0]).toMatchObject({
      status: 'failed',
      attempts: 1,
      retryable: false,
    });
  });
});
