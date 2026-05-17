import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  noAdaptivePromptExpectation,
  repeatedSessionPromptExpectation,
  scorePromptReplay,
} from '../support/adaptive-runtime-replay';

const applyOutlineFallbacksMock = vi.fn();
const buildCompleteSceneMock = vi.fn();
const buildPromptMock = vi.fn();
const buildVisionUserContentMock = vi.fn();
const callLLMMock = vi.fn();
const formatImageDescriptionMock = vi.fn();
const formatImagePlaceholderMock = vi.fn();
const formatTeacherPersonaForPromptMock = vi.fn();
const generateSceneActionsMock = vi.fn();
const generateSceneContentMock = vi.fn();
const getRequestAuthMock = vi.fn();
const loadTeacherAdaptivePromptMock = vi.fn();
const resolveModelFromHeadersMock = vi.fn();
const resolveModelFromHeadersWithScopeMock = vi.fn();
const resolveSceneGenerationScenarioMock = vi.fn();
const streamLLMMock = vi.fn();
const toGovernedProviderApiErrorResponseMock = vi.fn();
const uniquifyMediaElementIdsMock = vi.fn();

vi.mock('@/lib/ai/llm', () => ({
  callLLM: callLLMMock,
  streamLLM: streamLLMMock,
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModelFromHeaders: resolveModelFromHeadersMock,
  resolveModelFromHeadersWithScope: resolveModelFromHeadersWithScopeMock,
}));

vi.mock('@/lib/auth/current-user', () => ({
  getRequestAuth: getRequestAuthMock,
}));

vi.mock('@/lib/server/ai-governance', () => ({
  toGovernedProviderApiErrorResponse: toGovernedProviderApiErrorResponseMock,
}));

vi.mock('@/lib/server/provider-scenario-routing', () => ({
  resolveSceneGenerationScenario: resolveSceneGenerationScenarioMock,
}));

vi.mock('@/lib/server/adaptive-runtime-prompt', () => ({
  loadTeacherAdaptivePrompt: loadTeacherAdaptivePromptMock,
}));

vi.mock('@/lib/generation/generation-pipeline', () => ({
  applyOutlineFallbacks: applyOutlineFallbacksMock,
  buildCompleteScene: buildCompleteSceneMock,
  buildVisionUserContent: buildVisionUserContentMock,
  formatImageDescription: formatImageDescriptionMock,
  formatImagePlaceholder: formatImagePlaceholderMock,
  formatTeacherPersonaForPrompt: formatTeacherPersonaForPromptMock,
  generateSceneActions: generateSceneActionsMock,
  generateSceneContent: generateSceneContentMock,
  uniquifyMediaElementIds: uniquifyMediaElementIdsMock,
}));

