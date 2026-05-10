/**
 * Current audio model registry overlay.
 *
 * checkedAt: 2026-05-10
 *
 * Keeps the existing provider implementation in ./constants intact while
 * exposing newly verified built-in TTS model IDs to settings/UI code.
 */

import {
  ASR_PROVIDERS,
  CUSTOM_ASR_DEFAULT_LANGUAGES,
  DEFAULT_TTS_MODELS as BASE_DEFAULT_TTS_MODELS,
  DEFAULT_TTS_VOICES,
  MINIMAX_TTS_MODELS,
  TTS_PROVIDERS as BASE_TTS_PROVIDERS,
} from './constants';
import type {
  ASRProviderConfig,
  ASRProviderId,
  BuiltInTTSProviderId,
  TTSProviderConfig,
  TTSProviderId,
  TTSVoiceInfo,
} from './types';

export {
  ASR_PROVIDERS,
  CUSTOM_ASR_DEFAULT_LANGUAGES,
  DEFAULT_TTS_VOICES,
  MINIMAX_TTS_MODELS,
};

export const AUDIO_MODEL_REGISTRY_CHECKED_AT = '2026-05-10';

function mergeModels<T extends { id: string; name: string }>(
  existing: T[],
  additions: T[],
): T[] {
  const additionIds = new Set(additions.map((model) => model.id));
  return [...additions, ...existing.filter((model) => !additionIds.has(model.id))];
}

export const TTS_PROVIDERS: Record<BuiltInTTSProviderId, TTSProviderConfig> = {
  ...BASE_TTS_PROVIDERS,
  'elevenlabs-tts': {
    ...BASE_TTS_PROVIDERS['elevenlabs-tts'],
    models: mergeModels(BASE_TTS_PROVIDERS['elevenlabs-tts'].models, [
      { id: 'eleven_v3', name: 'Eleven v3' },
      { id: 'eleven_turbo_v2_5', name: 'Turbo v2.5' },
    ]),
  },
};

export const DEFAULT_TTS_MODELS: Record<BuiltInTTSProviderId, string> = {
  ...BASE_DEFAULT_TTS_MODELS,
};

export function getAllTTSProviders(
  customProviders?: Record<string, TTSProviderConfig>,
): TTSProviderConfig[] {
  const builtIn = Object.values(TTS_PROVIDERS);
  const custom = customProviders ? Object.values(customProviders) : [];
  return [...builtIn, ...custom];
}

export function getTTSProvider(
  providerId: TTSProviderId,
  customProviders?: Record<string, TTSProviderConfig>,
): TTSProviderConfig | undefined {
  if (providerId in TTS_PROVIDERS) {
    return TTS_PROVIDERS[providerId as BuiltInTTSProviderId];
  }
  return customProviders?.[providerId];
}

export function getTTSVoices(
  providerId: TTSProviderId,
  customProviders?: Record<string, TTSProviderConfig>,
): TTSVoiceInfo[] {
  return getTTSProvider(providerId, customProviders)?.voices || [];
}

export function getAllASRProviders(
  customProviders?: Record<string, ASRProviderConfig>,
): ASRProviderConfig[] {
  const builtIn = Object.values(ASR_PROVIDERS);
  const custom = customProviders ? Object.values(customProviders) : [];
  return [...builtIn, ...custom];
}

export function getASRProvider(
  providerId: ASRProviderId,
  customProviders?: Record<string, ASRProviderConfig>,
): ASRProviderConfig | undefined {
  if (providerId in ASR_PROVIDERS) {
    return ASR_PROVIDERS[providerId as keyof typeof ASR_PROVIDERS];
  }
  return customProviders?.[providerId];
}

export function getASRSupportedLanguages(
  providerId: ASRProviderId,
  customProviders?: Record<string, ASRProviderConfig>,
): string[] {
  return getASRProvider(providerId, customProviders)?.supportedLanguages || [];
}
