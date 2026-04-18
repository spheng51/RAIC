import { beforeEach, describe, expect, it, vi } from 'vitest';

const scenarioYamlState = vi.hoisted(() => ({
  exists: false,
  raw: '',
  parsed: null as {
    profiles?: Record<
      string,
      {
        description?: string;
        buckets?: Record<string, Array<string | { providerId: string; modelId?: string }>>;
      }
    >;
  } | null,
}));

vi.mock('fs', () => {
  const existsSync = vi.fn(() => scenarioYamlState.exists);
  const readFileSync = vi.fn(() => scenarioYamlState.raw);

  return {
    default: {
      existsSync,
      readFileSync,
    },
    existsSync,
    readFileSync,
  };
});

vi.mock('js-yaml', () => {
  const load = vi.fn(() => scenarioYamlState.parsed);

  return {
    default: {
      load,
    },
    load,
  };
});

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('provider scenario profile selection', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    scenarioYamlState.exists = false;
    scenarioYamlState.raw = '';
    scenarioYamlState.parsed = null;
  });

  it('merges env bucket overrides into the selected YAML profile', async () => {
    scenarioYamlState.exists = true;
    scenarioYamlState.raw = 'profiles: {}';
    scenarioYamlState.parsed = {
      profiles: {
        'teacher-differentiation-v1': {
          description: 'YAML baseline profile',
          buckets: {
            scene: ['openai:gpt-4o-mini'],
            image: ['seedream:q1'],
            transcript: ['deepgram:nova-3'],
            webSearch: ['tavily:search-default'],
          },
        },
      },
    };

    vi.stubEnv('RAIC_DEFAULT_PROVIDER_SCENARIO', 'teacher-differentiation-v1');
    vi.stubEnv('RAIC_PROVIDER_SCENARIO_IMAGE', 'qwen-image:qwen-image-max');

    const { getProviderScenarioProfile } = await import('@/lib/server/provider-scenarios');
    const profile = getProviderScenarioProfile();

    expect(profile).toMatchObject({
      id: 'teacher-differentiation-v1',
      description: 'YAML baseline profile',
      buckets: {
        scene: [{ providerId: 'openai', modelId: 'gpt-4o-mini' }],
        image: [{ providerId: 'qwen-image', modelId: 'qwen-image-max' }],
        transcript: [{ providerId: 'deepgram', modelId: 'nova-3' }],
        webSearch: [{ providerId: 'tavily', modelId: 'search-default' }],
      },
    });
  });
});