vi.mock('@/lib/generation/prompts', () => ({
  PROMPT_IDS: {
    REQUIREMENTS_TO_OUTLINES: 'requirements-to-outlines',
  },
  buildPrompt: buildPromptMock,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

async function readResponseBody(response: Response) {
  const reader = response.body?.getReader();
  expect(reader).toBeTruthy();

  const decoder = new TextDecoder();
  let text = '';

  while (reader) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    text += decoder.decode(value, { stream: true });
  }

  return text;
}

describe('generation routes', () => {
  beforeEach(() => {
    vi.resetModules();
    applyOutlineFallbacksMock.mockReset();
    buildCompleteSceneMock.mockReset();
    buildPromptMock.mockReset();
    buildVisionUserContentMock.mockReset();
    callLLMMock.mockReset();
    formatImageDescriptionMock.mockReset();
    formatImagePlaceholderMock.mockReset();
    formatTeacherPersonaForPromptMock.mockReset();
    generateSceneActionsMock.mockReset();
    generateSceneContentMock.mockReset();
    getRequestAuthMock.mockReset();
    loadTeacherAdaptivePromptMock.mockReset();
    resolveModelFromHeadersMock.mockReset();
    resolveModelFromHeadersWithScopeMock.mockReset();
    resolveSceneGenerationScenarioMock.mockReset();
    streamLLMMock.mockReset();
    toGovernedProviderApiErrorResponseMock.mockReset();
    uniquifyMediaElementIdsMock.mockReset();

    buildPromptMock.mockReturnValue({ system: 'system prompt', user: 'user prompt' });
    buildVisionUserContentMock.mockReturnValue([]);
    formatImageDescriptionMock.mockReturnValue('image-description');
    formatImagePlaceholderMock.mockReturnValue('image-placeholder');
    formatTeacherPersonaForPromptMock.mockReturnValue('');
    getRequestAuthMock.mockResolvedValue({
      organization: { id: 'org-1' },
      session: { role: 'teacher' },
      user: { id: 'teacher-1' },
    });
    loadTeacherAdaptivePromptMock.mockResolvedValue('');
    resolveModelFromHeadersMock.mockResolvedValue({
      model: 'resolved-model',
      modelInfo: { capabilities: {} },
      modelString: 'resolved-model',
    });
    resolveModelFromHeadersWithScopeMock.mockResolvedValue({
      model: 'resolved-model',
      modelInfo: { capabilities: {} },
      modelString: 'resolved-model',
    });
    resolveSceneGenerationScenarioMock.mockResolvedValue(null);
    toGovernedProviderApiErrorResponseMock.mockReturnValue(null);
    uniquifyMediaElementIdsMock.mockImplementation((outlines) => outlines);
  });

  it('validates required input for agent profile generation', async () => {
    const { POST } = await import('@/app/api/generate/agent-profiles/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/agent-profiles', {
        method: 'POST',
        body: JSON.stringify({
          language: 'en-US',
          availableAvatars: ['/teacher.png', '/student.png'],
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_REQUIRED_FIELD');
  });

  it('generates agent profiles from a valid LLM response', async () => {
    callLLMMock.mockResolvedValue({
      text: JSON.stringify({
        agents: [
          {
            name: 'Teacher',
            role: 'teacher',
            persona: 'Guides the class.',
            avatar: '/teacher.png',
            color: '#123456',
            priority: 10,
          },
          {
            name: 'Student',
            role: 'student',
            persona: 'Asks follow-up questions.',
            avatar: '/student.png',
            color: '#654321',
            priority: 5,
          },
        ],
      }),
    });

    const { POST } = await import('@/app/api/generate/agent-profiles/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/agent-profiles', {
        method: 'POST',
        body: JSON.stringify({
          stageInfo: { name: 'Physics 101' },
          language: 'en-US',
          availableAvatars: ['/teacher.png', '/student.png'],
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.agents).toHaveLength(2);
    expect(body.agents[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^gen-/),
        name: 'Teacher',
        role: 'teacher',
      }),
    );
  });

  it('includes avatar naming guidance in the agent profile prompt', async () => {
    callLLMMock.mockResolvedValue({
      text: JSON.stringify({
        agents: [
          {
            name: 'Mr. Rivera',
            role: 'teacher',
            persona: 'Guides the class with calm structure.',
            avatar: '/avatars/principal.png',
            color: '#123456',
            priority: 10,
          },
          {
            name: 'Ms. Park',
            role: 'student',
            persona: 'Asks practical follow-up questions.',
            avatar: '/avatars/librarian.png',
            color: '#654321',
            priority: 5,
          },
        ],
      }),
    });

    const { POST } = await import('@/app/api/generate/agent-profiles/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/agent-profiles', {
        method: 'POST',
        body: JSON.stringify({
          stageInfo: { name: 'Physics 101' },
          language: 'en-US',
          availableAvatars: ['/avatars/principal.png', '/avatars/librarian.png'],
          avatarDescriptions: [
            { path: '/avatars/principal.png', desc: 'Confident principal portrait' },
            { path: '/avatars/librarian.png', desc: 'Friendly librarian portrait' },
          ],
          avatarNameGuidance: [
            {
              path: '/avatars/principal.png',
              nameGender: 'masculine',
              nameGuidance: 'Use a masculine educator name.',
            },
            {
              path: '/avatars/librarian.png',
              nameGender: 'feminine',
              nameGuidance: 'Use a feminine professional name.',
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);

    const request = callLLMMock.mock.calls[0][0] as { prompt: string };
    expect(request.prompt).toContain('Avatar naming guidance is included');
    expect(request.prompt).toContain('"nameGender":"masculine"');
    expect(request.prompt).toContain('"nameGender":"feminine"');
    expect(request.prompt).toContain('Do not mention gender in personas');
  });

  it('validates required input for scene content generation', async () => {
    const { POST } = await import('@/app/api/generate/scene-content/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/scene-content', {
        method: 'POST',
        body: JSON.stringify({
          allOutlines: [{ id: 'outline-1', order: 1, title: 'Intro', type: 'slide' }],
          stageId: 'stage-1',
          stageInfo: { name: 'Physics 101', language: 'en-US' },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_REQUIRED_FIELD');
  });

  it('returns generated scene content and the effective outline', async () => {
    const outline = { id: 'outline-1', order: 1, title: 'Intro', type: 'slide', language: 'en-US' };
    applyOutlineFallbacksMock.mockReturnValue(outline);
    generateSceneContentMock.mockResolvedValue({ slideTitle: 'Welcome' });

    const { POST } = await import('@/app/api/generate/scene-content/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/scene-content', {
        method: 'POST',
        body: JSON.stringify({
          outline,
          allOutlines: [outline],
          stageId: 'stage-1',
          stageInfo: { name: 'Physics 101', language: 'en-US' },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      content: { slideTitle: 'Welcome' },
      effectiveOutline: outline,
    });
  });

  it('routes scene content generation through the scene scenario profile before header fallback', async () => {
    const outline = { id: 'outline-1', order: 1, title: 'Intro', type: 'slide', language: 'en-US' };
    applyOutlineFallbacksMock.mockReturnValue(outline);
    generateSceneContentMock.mockResolvedValue({ slideTitle: 'Scenario Welcome' });
    resolveSceneGenerationScenarioMock.mockResolvedValue({
      model: 'scenario-model',
      modelInfo: { outputWindow: 8192, capabilities: { streaming: true, vision: true } },
      modelString: 'openai:gpt-4o',
    });

    const { POST } = await import('@/app/api/generate/scene-content/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/scene-content', {
        method: 'POST',
        headers: {
          'x-model': 'anthropic:claude-sonnet-4-5',
          'x-api-key': 'client-key',
          'x-base-url': 'https://client.example.com/v1',
          'x-provider-type': 'openai',
        },
        body: JSON.stringify({
          outline,
          allOutlines: [outline],
          stageId: 'stage-1',
          stageInfo: { name: 'Physics 101', language: 'en-US' },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(resolveSceneGenerationScenarioMock).toHaveBeenCalledWith(
      expect.objectContaining({
        routeId: 'scene-content',
        requestedModelString: 'anthropic:claude-sonnet-4-5',
        apiKey: 'client-key',
        baseUrl: 'https://client.example.com/v1',
        providerType: 'openai',
      }),
    );
    expect(resolveModelFromHeadersWithScopeMock).not.toHaveBeenCalled();
    expect(generateSceneContentMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to header model resolution for scene content when no scene scenario is configured', async () => {
    const outline = { id: 'outline-1', order: 1, title: 'Intro', type: 'slide', language: 'en-US' };
    applyOutlineFallbacksMock.mockReturnValue(outline);
    generateSceneContentMock.mockResolvedValue({ slideTitle: 'Welcome' });
    resolveSceneGenerationScenarioMock.mockResolvedValue(null);

    const { POST } = await import('@/app/api/generate/scene-content/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/scene-content', {
        method: 'POST',
        body: JSON.stringify({
          outline,
          allOutlines: [outline],
          stageId: 'stage-1',
          stageInfo: { name: 'Physics 101', language: 'en-US' },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(resolveModelFromHeadersWithScopeMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        auth: expect.objectContaining({
          user: { id: 'teacher-1' },
        }),
      }),
    );
  });

  it('passes teacher adaptive context into scene content generation', async () => {
    const outline = { id: 'outline-1', order: 1, title: 'Intro', type: 'slide', language: 'en-US' };
    applyOutlineFallbacksMock.mockReturnValue(outline);
    loadTeacherAdaptivePromptMock.mockResolvedValue(
      [
        '## Adaptive Session Context',
        'This requirement matches 1 prior session(s). Treat this as a repeated-session classroom, not a first-time lesson.',
        '- Last completed segment: Orbital transfer maneuvers',
        '- Revisit intent: remediate',
        '- Mastery hints: transfer windows; burn timing',
        '- Reflection summary: Spend more time on transfer windows before moving on.',
      ].join('\n'),
    );
    generateSceneContentMock.mockResolvedValue({ slideTitle: 'Welcome' });

    const { POST } = await import('@/app/api/generate/scene-content/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/scene-content', {
        method: 'POST',
        body: JSON.stringify({
          outline,
          allOutlines: [outline],
          stageId: 'stage-1',
          classroomId: 'room-1',
          stageInfo: { name: 'Physics 101', language: 'en-US' },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(loadTeacherAdaptivePromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        classroomId: 'room-1',
      }),
    );
    expect(generateSceneContentMock).toHaveBeenCalledTimes(1);

    const generationOptions = generateSceneContentMock.mock.calls[0]?.[2] as
      | { adaptivePrompt?: string }
      | undefined;
    const adaptivePrompt = generationOptions?.adaptivePrompt;
    expect(scorePromptReplay(adaptivePrompt, repeatedSessionPromptExpectation)).toEqual({
      pass: true,
      missing: [],
      unexpected: [],
    });
  });

  it('fails open for first-run teacher scene content regeneration', async () => {
    const outline = { id: 'outline-1', order: 1, title: 'Intro', type: 'slide', language: 'en-US' };
    applyOutlineFallbacksMock.mockReturnValue(outline);
    loadTeacherAdaptivePromptMock.mockResolvedValue('');
    generateSceneContentMock.mockResolvedValue({ slideTitle: 'Welcome' });

    const { POST } = await import('@/app/api/generate/scene-content/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/scene-content', {
        method: 'POST',
        body: JSON.stringify({
          outline,
          allOutlines: [outline],
          stageId: 'stage-1',
          classroomId: 'room-1',
          stageInfo: { name: 'Physics 101', language: 'en-US' },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(generateSceneContentMock).toHaveBeenCalledTimes(1);

    const generationOptions = generateSceneContentMock.mock.calls[0]?.[2] as
      | { adaptivePrompt?: string }
      | undefined;
    const adaptivePrompt = generationOptions?.adaptivePrompt;
    expect(scorePromptReplay(adaptivePrompt, noAdaptivePromptExpectation)).toEqual({
      pass: true,
      missing: [],
      unexpected: [],
    });
  });

  it('validates required input for scene action generation', async () => {
    const outline = { id: 'outline-1', order: 1, title: 'Intro', type: 'slide' };

    const { POST } = await import('@/app/api/generate/scene-actions/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/scene-actions', {
        method: 'POST',
        body: JSON.stringify({
          outline,
          allOutlines: [outline],
          content: { slideTitle: 'Welcome' },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_REQUIRED_FIELD');
  });

  it('assembles a scene after generating action steps', async () => {
    const outline = { id: 'outline-1', order: 1, title: 'Intro', type: 'slide' };
    generateSceneActionsMock.mockResolvedValue([{ type: 'speech', text: 'Welcome aboard.' }]);
    buildCompleteSceneMock.mockReturnValue({
      id: 'scene-1',
      order: 1,
      type: 'slide',
      actions: [{ type: 'speech', text: 'Welcome aboard.' }],
      content: { slideTitle: 'Welcome' },
    });

    const { POST } = await import('@/app/api/generate/scene-actions/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/scene-actions', {
        method: 'POST',
        body: JSON.stringify({
          outline,
          allOutlines: [outline],
          content: { slideTitle: 'Welcome' },
          stageId: 'stage-1',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.scene.id).toBe('scene-1');
    expect(body.previousSpeeches).toEqual(['Welcome aboard.']);
  });

  it('routes scene action generation through the scene scenario profile', async () => {
    const outline = { id: 'outline-1', order: 1, title: 'Intro', type: 'slide' };
    resolveSceneGenerationScenarioMock.mockResolvedValue({
      model: 'scenario-actions-model',
      modelInfo: { outputWindow: 8192, capabilities: { streaming: true } },
      modelString: 'openai:gpt-4o-mini',
    });
    generateSceneActionsMock.mockResolvedValue([{ type: 'speech', text: 'Welcome aboard.' }]);
    buildCompleteSceneMock.mockReturnValue({
      id: 'scene-1',
      order: 1,
      type: 'slide',
      actions: [{ type: 'speech', text: 'Welcome aboard.' }],
      content: { slideTitle: 'Welcome' },
    });

    const { POST } = await import('@/app/api/generate/scene-actions/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/scene-actions', {
        method: 'POST',
        body: JSON.stringify({
          outline,
          allOutlines: [outline],
          content: { slideTitle: 'Welcome' },
          stageId: 'stage-1',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(resolveSceneGenerationScenarioMock).toHaveBeenCalledWith(
      expect.objectContaining({
        routeId: 'scene-actions',
      }),
    );
    expect(resolveModelFromHeadersWithScopeMock).not.toHaveBeenCalled();
  });

  it('injects teacher adaptive context into scene action prompts', async () => {
    const outline = { id: 'outline-1', order: 1, title: 'Intro', type: 'slide' };
    loadTeacherAdaptivePromptMock.mockResolvedValue(
      [
        '## Adaptive Session Context',
        'This requirement matches 1 prior session(s). Treat this as a repeated-session classroom, not a first-time lesson.',
        '- Last completed segment: Orbital transfer maneuvers',
        '- Revisit intent: remediate',
        '- Mastery hints: transfer windows; burn timing',
        '- Reflection summary: Spend more time on transfer windows before moving on.',
      ].join('\n'),
    );
    callLLMMock.mockResolvedValue({ text: '[]' });
    generateSceneActionsMock.mockImplementation(async (_outline, _content, aiCall) => {
      await aiCall('system prompt', 'user prompt');
      return [{ type: 'speech', text: 'Welcome aboard.' }];
    });
    buildCompleteSceneMock.mockReturnValue({
      id: 'scene-1',
      order: 1,
      type: 'slide',
      actions: [{ type: 'speech', text: 'Welcome aboard.' }],
      content: { slideTitle: 'Welcome' },
    });

    const { POST } = await import('@/app/api/generate/scene-actions/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/scene-actions', {
        method: 'POST',
        body: JSON.stringify({
          outline,
          allOutlines: [outline],
          content: { slideTitle: 'Welcome' },
          classroomId: 'room-1',
          stageId: 'stage-1',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(callLLMMock).toHaveBeenCalledTimes(1);

    const llmRequest = callLLMMock.mock.calls[0]?.[0];
    expect(scorePromptReplay(llmRequest?.system, repeatedSessionPromptExpectation)).toEqual({
      pass: true,
      missing: [],
      unexpected: [],
    });
  });

  it('fails open for first-run teacher scene action regeneration', async () => {
    const outline = { id: 'outline-1', order: 1, title: 'Intro', type: 'slide' };
    loadTeacherAdaptivePromptMock.mockResolvedValue('');
    callLLMMock.mockResolvedValue({ text: '[]' });
    generateSceneActionsMock.mockImplementation(async (_outline, _content, aiCall) => {
      await aiCall('system prompt', 'user prompt');
      return [{ type: 'speech', text: 'Welcome aboard.' }];
    });
    buildCompleteSceneMock.mockReturnValue({
      id: 'scene-1',
      order: 1,
      type: 'slide',
      actions: [{ type: 'speech', text: 'Welcome aboard.' }],
      content: { slideTitle: 'Welcome' },
    });

    const { POST } = await import('@/app/api/generate/scene-actions/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/scene-actions', {
        method: 'POST',
        body: JSON.stringify({
          outline,
          allOutlines: [outline],
          content: { slideTitle: 'Welcome' },
          classroomId: 'room-1',
          stageId: 'stage-1',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(callLLMMock).toHaveBeenCalledTimes(1);

    const llmRequest = callLLMMock.mock.calls[0]?.[0];
    expect(scorePromptReplay(llmRequest?.system, noAdaptivePromptExpectation)).toEqual({
      pass: true,
      missing: [],
      unexpected: [],
    });
  });

  it('validates required input for outline streaming', async () => {
    const { POST } = await import('@/app/api/generate/scene-outlines-stream/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/scene-outlines-stream', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_REQUIRED_FIELD');
  });

  it('streams outline and done events over SSE', async () => {
    streamLLMMock.mockReturnValue({
      textStream: (async function* () {
        yield '[{"title":"Intro","type":"slide","order":1}]';
      })(),
    });

    const { POST } = await import('@/app/api/generate/scene-outlines-stream/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/scene-outlines-stream', {
        method: 'POST',
        body: JSON.stringify({
          requirements: {
            requirement: 'Teach renewable energy',
            language: 'en-US',
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const bodyText = await readResponseBody(response);
    expect(bodyText).toContain('"type":"outline"');
    expect(bodyText).toContain('"type":"done"');
  });

  it('routes outline streaming through the scene scenario profile', async () => {
    resolveSceneGenerationScenarioMock.mockResolvedValue({
      model: 'scenario-outline-model',
      modelInfo: { outputWindow: 8192, capabilities: { streaming: true } },
      modelString: 'openai:gpt-4o',
    });
    streamLLMMock.mockReturnValue({
      textStream: (async function* () {
        yield '[{"title":"Scenario Intro","type":"slide","order":1}]';
      })(),
    });

    const { POST } = await import('@/app/api/generate/scene-outlines-stream/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/scene-outlines-stream', {
        method: 'POST',
        body: JSON.stringify({
          requirements: {
            requirement: 'Teach renewable energy',
            language: 'en-US',
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await readResponseBody(response);
    expect(resolveSceneGenerationScenarioMock).toHaveBeenCalledWith(
      expect.objectContaining({
        routeId: 'scene-outlines-stream',
      }),
    );
    expect(resolveModelFromHeadersWithScopeMock).not.toHaveBeenCalled();
    expect(streamLLMMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'scenario-outline-model',
        maxOutputTokens: 8192,
      }),
      'scene-outlines-stream',
    );
  });

  it('returns governed provider errors when scene scenario validation fails closed', async () => {
    const governedResponse = new Response(
      JSON.stringify({
        success: false,
        errorCode: 'INVALID_REQUEST',
        error: 'No validated scene scenario candidate is available.',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
    const governedError = new Error('No validated scene scenario candidate is available.');
    resolveSceneGenerationScenarioMock.mockRejectedValue(governedError);
    toGovernedProviderApiErrorResponseMock.mockReturnValue(governedResponse);

    const { POST } = await import('@/app/api/generate/scene-outlines-stream/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/scene-outlines-stream', {
        method: 'POST',
        body: JSON.stringify({
          requirements: {
            requirement: 'Teach renewable energy',
            language: 'en-US',
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('INVALID_REQUEST');
    expect(resolveModelFromHeadersWithScopeMock).not.toHaveBeenCalled();
    expect(streamLLMMock).not.toHaveBeenCalled();
  });

  it('rejects quiz grades with invalid point totals', async () => {
    const { POST } = await import('@/app/api/quiz-grade/route');
    const response = await POST(
      new NextRequest('http://localhost/api/quiz-grade', {
        method: 'POST',
        body: JSON.stringify({
          question: 'What is gravity?',
          userAnswer: 'A force.',
          points: 0,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('INVALID_REQUEST');
  });

  it('grades quiz answers from LLM JSON output', async () => {
    callLLMMock.mockResolvedValue({
      text: '{"score":4,"comment":"Strong answer."}',
    });

    const { POST } = await import('@/app/api/quiz-grade/route');
    const response = await POST(
      new NextRequest('http://localhost/api/quiz-grade', {
        method: 'POST',
        body: JSON.stringify({
          question: 'What is gravity?',
          userAnswer: 'A force that pulls objects together.',
          points: 5,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      score: 4,
      comment: 'Strong answer.',
    });
  });
});
