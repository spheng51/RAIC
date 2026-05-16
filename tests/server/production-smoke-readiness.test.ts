import { beforeAll, describe, expect, it } from 'vitest';

type ProductionSmokeReadinessModule =
  typeof import('../../scripts/lib/production-smoke-readiness.mjs');

let evaluateOptionalProviderFeature: ProductionSmokeReadinessModule['evaluateOptionalProviderFeature'];
let findUnconfiguredLlmProbe: ProductionSmokeReadinessModule['findUnconfiguredLlmProbe'];
let getFirstEnabledSecretProvider: ProductionSmokeReadinessModule['getFirstEnabledSecretProvider'];
let isFriendlyProviderError: ProductionSmokeReadinessModule['isFriendlyProviderError'];
let isRequiredFeature: ProductionSmokeReadinessModule['isRequiredFeature'];

function smokeEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: 'test', ...overrides };
}

beforeAll(async () => {
  ({
    evaluateOptionalProviderFeature,
    findUnconfiguredLlmProbe,
    getFirstEnabledSecretProvider,
    isFriendlyProviderError,
    isRequiredFeature,
  } = await import('../../scripts/lib/production-smoke-readiness.mjs'));
});

describe('production smoke readiness helpers', () => {
  it('finds an enabled secret-backed provider without assuming a fixed model id', () => {
    const provider = getFirstEnabledSecretProvider(
      {
        llm: {
          openai: {
            enabled: true,
            hasSecret: true,
            allowedModels: ['nvidia/nemotron-3-super-120b-a12b:free'],
          },
        },
      },
      'llm',
    );

    expect(provider).toEqual({
      providerId: 'openai',
      allowedModels: ['nvidia/nemotron-3-super-120b-a12b:free'],
    });
  });

  it('skips optional providers unless the release explicitly requires them', () => {
    expect(
      evaluateOptionalProviderFeature({
        groups: { tts: {} },
        groupName: 'tts',
        featureName: 'tts',
        env: smokeEnv(),
      }),
    ).toEqual({
      status: 'skip',
      detail: 'tts is not required for this release',
    });

    expect(
      evaluateOptionalProviderFeature({
        groups: { tts: {} },
        groupName: 'tts',
        featureName: 'tts',
        env: smokeEnv({ RAIC_REQUIRED_PRODUCTION_FEATURES: 'tts' }),
      }).status,
    ).toBe('block');
  });

  it('supports explicit feature flags for production smoke requirements', () => {
    expect(isRequiredFeature('mirofish', smokeEnv({ RAIC_REQUIRE_MIROFISH_SMOKE: 'true' }))).toBe(
      true,
    );
    expect(
      isRequiredFeature('mirofish', smokeEnv({ RAIC_REQUIRED_PRODUCTION_FEATURES: 'tts' })),
    ).toBe(false);
  });

  it('chooses an unconfigured provider probe for friendly error checks', () => {
    const probe = findUnconfiguredLlmProbe({
      llm: {
        openai: { enabled: true, hasSecret: true, allowedModels: ['gpt-4o'] },
        anthropic: { enabled: false, hasSecret: false, allowedModels: ['claude-sonnet-4-5'] },
      },
    });

    expect(probe).toEqual({ providerId: 'anthropic', modelId: 'claude-sonnet-4-5' });
  });

  it('accepts missing-key and missing-provider 400 responses as friendly provider errors', () => {
    expect(isFriendlyProviderError(400, { errorCode: 'MISSING_API_KEY' })).toBe(true);
    expect(isFriendlyProviderError(400, { errorCode: 'INVALID_REQUEST' })).toBe(true);
    expect(isFriendlyProviderError(500, { errorCode: 'INTERNAL_ERROR' })).toBe(false);
  });
});
