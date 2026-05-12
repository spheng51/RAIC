import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateSceneOutlinesFromRequirementsMock = vi.fn();
const executeScenesWithPolicyMock = vi.fn();
const generateMediaForClassroomMock = vi.fn();
const generateTTSForClassroomMock = vi.fn();
const persistClassroomMock = vi.fn();
const resolveModelMock = vi.fn();

vi.mock('@/lib/generation/outline-generator', () => ({
  applyOutlineFallbacks: <T>(outline: T) => outline,
  generateSceneOutlinesFromRequirements: generateSceneOutlinesFromRequirementsMock,
}));

vi.mock('@/lib/generation/scene-executor', () => ({
  executeScenesWithPolicy: executeScenesWithPolicyMock,
}));

vi.mock('@/lib/server/classroom-media-generation', () => ({
  generateMediaForClassroom: generateMediaForClassroomMock,
  replaceMediaPlaceholders: vi.fn(),
  generateTTSForClassroom: generateTTSForClassroomMock,
}));

vi.mock('@/lib/server/classroom-storage', () => ({
  persistClassroom: persistClassroomMock,
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModel: resolveModelMock,
}));

vi.mock('@/lib/ai/llm', () => ({
  callLLM: vi.fn(),
}));

vi.mock('@/lib/ai/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/providers')>();
  return {
    ...actual,
    isProviderKeyRequired: () => true,
  };
});

vi.mock('@/lib/orchestration/registry/store', () => ({
  getDefaultAgents: () => [
    {
      id: 'default-1',
      name: 'Teacher',
      role: 'teacher',
      persona: 'Helps the learner.',
    },
  ],
}));

vi.mock('@/lib/server/search-query-builder', () => ({
  buildSearchQuery: vi.fn(),
}));

vi.mock('@/lib/web-search/tavily', () => ({
  formatSearchResultsAsContext: vi.fn(),
  searchWithTavily: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('generateClassroom', () => {
  beforeEach(() => {
    vi.resetModules();
    generateSceneOutlinesFromRequirementsMock.mockReset();
    executeScenesWithPolicyMock.mockReset();
    generateMediaForClassroomMock.mockReset();
    generateTTSForClassroomMock.mockReset();
    persistClassroomMock.mockReset();
    resolveModelMock.mockReset();

    resolveModelMock.mockResolvedValue({
      model: 'model-stub',
      modelInfo: {
        capabilities: {
          vision: false,
        },
      },
      modelString: 'openai:gpt-5.2',
      providerId: 'openai',
      apiKey: 'test-key',
    });

    generateSceneOutlinesFromRequirementsMock.mockResolvedValue({
      success: true,
      data: {
        languageDirective: 'Respond in English.',
        outlines: [
          {
            id: 'outline-1',
            type: 'quiz',
            title: 'Scene 1',
            description: 'Introduce the topic',
            keyPoints: ['Point 1'],
            order: 0,
          },
          {
            id: 'outline-2',
            type: 'quiz',
            title: 'Scene 2',
            description: 'Deepen the topic',
            keyPoints: ['Point 2'],
            order: 1,
          },
        ],
      },
    });

    executeScenesWithPolicyMock.mockImplementation(
      async ({
        items,
      }: {
        items: Array<{
          outline: { title: string; order: number };
          index: number;
          context: {
            api: {
              scene: { create: (input: unknown) => { success: boolean; data: string | null } };
            };
          };
        }>;
      }) => {
        const created = items[0].context.api.scene.create({
          type: 'quiz',
          title: items[0].outline.title,
          order: items[0].outline.order,
          content: {
            type: 'quiz',
            questions: [],
          },
          actions: [],
        });

        return {
          sceneIds: created.data ? [created.data] : [],
          totalScenes: items.length,
          generatedScenes: created.success && created.data ? 1 : 0,
          failedScenes: 1,
          completionStatus: 'partial',
          warnings: [
            {
              stage: 'scene',
              code: 'content_empty',
              message: 'Scene content generation returned no content',
              sceneIndex: 1,
              sceneTitle: 'Scene 2',
              retryable: false,
              attempts: 1,
            },
          ],
          sceneOutcomes: [
            {
              index: 0,
              title: 'Scene 1',
              status: 'generated',
              stage: 'create',
              sceneId: created.data ?? undefined,
              attempts: 1,
              retryable: false,
              code: 'scene_generated',
              message: 'ok',
            },
            {
              index: 1,
              title: 'Scene 2',
              status: 'failed',
              stage: 'content',
              attempts: 1,
              retryable: false,
              code: 'content_empty',
              message: 'Scene content generation returned no content',
            },
          ],
        };
      },
    );

    generateMediaForClassroomMock.mockResolvedValue({
      mediaMap: {},
      warnings: [
        {
          stage: 'media',
          code: 'media_request_failed',
          message: 'Image generation failed for gen_img_1',
          elementId: 'gen_img_1',
          retryable: false,
          attempts: 1,
        },
      ],
    });

    generateTTSForClassroomMock.mockResolvedValue([
      {
        stage: 'tts',
        code: 'tts_action_failed',
        message: 'TTS generation failed for action action-1',
        actionId: 'action-1',
        retryable: false,
        attempts: 1,
      },
    ]);

    persistClassroomMock.mockImplementation(async ({ id, stage, scenes }) => ({
      id,
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      stage,
      scenes,
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
      url: `http://localhost:3000/classroom/${id}`,
    }));
  });

  it('returns partial-completion metadata and persists warnings on the stage', async () => {
    const { generateClassroom } = await import('@/lib/server/classroom-generation');

    const result = await generateClassroom(
      {
        requirement: 'Teach gravity',
        enableImageGeneration: true,
        enableTTS: true,
      },
      {
        baseUrl: 'http://localhost:3000',
        organizationId: 'org-1',
        userId: 'teacher-1',
      },
    );

    expect(result).toMatchObject({
      scenesCount: 1,
      totalScenes: 2,
      completionStatus: 'partial',
    });
    expect(result.sceneOutcomes).toHaveLength(2);
    expect(result.warnings).toHaveLength(3);
    expect(result.stage.generationCompletionStatus).toBe('partial');
    expect(result.stage.generationWarnings).toHaveLength(3);
    expect(persistClassroomMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: expect.objectContaining({
          generationCompletionStatus: 'partial',
        }),
        scenes: expect.any(Array),
      }),
      'http://localhost:3000',
    );
  });
});
