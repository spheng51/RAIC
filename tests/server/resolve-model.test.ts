import { beforeEach, describe, expect, it, vi } from 'vitest';

const getModelMock = vi.fn();
const resolveLLMGovernedConfigMock = vi.fn();

vi.mock('@/lib/ai/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/providers')>();
  return {
    ...actual,
    getModel: getModelMock,
  };
});

vi.mock('@/lib/server/ai-governance', () => ({
  resolveLLMGovernedConfig: resolveLLMGovernedConfigMock,
}));

describe('resolveModel', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    getModelMock.mockReset();
    resolveLLMGovernedConfigMock.mockReset();

    getModelMock.mockReturnValue({
      model: 'resolved-model',
      modelInfo: null,
    });

    resolveLLMGovernedConfigMock.mockImplementation(async (params) => ({
      providerId: params.providerId,
      modelId: params.modelId,
      apiKey: 'sk-server',
      baseUrl: undefined,
      proxy: undefined,
      providerType: 'openai',
    }));
  });

  it('falls back to gpt-5.4-mini when no explicit model is provided', async () => {
    const { resolveModel } = await import('@/lib/server/resolve-model');
    const result = await resolveModel({});

    expect(resolveLLMGovernedConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai',
        modelId: 'gpt-5.4-mini',
      }),
    );
    expect(result.modelString).toBe('openai:gpt-5.4-mini');
  });

  it('prefers DEFAULT_MODEL over the built-in OpenAI fallback', async () => {
    vi.stubEnv('DEFAULT_MODEL', 'openai:gpt-4.1-mini');

    const { resolveModel } = await import('@/lib/server/resolve-model');
    const result = await resolveModel({});

    expect(resolveLLMGovernedConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai',
        modelId: 'gpt-4.1-mini',
      }),
    );
    expect(result.modelString).toBe('openai:gpt-4.1-mini');
  });
});
