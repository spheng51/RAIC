/**
 * AI Provider Type Definitions
 */

/**
 * Built-in provider IDs
 */
export type BuiltInProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'qwen'
  | 'kimi'
  | 'minimax'
  | 'glm'
  | 'siliconflow'
  | 'doubao'
  | 'grok'
  | 'ollama'
  | 'lmstudio';

/**
 * Provider ID (built-in or custom)
 * For custom providers, use string literals prefixed with "custom-"
 */
export type ProviderId = BuiltInProviderId | `custom-${string}`;

/**
 * Provider API types
 */
export type ProviderType = 'openai' | 'anthropic' | 'google';
export type ProviderTransportMode = 'server' | 'browser-local';

export type LibraryReviewSeverity = 'critical' | 'high' | 'medium' | 'low';

export type LibraryReviewRoute =
  | 'chat-adapter'
  | 'chat-adapter-stream'
  | 'chat'
  | 'scene-outlines-stream'
  | 'scene-content'
  | 'scene-actions'
  | 'agent-profiles'
  | 'web-search-query-rewrite'
  | 'pbl-chat'
  | 'quiz-grade'
  | 'web-search'
  | 'classroom-generation';

export type LibraryReviewCategory = 'chat' | 'tts' | 'media' | 'generation';

export interface ProviderCallMetrics {
  providerId: string;
  model: string;
  route: LibraryReviewRoute;
  category: LibraryReviewCategory;
  requestStart: number;
  firstByteMs?: number;
  firstEventMs?: number;
  status: 'ok' | 'error' | 'timeout' | 'aborted';
  errorCode?: string;
  attempts?: number;
}

export interface TraceContext {
  requestId?: string;
  providerId?: string;
  model?: string;
  category?: LibraryReviewCategory;
  providerCalls?: ProviderCallMetrics[];
  dedupeKey?: string;
  modelResolutionMs?: number;
}

export interface LibraryReviewFinding {
  severity: LibraryReviewSeverity;
  impact: string;
  location: string;
  owner: string;
  acceptanceTest: string;
}

/**
 * Describes a model's thinking/reasoning API control capability.
 * Models without thinking support simply omit this field from capabilities.
 */
export interface ThinkingCapability {
  /** Can thinking be fully disabled via API? */
  toggleable: boolean;
  /** Can thinking budget/effort intensity be adjusted? */
  budgetAdjustable: boolean;
  /** Is thinking enabled by default (when no config is passed)? */
  defaultEnabled: boolean;
}

/**
 * Unified thinking configuration for LLM calls.
 * The adapter maps this to provider-specific providerOptions.
 */
export interface ThinkingConfig {
  /**
   * Whether thinking should be enabled.
   * - true: enable (use model default or specified budget)
   * - false: disable (adapter uses best-effort for non-toggleable models)
   * - undefined: use model default behavior
   */
  enabled?: boolean;
  /**
   * Budget hint in tokens. Only used when enabled=true or undefined.
   * Adapter maps to closest supported value per provider.
   */
  budgetTokens?: number;
}

/**
 * Model information
 */
export interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  outputWindow?: number;
  capabilities?: {
    streaming?: boolean;
    tools?: boolean;
    vision?: boolean;
    thinking?: ThinkingCapability;
  };
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  id: ProviderId;
  name: string;
  type: ProviderType;
  defaultBaseUrl?: string;
  requiresApiKey: boolean;
  supportsOptionalApiKey?: boolean;
  icon?: string;
  models: ModelInfo[];
}

/**
 * Model configuration for API calls
 */
export interface ModelConfig {
  providerId: ProviderId;
  modelId: string;
  apiKey: string;
  baseUrl?: string;
  effectiveBaseUrl?: string;
  proxy?: string; // Optional: HTTP proxy URL for this provider
  providerType?: ProviderType; // Optional: for custom providers on server-side
  providerName?: string;
  transportMode?: ProviderTransportMode;
}
