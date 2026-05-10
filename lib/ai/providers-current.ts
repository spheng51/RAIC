/**
 * Current direct-provider model registry overlay.
 *
 * checkedAt: 2026-05-10
 *
 * This file keeps the large provider implementation in ./providers intact while
 * refreshing the exported built-in model lists. The IDs here are provider-native
 * model IDs, not Vercel AI Gateway slugs.
 */

import { PROVIDERS as BASE_PROVIDERS, getModel as baseGetModel } from './providers';
import type { ModelWithInfo } from './providers';
import type { ModelConfig, ModelInfo, ProviderConfig, ProviderId } from '@/lib/types/provider';

export { MONO_LOGO_PROVIDERS, isProviderKeyRequired, parseModelString } from './providers';
export type { ModelWithInfo } from './providers';
export type { ModelConfig, ModelInfo, ProviderConfig, ProviderId } from '@/lib/types/provider';

export const MODEL_REGISTRY_CHECKED_AT = '2026-05-10';

function toggleableThinking(defaultEnabled = false) {
  return {
    toggleable: true,
    budgetAdjustable: true,
    defaultEnabled,
  };
}

function fixedThinking(defaultEnabled = true) {
  return {
    toggleable: false,
    budgetAdjustable: true,
    defaultEnabled,
  };
}

function vendorThinking(defaultEnabled = false) {
  return {
    toggleable: true,
    budgetAdjustable: false,
    defaultEnabled,
  };
}

function mergeModels(existing: ModelInfo[], additions: ModelInfo[]): ModelInfo[] {
  const additionIds = new Set(additions.map((model) => model.id));
  return [...additions, ...existing.filter((model) => !additionIds.has(model.id))];
}

function withModels(providerId: ProviderId, additions: ModelInfo[]): ProviderConfig {
  const provider = BASE_PROVIDERS[providerId];
  return {
    ...provider,
    models: mergeModels(provider.models, additions),
  };
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  ...BASE_PROVIDERS,
  openai: withModels('openai', [
    {
      id: 'gpt-5.5',
      name: 'GPT-5.5',
      contextWindow: 1000000,
      outputWindow: 128000,
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
        thinking: toggleableThinking(false),
      },
    },
  ]),
  anthropic: withModels('anthropic', [
    {
      id: 'claude-opus-4-7',
      name: 'Claude Opus 4.7',
      contextWindow: 1000000,
      outputWindow: 128000,
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
        thinking: toggleableThinking(false),
      },
    },
  ]),
  google: withModels('google', [
    {
      id: 'gemini-3.1-flash-lite',
      name: 'Gemini 3.1 Flash Lite',
      contextWindow: 1048576,
      outputWindow: 65536,
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
        thinking: fixedThinking(true),
      },
    },
  ]),
  qwen: withModels('qwen', [
    {
      id: 'qwen3.6-max-preview',
      name: 'Qwen3.6 Max Preview',
      contextWindow: 262144,
      outputWindow: 65536,
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        thinking: toggleableThinking(true),
      },
    },
    {
      id: 'qwen3.6-plus',
      name: 'Qwen3.6 Plus',
      contextWindow: 1000000,
      outputWindow: 65536,
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
        thinking: toggleableThinking(true),
      },
    },
    {
      id: 'qwen3.6-flash',
      name: 'Qwen3.6 Flash',
      contextWindow: 1000000,
      outputWindow: 65536,
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
        thinking: toggleableThinking(true),
      },
    },
  ]),
  deepseek: withModels('deepseek', [
    {
      id: 'deepseek-v4-pro',
      name: 'DeepSeek V4 Pro',
      contextWindow: 1000000,
      outputWindow: 384000,
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        thinking: vendorThinking(true),
      },
    },
    {
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      contextWindow: 1000000,
      outputWindow: 384000,
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        thinking: vendorThinking(false),
      },
    },
  ]),
  glm: withModels('glm', [
    {
      id: 'glm-5.1',
      name: 'GLM-5.1',
      contextWindow: 198000,
      outputWindow: 128000,
      capabilities: {
        streaming: true,
        tools: true,
        vision: false,
        thinking: toggleableThinking(true),
      },
    },
  ]),
  kimi: withModels('kimi', [
    {
      id: 'kimi-k2.6',
      name: 'Kimi K2.6',
      contextWindow: 256000,
      outputWindow: 96000,
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
        thinking: vendorThinking(true),
      },
    },
  ]),
  grok: withModels('grok', [
    {
      id: 'grok-4.3',
      name: 'Grok 4.3',
      contextWindow: 256000,
      outputWindow: 32768,
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
      },
    },
    {
      id: 'grok-4.20-0309-reasoning',
      name: 'Grok 4.20 Reasoning',
      contextWindow: 2000000,
      outputWindow: 131072,
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
        thinking: fixedThinking(true),
      },
    },
    {
      id: 'grok-4.20-0309-non-reasoning',
      name: 'Grok 4.20',
      contextWindow: 2000000,
      outputWindow: 131072,
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
      },
    },
  ]),
};

const MODEL_ALIASES: Partial<Record<ProviderId, Record<string, string>>> = {
  grok: {
    'grok-4.20-reasoning': 'grok-4.20-0309-reasoning',
    'grok-4.20-beta-0309-reasoning': 'grok-4.20-0309-reasoning',
    'grok-4.20-beta-latest-non-reasoning': 'grok-4.20-0309-non-reasoning',
    'grok-4.20-beta-0309-non-reasoning': 'grok-4.20-0309-non-reasoning',
    'grok-4-0709': 'grok-4',
  },
};

function normalizeCurrentProviderModelId(providerId: ProviderId, modelId: string): string {
  return MODEL_ALIASES[providerId]?.[modelId] ?? modelId;
}

export function getModel(config: ModelConfig): ModelWithInfo {
  const normalizedModelId = normalizeCurrentProviderModelId(config.providerId, config.modelId);
  const resolved = baseGetModel({ ...config, modelId: normalizedModelId });
  return {
    ...resolved,
    modelInfo: getModelInfo(config.providerId, normalizedModelId) ?? resolved.modelInfo,
  };
}

export function getAllModels(): { provider: ProviderConfig; models: ModelInfo[] }[] {
  return Object.values(PROVIDERS).map((provider) => ({
    provider,
    models: provider.models,
  }));
}

export function getProvider(providerId: ProviderId): ProviderConfig | undefined {
  return PROVIDERS[providerId];
}

export function getModelInfo(providerId: ProviderId, modelId: string): ModelInfo | undefined {
  const provider = PROVIDERS[providerId];
  const normalizedModelId = normalizeCurrentProviderModelId(providerId, modelId);
  return provider?.models.find((model) => model.id === normalizedModelId);
}
