import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AICallFn } from '@/lib/generation/pipeline-types';

const generateSceneOutlinesFromRequirementsMock = vi.fn();
const generateFullScenesMock = vi.fn();

vi.mock('nanoid', () => ({
  nanoid: () => 'session-123',
}));

vi.mock('@/lib/generation/outline-generator', () => ({
  generateSceneOutlinesFromRequirements: generateSceneOutlinesFromRequirementsMock,
}));

vi.mock('@/lib/generation/scene-generator', () => ({
  generateFullScenes: generateFullScenesMock,
}));

describe('runGenerationPipeline', () => {
  beforeEach(() => {
    vi.resetModules();
    generateSceneOutlinesFromRequirementsMock.mockReset();
    generateFullScenesMock.mockReset();
  });

  it('fails when scene generation returns a failed summary with zero generated scenes', async () => {
    generateSceneOutlinesFromRequirementsMock.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'outline-1',
          type: 'slide',
          title: 'Scene 1',
          description: 'Overview',
          keyPoints: ['Point 1'],
          order: 0,
        },
      ],
    });
    generateFullScenesMock.mockResolvedValue({
      success: true,
      data: {
        sceneIds: [],
        totalScenes: 1,
        generatedScenes: 0,
        failedScenes: 1,
        completionStatus: 'failed',
        warnings: [
          {
            stage: 'scene',
            code: 'content_empty',
            message: 'Scene content generation returned no content',
            sceneIndex: 0,
            sceneTitle: 'Scene 1',
            retryable: false,
            attempts: 1,
          },
        ],
        sceneOutcomes: [
          {
            index: 0,
            title: 'Scene 1',
            status: 'failed',
            stage: 'content',
            attempts: 1,
            retryable: false,
            code: 'content_empty',
            message: 'Scene content generation returned no content',
          },
        ],
      },
    });

    const { createGenerationSession, runGenerationPipeline } =
      await import('@/lib/generation/pipeline-runner');

    const session = createGenerationSession({
      requirement: 'Teach gravity',
      language: 'en-US',
    });

    const result = await runGenerationPipeline(
      session,
      {} as never,
      vi.fn() as unknown as AICallFn,
    );

    expect(result).toEqual({
      success: false,
      error: 'Failed to generate scenes',
    });
    expect(session.progress.errors).toContain('Failed to generate scenes');
  });
});
