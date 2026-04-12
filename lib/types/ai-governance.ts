import type { ProviderType } from '@/lib/types/provider';

export const AI_PROVIDER_FAMILIES = [
  'llm',
  'tts',
  'asr',
  'pdf',
  'image',
  'video',
  'webSearch',
] as const;

export type AIProviderFamily = (typeof AI_PROVIDER_FAMILIES)[number];

export const AI_PROVIDER_SOURCES = [
  'personal',
  'organization',
  'bootstrap',
  'legacy',
  'none',
] as const;

export type AIProviderSource = (typeof AI_PROVIDER_SOURCES)[number];

export interface AIProviderDefinitionModel {
  id: string;
  name: string;
}

export interface AIProviderDefinition {
  name: string;
  providerType?: ProviderType;
  defaultBaseUrl?: string;
  icon?: string;
  requiresApiKey?: boolean;
  models?: AIProviderDefinitionModel[];
}

export interface AIPolicySettings {
  allowPersonalOverrides: boolean;
  allowPersonalCustomBaseUrls: boolean;
}

export interface AdminProviderConfigPayload {
  family: AIProviderFamily;
  providerId: string;
  enabled: boolean;
  baseUrl?: string | null;
  allowedModels?: string[];
  defaultModel?: string | null;
  hasSecret?: boolean;
  secret?: string;
  clearSecret?: boolean;
  definition?: AIProviderDefinition | null;
}

export interface UserProviderOverridePayload {
  family: AIProviderFamily;
  providerId: string;
  enabled: boolean;
  baseUrl?: string | null;
  preferredModel?: string | null;
  hasSecret?: boolean;
  secret?: string;
  clearSecret?: boolean;
}

export interface EffectiveAIOption {
  providerId: string;
  enabled: boolean;
  source: AIProviderSource;
  allowedModels?: string[];
  defaultModel?: string | null;
  baseUrl?: string;
  hasSecret: boolean;
  isCustom?: boolean;
  providerType?: ProviderType;
  displayName?: string;
  icon?: string;
  requiresApiKey?: boolean;
  legacyFallbackAllowed?: boolean;
  hasPersonalOverride?: boolean;
  hasOrganizationConfig?: boolean;
}

export interface EffectiveAIOptionsResponse {
  policy: AIPolicySettings;
  providers: Record<AIProviderFamily, Record<string, EffectiveAIOption>>;
}
