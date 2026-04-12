import 'server-only';

import { randomUUID } from 'crypto';
import type { AuthContext } from '@/lib/auth/current-user';
import { PROVIDERS } from '@/lib/ai/providers';
import { ASR_PROVIDERS, TTS_PROVIDERS } from '@/lib/audio/constants';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import { PDF_PROVIDERS } from '@/lib/pdf/constants';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search/constants';
import {
  runPostgresTransaction,
  updatePlatformStore,
  type PostgresExecutor,
} from '@/lib/db/client';
import type {
  AuditLogRecord,
  OrganizationAIPolicyRecord,
  OrganizationProviderConfigRecord,
  PlatformStore,
  PlatformRole,
  UserProviderOverrideRecord,
} from '@/lib/db/schema';
import { appendAuditLog } from '@/lib/db/repositories/audit-logs';
import { findOrganizationAIPolicy } from '@/lib/db/repositories/organization-ai-policies';
import { upsertOrganizationAIPolicy } from '@/lib/db/repositories/organization-ai-policies';
import {
  findOrganizationProviderConfig,
  listOrganizationProviderConfigs,
  upsertOrganizationProviderConfig,
} from '@/lib/db/repositories/organization-provider-configs';
import {
  findUserProviderOverride,
  listUserProviderOverrides,
  upsertUserProviderOverride,
} from '@/lib/db/repositories/user-provider-overrides';
import { apiError, type ApiErrorCode } from '@/lib/server/api-response';
import { decryptSecret, encryptSecret } from '@/lib/server/encrypted-secrets';
import { getBootstrapProviderConfig } from '@/lib/server/provider-config';
import type { ProviderType } from '@/lib/types/provider';
import type {
  AdminProviderConfigPayload,
  EffectiveAIOption,
  EffectiveAIOptionsResponse,
  AIProviderDefinition,
  AIProviderFamily,
  AIProviderSource,
  AIPolicySettings,
  UserProviderOverridePayload,
} from '@/lib/types/ai-governance';

type ResolutionMode = 'interactive' | 'background';

interface ProviderCatalogEntry {
  providerId: string;
  displayName: string;
  providerType?: ProviderType;
  defaultBaseUrl?: string;
  icon?: string;
  requiresApiKey: boolean;
  models?: Array<{ id: string; name: string }>;
  isCustom?: boolean;
  clientOnly?: boolean;
  alwaysEnabled?: boolean;
}

interface ScopeData {
  auth: AuthContext | null;
  organizationId: string | null;
  userId: string | null;
  policy: AIPolicySettings;
  organizationConfigs: Map<string, OrganizationProviderConfigRecord>;
  userOverrides: Map<string, UserProviderOverrideRecord>;
}

interface ResolvedProviderCredentials {
  providerId: string;
  source: AIProviderSource;
  apiKey: string;
  baseUrl?: string;
  allowedModels?: string[];
  defaultModel?: string | null;
  providerType?: ProviderType;
  proxy?: string;
}

const DEFAULT_POLICY: AIPolicySettings = {
  allowPersonalOverrides: false,
  allowPersonalCustomBaseUrls: false,
};

type GovernedProviderResolutionErrorCode =
  | 'PROVIDER_NOT_AVAILABLE'
  | 'CLIENT_ONLY_PROVIDER'
  | 'PROVIDER_NOT_APPROVED'
  | 'PROVIDER_DISABLED'
  | 'PERSONAL_OVERRIDE_DISABLED'
  | 'MISSING_PROVIDER_CREDENTIALS'
  | 'MISSING_PROVIDER_CONFIGURATION';

export class GovernedProviderResolutionError extends Error {
  readonly code: GovernedProviderResolutionErrorCode;
  readonly status: number;
  readonly apiErrorCode: ApiErrorCode;

  constructor(
    code: GovernedProviderResolutionErrorCode,
    message: string,
    options: {
      status: number;
      apiErrorCode: ApiErrorCode;
    },
  ) {
    super(message);
    this.name = 'GovernedProviderResolutionError';
    this.code = code;
    this.status = options.status;
    this.apiErrorCode = options.apiErrorCode;
  }
}

function createGovernedProviderResolutionError(
  code: GovernedProviderResolutionErrorCode,
  message: string,
) {
  switch (code) {
    case 'PROVIDER_NOT_AVAILABLE':
    case 'CLIENT_ONLY_PROVIDER':
      return new GovernedProviderResolutionError(code, message, {
        status: 400,
        apiErrorCode: 'INVALID_REQUEST',
      });
    case 'PROVIDER_NOT_APPROVED':
    case 'PROVIDER_DISABLED':
    case 'PERSONAL_OVERRIDE_DISABLED':
      return new GovernedProviderResolutionError(code, message, {
        status: 403,
        apiErrorCode: 'FORBIDDEN',
      });
    case 'MISSING_PROVIDER_CREDENTIALS':
      return new GovernedProviderResolutionError(code, message, {
        status: 400,
        apiErrorCode: 'MISSING_API_KEY',
      });
    case 'MISSING_PROVIDER_CONFIGURATION':
      return new GovernedProviderResolutionError(code, message, {
        status: 400,
        apiErrorCode: 'INVALID_REQUEST',
      });
    default:
      return new GovernedProviderResolutionError(code, message, {
        status: 500,
        apiErrorCode: 'INTERNAL_ERROR',
      });
  }
}

export function isGovernedProviderResolutionError(
  error: unknown,
): error is GovernedProviderResolutionError {
  return (
    error instanceof GovernedProviderResolutionError ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      'status' in error &&
      'apiErrorCode' in error &&
      'message' in error &&
      typeof error.code === 'string' &&
      typeof error.status === 'number' &&
      typeof error.apiErrorCode === 'string' &&
      typeof error.message === 'string')
  );
}

export function toGovernedProviderApiErrorResponse(error: unknown) {
  if (!isGovernedProviderResolutionError(error)) {
    return null;
  }

  return apiError(error.apiErrorCode, error.status, error.message);
}

function makeScopeKey(family: AIProviderFamily, providerId: string) {
  return `${family}:${providerId}`;
}

function getPolicyForScope(
  organizationId: string | null,
  record: Awaited<ReturnType<typeof findOrganizationAIPolicy>>,
): AIPolicySettings {
  if (!organizationId || !record) {
    return DEFAULT_POLICY;
  }

  return {
    allowPersonalOverrides: record.allowPersonalOverrides,
    allowPersonalCustomBaseUrls: record.allowPersonalCustomBaseUrls,
  };
}

async function appendResolutionAuditLog(
  scope: ScopeData,
  input: {
    action: string;
    resourceType?: string | null;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await appendAuditLog({
      organizationId: scope.organizationId,
      userId: scope.userId,
      actorRole: scope.auth?.session.role ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: input.metadata,
    });
  } catch {
    // Best-effort audit logging should never break provider resolution.
  }
}

async function loadScopeData(
  auth: AuthContext | null,
  scope?: {
    organizationId?: string | null;
    userId?: string | null;
  },
): Promise<ScopeData> {
  const organizationId = scope?.organizationId ?? auth?.organization?.id ?? null;
  const userId = scope?.userId ?? auth?.user?.id ?? null;

  if (!organizationId) {
    return {
      auth,
      organizationId,
      userId,
      policy: DEFAULT_POLICY,
      organizationConfigs: new Map(),
      userOverrides: new Map(),
    };
  }

  const [policyRecord, organizationConfigs, userOverrides] = await Promise.all([
    findOrganizationAIPolicy(organizationId),
    listOrganizationProviderConfigs(organizationId),
    userId
      ? listUserProviderOverrides({
          organizationId,
          userId,
        })
      : Promise.resolve([]),
  ]);

  return {
    auth,
    organizationId,
    userId,
    policy: getPolicyForScope(organizationId, policyRecord),
    organizationConfigs: new Map(
      organizationConfigs.map((config) => [makeScopeKey(config.family, config.providerId), config]),
    ),
    userOverrides: new Map(
      userOverrides.map((override) => [
        makeScopeKey(override.family, override.providerId),
        override,
      ]),
    ),
  };
}

function getBuiltInCatalog(): Record<AIProviderFamily, Record<string, ProviderCatalogEntry>> {
  return {
    llm: Object.fromEntries(
      Object.values(PROVIDERS).map((provider) => [
        provider.id,
        {
          providerId: provider.id,
          displayName: provider.name,
          providerType: provider.type,
          defaultBaseUrl: provider.defaultBaseUrl,
          icon: provider.icon,
          requiresApiKey: provider.requiresApiKey,
          models: provider.models.map((model) => ({ id: model.id, name: model.name })),
        },
      ]),
    ),
    tts: Object.fromEntries(
      Object.values(TTS_PROVIDERS).map((provider) => [
        provider.id,
        {
          providerId: provider.id,
          displayName: provider.name,
          defaultBaseUrl: provider.defaultBaseUrl,
          icon: provider.icon,
          requiresApiKey: provider.requiresApiKey,
          models: provider.models.map((model) => ({ id: model.id, name: model.name })),
          clientOnly: provider.id === 'browser-native-tts',
          alwaysEnabled: provider.id === 'browser-native-tts',
        },
      ]),
    ),
    asr: Object.fromEntries(
      Object.values(ASR_PROVIDERS).map((provider) => [
        provider.id,
        {
          providerId: provider.id,
          displayName: provider.name,
          defaultBaseUrl: provider.defaultBaseUrl,
          icon: provider.icon,
          requiresApiKey: provider.requiresApiKey,
          models: provider.models.map((model) => ({ id: model.id, name: model.name })),
          clientOnly: provider.id === 'browser-native',
          alwaysEnabled: provider.id === 'browser-native',
        },
      ]),
    ),
    pdf: Object.fromEntries(
      Object.values(PDF_PROVIDERS).map((provider) => [
        provider.id,
        {
          providerId: provider.id,
          displayName: provider.name,
          defaultBaseUrl: provider.baseUrl,
          icon: provider.icon,
          requiresApiKey: provider.requiresApiKey,
          alwaysEnabled: provider.id === 'unpdf',
        },
      ]),
    ),
    image: Object.fromEntries(
      Object.values(IMAGE_PROVIDERS).map((provider) => [
        provider.id,
        {
          providerId: provider.id,
          displayName: provider.name,
          defaultBaseUrl: provider.defaultBaseUrl,
          icon: provider.icon,
          requiresApiKey: provider.requiresApiKey,
          models: provider.models.map((model) => ({ id: model.id, name: model.name })),
        },
      ]),
    ),
    video: Object.fromEntries(
      Object.values(VIDEO_PROVIDERS).map((provider) => [
        provider.id,
        {
          providerId: provider.id,
          displayName: provider.name,
          defaultBaseUrl: provider.defaultBaseUrl,
          icon: provider.icon,
          requiresApiKey: provider.requiresApiKey,
          models: provider.models.map((model) => ({ id: model.id, name: model.name })),
        },
      ]),
    ),
    webSearch: Object.fromEntries(
      Object.values(WEB_SEARCH_PROVIDERS).map((provider) => [
        provider.id,
        {
          providerId: provider.id,
          displayName: provider.name,
          defaultBaseUrl: provider.defaultBaseUrl,
          icon: provider.icon,
          requiresApiKey: provider.requiresApiKey,
        },
      ]),
    ),
  };
}

const BUILTIN_CATALOG = getBuiltInCatalog();

function entryFromDefinition(
  providerId: string,
  definition: AIProviderDefinition,
): ProviderCatalogEntry {
  return {
    providerId,
    displayName: definition.name,
    providerType: definition.providerType,
    defaultBaseUrl: definition.defaultBaseUrl,
    icon: definition.icon,
    requiresApiKey: definition.requiresApiKey ?? true,
    models: definition.models?.map((model) => ({ id: model.id, name: model.name })) ?? [],
    isCustom: true,
  };
}

function getCatalogEntry(
  family: AIProviderFamily,
  providerId: string,
  organizationConfig?: OrganizationProviderConfigRecord,
): ProviderCatalogEntry | null {
  const builtIn = BUILTIN_CATALOG[family][providerId];
  if (builtIn) {
    return builtIn;
  }

  if (family === 'llm' && organizationConfig?.providerDefinition) {
    return entryFromDefinition(providerId, organizationConfig.providerDefinition);
  }

  return null;
}

function getBootstrapCandidate(
  family: AIProviderFamily,
  entry: ProviderCatalogEntry,
): {
  apiKey?: string;
  baseUrl?: string;
  models?: string[];
  proxy?: string;
} | null {
  const configured = getBootstrapProviderConfig(family, entry.providerId);
  if (configured) {
    return configured;
  }

  if (entry.alwaysEnabled) {
    return {
      ...(entry.defaultBaseUrl ? { baseUrl: entry.defaultBaseUrl } : {}),
      ...(entry.models?.length ? { models: entry.models.map((model) => model.id) } : {}),
    };
  }

  return null;
}

function getAllowedModels(
  entry: ProviderCatalogEntry,
  organizationConfig?: OrganizationProviderConfigRecord,
  bootstrap?: { models?: string[] } | null,
) {
  if (organizationConfig?.allowedModels?.length) {
    return [...organizationConfig.allowedModels];
  }

  if (bootstrap?.models?.length) {
    return [...bootstrap.models];
  }

  return entry.models?.map((model) => model.id) ?? [];
}

function chooseModelId(input: {
  requestedModel?: string | null;
  preferredModel?: string | null;
  defaultModel?: string | null;
  allowedModels: string[];
}) {
  const { requestedModel, preferredModel, defaultModel, allowedModels } = input;

  if (allowedModels.length === 0) {
    return requestedModel || preferredModel || defaultModel || undefined;
  }

  if (requestedModel && allowedModels.includes(requestedModel)) {
    return requestedModel;
  }

  if (preferredModel && allowedModels.includes(preferredModel)) {
    return preferredModel;
  }

  if (defaultModel && allowedModels.includes(defaultModel)) {
    return defaultModel;
  }

  return allowedModels[0];
}

function getEffectiveOptionForScope(
  family: AIProviderFamily,
  providerId: string,
  scope: ScopeData,
): EffectiveAIOption | null {
  const scopeKey = makeScopeKey(family, providerId);
  const organizationConfig = scope.organizationConfigs.get(scopeKey);
  const userOverride = scope.userOverrides.get(scopeKey);
  const entry = getCatalogEntry(family, providerId, organizationConfig);

  if (!entry) {
    return null;
  }

  const bootstrap = getBootstrapCandidate(family, entry);
  const hasOrganizationScope = !!scope.organizationId;
  const canUsePersonalOverride =
    hasOrganizationScope &&
    !!scope.userId &&
    !!organizationConfig &&
    scope.policy.allowPersonalOverrides;
  const canUsePersonalBaseUrl = canUsePersonalOverride && scope.policy.allowPersonalCustomBaseUrls;

  const organizationDisabled = organizationConfig ? !organizationConfig.enabled : false;
  const personalDisabled = canUsePersonalOverride && userOverride ? !userOverride.enabled : false;

  const allowedModels = getAllowedModels(entry, organizationConfig, bootstrap);
  const defaultModel = chooseModelId({
    preferredModel: userOverride?.preferredModel,
    defaultModel: organizationConfig?.defaultModel,
    allowedModels,
  });

  const hasPersonalSecret = canUsePersonalOverride && !!userOverride?.encryptedSecret;
  const hasOrganizationSecret = !!organizationConfig?.encryptedSecret;
  const hasBootstrapSecret = !!bootstrap?.apiKey;
  const hasSecret = hasPersonalSecret || hasOrganizationSecret || hasBootstrapSecret;
  const legacyFallbackAllowed =
    !bootstrap && !entry.clientOnly && !entry.isCustom && !organizationConfig && !userOverride;

  const baseUrl =
    (canUsePersonalBaseUrl ? userOverride?.baseUrl : undefined) ||
    organizationConfig?.baseUrl ||
    bootstrap?.baseUrl ||
    (entry.alwaysEnabled ? entry.defaultBaseUrl : undefined);

  let source: AIProviderSource = 'none';
  if (personalDisabled) {
    source = 'personal';
  } else if (organizationDisabled) {
    source = 'organization';
  } else if (
    canUsePersonalOverride &&
    userOverride &&
    (hasPersonalSecret ||
      (canUsePersonalBaseUrl && !!userOverride.baseUrl) ||
      !!userOverride.preferredModel)
  ) {
    source = 'personal';
  } else if (organizationConfig) {
    source = 'organization';
  } else if (bootstrap || entry.alwaysEnabled) {
    source = 'bootstrap';
  }

  let enabled = source !== 'none' && !organizationDisabled && !personalDisabled;
  if (!entry.clientOnly && entry.requiresApiKey && !hasSecret) {
    enabled = false;
  }

  if (entry.clientOnly || entry.alwaysEnabled) {
    enabled = !organizationDisabled && !personalDisabled;
  }

  return {
    providerId,
    enabled,
    source,
    allowedModels,
    defaultModel: defaultModel ?? null,
    ...(baseUrl ? { baseUrl } : {}),
    hasSecret,
    ...(entry.isCustom ? { isCustom: true } : {}),
    ...(entry.providerType ? { providerType: entry.providerType } : {}),
    ...(entry.displayName ? { displayName: entry.displayName } : {}),
    ...(entry.icon ? { icon: entry.icon } : {}),
    requiresApiKey: entry.requiresApiKey,
    legacyFallbackAllowed,
    hasPersonalOverride: !!userOverride,
    hasOrganizationConfig: !!organizationConfig,
  };
}

export async function getEffectiveAIOptions(
  auth: AuthContext | null,
): Promise<EffectiveAIOptionsResponse> {
  const scope = await loadScopeData(auth);
  const providers = {
    llm: {} as Record<string, EffectiveAIOption>,
    tts: {} as Record<string, EffectiveAIOption>,
    asr: {} as Record<string, EffectiveAIOption>,
    pdf: {} as Record<string, EffectiveAIOption>,
    image: {} as Record<string, EffectiveAIOption>,
    video: {} as Record<string, EffectiveAIOption>,
    webSearch: {} as Record<string, EffectiveAIOption>,
  };

  for (const family of Object.keys(BUILTIN_CATALOG) as AIProviderFamily[]) {
    const providerIds = new Set<string>(Object.keys(BUILTIN_CATALOG[family]));

    for (const key of scope.organizationConfigs.keys()) {
      if (key.startsWith(`${family}:`)) {
        providerIds.add(key.slice(family.length + 1));
      }
    }

    for (const providerId of providerIds) {
      const option = getEffectiveOptionForScope(family, providerId, scope);
      if (option) {
        providers[family][providerId] = option;
      }
    }
  }

  return {
    policy: scope.policy,
    providers,
  };
}

async function resolveProviderCredentials(input: {
  auth: AuthContext | null;
  organizationId?: string | null;
  userId?: string | null;
  family: AIProviderFamily;
  providerId: string;
  requestedSecret?: string | null;
  requestedBaseUrl?: string | null;
  requestedModel?: string | null;
  requestedProviderType?: ProviderType;
  mode?: ResolutionMode;
}): Promise<ResolvedProviderCredentials> {
  const mode = input.mode ?? 'interactive';
  const scope = await loadScopeData(input.auth, {
    organizationId: input.organizationId,
    userId: input.userId,
  });
  const hasOrganizationScope = !!scope.organizationId;
  const scopeKey = makeScopeKey(input.family, input.providerId);
  const organizationConfig = scope.organizationConfigs.get(scopeKey);
  const userOverride = scope.userOverrides.get(scopeKey);
  const entry = getCatalogEntry(input.family, input.providerId, organizationConfig);

  if (!entry) {
    throw createGovernedProviderResolutionError(
      'PROVIDER_NOT_AVAILABLE',
      `Provider "${input.providerId}" is not available for ${input.family}.`,
    );
  }

  if (entry.clientOnly) {
    throw createGovernedProviderResolutionError(
      'CLIENT_ONLY_PROVIDER',
      `Provider "${input.providerId}" must run client-side.`,
    );
  }

  const bootstrap = getBootstrapCandidate(input.family, entry);
  const canUsePersonalOverride =
    mode === 'interactive' &&
    hasOrganizationScope &&
    !!scope.userId &&
    !!organizationConfig &&
    scope.policy.allowPersonalOverrides;
  const canUsePersonalBaseUrl = canUsePersonalOverride && scope.policy.allowPersonalCustomBaseUrls;
  const legacyBlocked = !!organizationConfig || !!userOverride || !!bootstrap;
  const legacyFallbackAllowed =
    mode === 'interactive' && !legacyBlocked && !entry.clientOnly && !entry.isCustom;

  if (
    hasOrganizationScope &&
    !organizationConfig &&
    !bootstrap &&
    !entry.alwaysEnabled &&
    entry.isCustom
  ) {
    await appendResolutionAuditLog(scope, {
      action: 'provider_resolution.denied',
      resourceType: 'organization_provider_config',
      metadata: {
        family: input.family,
        providerId: input.providerId,
        reason: 'provider_not_approved',
      },
    });
    throw createGovernedProviderResolutionError(
      'PROVIDER_NOT_APPROVED',
      `Provider "${input.providerId}" is not approved for this organization.`,
    );
  }

  if (organizationConfig && !organizationConfig.enabled) {
    await appendResolutionAuditLog(scope, {
      action: 'provider_resolution.denied',
      resourceType: 'organization_provider_config',
      resourceId: organizationConfig.id,
      metadata: {
        family: input.family,
        providerId: input.providerId,
        reason: 'provider_disabled',
      },
    });
    throw createGovernedProviderResolutionError(
      'PROVIDER_DISABLED',
      `Provider "${input.providerId}" is disabled by organization policy.`,
    );
  }

  if (canUsePersonalOverride && userOverride && !userOverride.enabled) {
    await appendResolutionAuditLog(scope, {
      action: 'provider_resolution.denied',
      resourceType: 'user_provider_override',
      resourceId: userOverride.id,
      metadata: {
        family: input.family,
        providerId: input.providerId,
        reason: 'personal_override_disabled',
      },
    });
    throw createGovernedProviderResolutionError(
      'PERSONAL_OVERRIDE_DISABLED',
      `Provider "${input.providerId}" is disabled by your personal override.`,
    );
  }

  let source: AIProviderSource = 'none';
  let apiKey = '';
  let baseUrl =
    organizationConfig?.baseUrl ||
    bootstrap?.baseUrl ||
    (entry.alwaysEnabled ? entry.defaultBaseUrl : undefined);
  let preferredModel = organizationConfig?.defaultModel ?? null;

  if (organizationConfig) {
    source = 'organization';
    if (organizationConfig.encryptedSecret) {
      apiKey = decryptSecret(organizationConfig.encryptedSecret);
    }
  } else if (bootstrap) {
    source = 'bootstrap';
    apiKey = bootstrap.apiKey || '';
    baseUrl = bootstrap.baseUrl || baseUrl;
  } else if (entry.alwaysEnabled) {
    source = 'bootstrap';
  }

  if (mode === 'interactive' && canUsePersonalOverride && userOverride) {
    if (userOverride.encryptedSecret) {
      apiKey = decryptSecret(userOverride.encryptedSecret);
      source = 'personal';
    }
    if (canUsePersonalBaseUrl && userOverride.baseUrl) {
      baseUrl = userOverride.baseUrl;
      source = 'personal';
    }
    if (userOverride.preferredModel) {
      preferredModel = userOverride.preferredModel;
      source = 'personal';
    }
  }

  if (
    mode === 'interactive' &&
    legacyFallbackAllowed &&
    !apiKey &&
    (input.requestedSecret || input.requestedBaseUrl)
  ) {
    source = 'legacy';
    apiKey = input.requestedSecret || '';
    baseUrl = input.requestedBaseUrl || baseUrl;
  }

  if (source === 'none') {
    throw createGovernedProviderResolutionError(
      'MISSING_PROVIDER_CONFIGURATION',
      `No configuration is available for provider "${input.providerId}".`,
    );
  }

  if (source === 'legacy') {
    await appendResolutionAuditLog(scope, {
      action: 'provider_resolution.legacy_fallback_used',
      resourceType: 'provider',
      metadata: {
        family: input.family,
        providerId: input.providerId,
        hasRequestedSecret: !!input.requestedSecret,
        hasRequestedBaseUrl: !!input.requestedBaseUrl,
      },
    });
  }

  if (entry.requiresApiKey && !apiKey) {
    throw createGovernedProviderResolutionError(
      'MISSING_PROVIDER_CREDENTIALS',
      `No API key configured for provider "${input.providerId}".`,
    );
  }

  const allowedModels = getAllowedModels(entry, organizationConfig, bootstrap);
  const defaultModel = chooseModelId({
    requestedModel: input.requestedModel,
    preferredModel,
    defaultModel: organizationConfig?.defaultModel ?? null,
    allowedModels,
  });

  return {
    providerId: input.providerId,
    source,
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...(allowedModels.length ? { allowedModels } : {}),
    ...(defaultModel ? { defaultModel } : {}),
    ...(organizationConfig?.providerDefinition?.providerType
      ? { providerType: organizationConfig.providerDefinition.providerType }
      : entry.providerType
        ? { providerType: entry.providerType }
        : input.requestedProviderType
          ? { providerType: input.requestedProviderType }
          : {}),
    ...(bootstrap?.proxy ? { proxy: bootstrap.proxy } : {}),
  };
}

export async function resolveLLMGovernedConfig(input: {
  auth: AuthContext | null;
  organizationId?: string | null;
  userId?: string | null;
  providerId: string;
  modelId: string;
  requestedSecret?: string | null;
  requestedBaseUrl?: string | null;
  requestedProviderType?: ProviderType;
  mode?: ResolutionMode;
}) {
  const resolved = await resolveProviderCredentials({
    auth: input.auth,
    organizationId: input.organizationId,
    userId: input.userId,
    family: 'llm',
    providerId: input.providerId,
    requestedSecret: input.requestedSecret,
    requestedBaseUrl: input.requestedBaseUrl,
    requestedModel: input.modelId,
    requestedProviderType: input.requestedProviderType,
    mode: input.mode,
  });

  return {
    ...resolved,
    modelId:
      chooseModelId({
        requestedModel: input.modelId,
        defaultModel: resolved.defaultModel,
        allowedModels: resolved.allowedModels ?? [],
      }) || input.modelId,
  };
}

export async function resolveGovernedProviderConfig(input: {
  auth: AuthContext | null;
  organizationId?: string | null;
  userId?: string | null;
  family: Exclude<AIProviderFamily, 'llm'>;
  providerId: string;
  requestedSecret?: string | null;
  requestedBaseUrl?: string | null;
  requestedModel?: string | null;
  mode?: ResolutionMode;
}) {
  const resolved = await resolveProviderCredentials({
    auth: input.auth,
    organizationId: input.organizationId,
    userId: input.userId,
    family: input.family,
    providerId: input.providerId,
    requestedSecret: input.requestedSecret,
    requestedBaseUrl: input.requestedBaseUrl,
    requestedModel: input.requestedModel,
    mode: input.mode,
  });

  return {
    ...resolved,
    ...(input.requestedModel || resolved.defaultModel
      ? {
          modelId:
            chooseModelId({
              requestedModel: input.requestedModel,
              defaultModel: resolved.defaultModel,
              allowedModels: resolved.allowedModels ?? [],
            }) || undefined,
        }
      : {}),
  };
}

export async function getAdminConfigSnapshot(auth: AuthContext) {
  const organizationId = auth.organization?.id;
  if (!organizationId) {
    return {
      policy: DEFAULT_POLICY,
      configs: [],
    };
  }

  const [policyRecord, configs] = await Promise.all([
    findOrganizationAIPolicy(organizationId),
    listOrganizationProviderConfigs(organizationId),
  ]);

  return {
    policy: getPolicyForScope(organizationId, policyRecord),
    configs: configs.map((config) => ({
      family: config.family,
      providerId: config.providerId,
      enabled: config.enabled,
      baseUrl: config.baseUrl,
      allowedModels: config.allowedModels,
      defaultModel: config.defaultModel,
      hasSecret: !!config.encryptedSecret,
      definition: config.providerDefinition,
      updatedAt: config.updatedAt,
    })),
  };
}

export async function getUserOverridesSnapshot(auth: AuthContext) {
  const organizationId = auth.organization?.id;
  if (!organizationId) {
    return {
      policy: DEFAULT_POLICY,
      overrides: [],
    };
  }

  const [policyRecord, overrides] = await Promise.all([
    findOrganizationAIPolicy(organizationId),
    listUserProviderOverrides({
      organizationId,
      userId: auth.user.id,
    }),
  ]);

  return {
    policy: getPolicyForScope(organizationId, policyRecord),
    overrides: overrides.map((override) => ({
      family: override.family,
      providerId: override.providerId,
      enabled: override.enabled,
      baseUrl: override.baseUrl,
      preferredModel: override.preferredModel,
      hasSecret: !!override.encryptedSecret,
      updatedAt: override.updatedAt,
    })),
  };
}

interface AdminConfigSnapshotInput {
  policy: AIPolicySettings;
  configs: AdminProviderConfigPayload[];
}

interface UserOverridesSnapshotInput {
  overrides: UserProviderOverridePayload[];
}

function appendAuditLogInStore(
  store: PlatformStore,
  input: {
    organizationId?: string | null;
    userId?: string | null;
    actorRole?: PlatformRole | null;
    action: string;
    resourceType?: string | null;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
  },
): AuditLogRecord {
  const createdAt = new Date().toISOString();
  const record: AuditLogRecord = {
    id: randomUUID(),
    organizationId: input.organizationId ?? null,
    userId: input.userId ?? null,
    actorRole: input.actorRole ?? null,
    action: input.action,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    metadata: input.metadata ?? {},
    createdAt,
  };
  store.auditLogs.push(record);
  return record;
}

function upsertOrganizationAIPolicyInStore(
  store: PlatformStore,
  input: {
    organizationId: string;
    allowPersonalOverrides: boolean;
    allowPersonalCustomBaseUrls: boolean;
  },
): OrganizationAIPolicyRecord {
  const now = new Date().toISOString();
  const existing = store.organizationAiPolicies.find(
    (policy) => policy.organizationId === input.organizationId,
  );

  if (existing) {
    existing.allowPersonalOverrides = input.allowPersonalOverrides;
    existing.allowPersonalCustomBaseUrls = input.allowPersonalCustomBaseUrls;
    existing.updatedAt = now;
    return existing;
  }

  const created: OrganizationAIPolicyRecord = {
    id: randomUUID(),
    organizationId: input.organizationId,
    allowPersonalOverrides: input.allowPersonalOverrides,
    allowPersonalCustomBaseUrls: input.allowPersonalCustomBaseUrls,
    createdAt: now,
    updatedAt: now,
  };
  store.organizationAiPolicies.push(created);
  return created;
}

function upsertOrganizationProviderConfigInStore(
  store: PlatformStore,
  input: {
    organizationId: string;
    family: AIProviderFamily;
    providerId: string;
    providerDefinition?: AIProviderDefinition | null;
    encryptedSecret?: string | null;
    baseUrl?: string | null;
    allowedModels?: string[];
    defaultModel?: string | null;
    enabled: boolean;
  },
): OrganizationProviderConfigRecord {
  const now = new Date().toISOString();
  const existing = store.organizationProviderConfigs.find(
    (config) =>
      config.organizationId === input.organizationId &&
      config.family === input.family &&
      config.providerId === input.providerId,
  );

  if (existing) {
    existing.providerDefinition = input.providerDefinition ?? null;
    existing.encryptedSecret = input.encryptedSecret ?? null;
    existing.baseUrl = input.baseUrl ?? null;
    existing.allowedModels = [...(input.allowedModels ?? [])];
    existing.defaultModel = input.defaultModel ?? null;
    existing.enabled = input.enabled;
    existing.updatedAt = now;
    return existing;
  }

  const created: OrganizationProviderConfigRecord = {
    id: randomUUID(),
    organizationId: input.organizationId,
    family: input.family,
    providerId: input.providerId,
    providerDefinition: input.providerDefinition ?? null,
    encryptedSecret: input.encryptedSecret ?? null,
    baseUrl: input.baseUrl ?? null,
    allowedModels: [...(input.allowedModels ?? [])],
    defaultModel: input.defaultModel ?? null,
    enabled: input.enabled,
    createdAt: now,
    updatedAt: now,
  };
  store.organizationProviderConfigs.push(created);
  return created;
}

function upsertUserProviderOverrideInStore(
  store: PlatformStore,
  input: {
    organizationId: string;
    userId: string;
    family: AIProviderFamily;
    providerId: string;
    encryptedSecret?: string | null;
    baseUrl?: string | null;
    preferredModel?: string | null;
    enabled: boolean;
  },
): UserProviderOverrideRecord {
  const now = new Date().toISOString();
  const existing = store.userProviderOverrides.find(
    (override) =>
      override.organizationId === input.organizationId &&
      override.userId === input.userId &&
      override.family === input.family &&
      override.providerId === input.providerId,
  );

  if (existing) {
    existing.encryptedSecret = input.encryptedSecret ?? null;
    existing.baseUrl = input.baseUrl ?? null;
    existing.preferredModel = input.preferredModel ?? null;
    existing.enabled = input.enabled;
    existing.updatedAt = now;
    return existing;
  }

  const created: UserProviderOverrideRecord = {
    id: randomUUID(),
    organizationId: input.organizationId,
    userId: input.userId,
    family: input.family,
    providerId: input.providerId,
    encryptedSecret: input.encryptedSecret ?? null,
    baseUrl: input.baseUrl ?? null,
    preferredModel: input.preferredModel ?? null,
    enabled: input.enabled,
    createdAt: now,
    updatedAt: now,
  };
  store.userProviderOverrides.push(created);
  return created;
}

async function saveAdminConfigSnapshotInPostgres(
  auth: AuthContext,
  payload: AdminConfigSnapshotInput,
  executor: PostgresExecutor,
) {
  const organizationId = auth.organization?.id;
  if (!organizationId) {
    throw new Error('Active organization is required');
  }

  const policy = await upsertOrganizationAIPolicy(
    {
      organizationId,
      allowPersonalOverrides: payload.policy.allowPersonalOverrides,
      allowPersonalCustomBaseUrls: payload.policy.allowPersonalCustomBaseUrls,
    },
    executor,
  );

  await appendAuditLog(
    {
      organizationId,
      userId: auth.user.id,
      actorRole: auth.session.role,
      action: 'organization_ai_policy.updated',
      resourceType: 'organization_ai_policy',
      resourceId: policy.id,
      metadata: {
        allowPersonalOverrides: policy.allowPersonalOverrides,
        allowPersonalCustomBaseUrls: policy.allowPersonalCustomBaseUrls,
      },
    },
    executor,
  );

  for (const config of payload.configs) {
    const existing = await findOrganizationProviderConfig(
      {
        organizationId,
        family: config.family,
        providerId: config.providerId,
      },
      executor,
    );

    const encryptedSecret = config.clearSecret
      ? null
      : typeof config.secret === 'string'
        ? encryptSecret(config.secret)
        : (existing?.encryptedSecret ?? null);

    const saved = await upsertOrganizationProviderConfig(
      {
        organizationId,
        family: config.family,
        providerId: config.providerId,
        providerDefinition: config.definition ?? existing?.providerDefinition ?? null,
        encryptedSecret,
        baseUrl: config.baseUrl ?? null,
        allowedModels: config.allowedModels ?? [],
        defaultModel: config.defaultModel ?? null,
        enabled: config.enabled,
      },
      executor,
    );

    await appendAuditLog(
      {
        organizationId,
        userId: auth.user.id,
        actorRole: auth.session.role,
        action: 'organization_provider_config.updated',
        resourceType: 'organization_provider_config',
        resourceId: saved.id,
        metadata: {
          family: saved.family,
          providerId: saved.providerId,
          enabled: saved.enabled,
          hasSecret: !!saved.encryptedSecret,
          hasDefinition: !!saved.providerDefinition,
          allowedModels: saved.allowedModels,
          defaultModel: saved.defaultModel,
        },
      },
      executor,
    );
  }
}

async function saveAdminConfigSnapshotInJsonStore(
  auth: AuthContext,
  payload: AdminConfigSnapshotInput,
) {
  const organizationId = auth.organization?.id;
  if (!organizationId) {
    throw new Error('Active organization is required');
  }

  await updatePlatformStore((store) => {
    const policy = upsertOrganizationAIPolicyInStore(store, {
      organizationId,
      allowPersonalOverrides: payload.policy.allowPersonalOverrides,
      allowPersonalCustomBaseUrls: payload.policy.allowPersonalCustomBaseUrls,
    });

    appendAuditLogInStore(store, {
      organizationId,
      userId: auth.user.id,
      actorRole: auth.session.role,
      action: 'organization_ai_policy.updated',
      resourceType: 'organization_ai_policy',
      resourceId: policy.id,
      metadata: {
        allowPersonalOverrides: policy.allowPersonalOverrides,
        allowPersonalCustomBaseUrls: policy.allowPersonalCustomBaseUrls,
      },
    });

    for (const config of payload.configs) {
      const existing = store.organizationProviderConfigs.find(
        (record) =>
          record.organizationId === organizationId &&
          record.family === config.family &&
          record.providerId === config.providerId,
      );

      const encryptedSecret = config.clearSecret
        ? null
        : typeof config.secret === 'string'
          ? encryptSecret(config.secret)
          : (existing?.encryptedSecret ?? null);

      const saved = upsertOrganizationProviderConfigInStore(store, {
        organizationId,
        family: config.family,
        providerId: config.providerId,
        providerDefinition: config.definition ?? existing?.providerDefinition ?? null,
        encryptedSecret,
        baseUrl: config.baseUrl ?? null,
        allowedModels: config.allowedModels ?? [],
        defaultModel: config.defaultModel ?? null,
        enabled: config.enabled,
      });

      appendAuditLogInStore(store, {
        organizationId,
        userId: auth.user.id,
        actorRole: auth.session.role,
        action: 'organization_provider_config.updated',
        resourceType: 'organization_provider_config',
        resourceId: saved.id,
        metadata: {
          family: saved.family,
          providerId: saved.providerId,
          enabled: saved.enabled,
          hasSecret: !!saved.encryptedSecret,
          hasDefinition: !!saved.providerDefinition,
          allowedModels: saved.allowedModels,
          defaultModel: saved.defaultModel,
        },
      });
    }
  });
}

export async function saveAdminConfigSnapshot(
  auth: AuthContext,
  payload: AdminConfigSnapshotInput,
) {
  const committed = await runPostgresTransaction(async (executor) => {
    await saveAdminConfigSnapshotInPostgres(auth, payload, executor);
    return true;
  });

  if (committed === null) {
    await saveAdminConfigSnapshotInJsonStore(auth, payload);
  }

  return getAdminConfigSnapshot(auth);
}

async function saveUserOverridesSnapshotInPostgres(
  auth: AuthContext,
  payload: UserOverridesSnapshotInput,
  executor: PostgresExecutor,
) {
  const organizationId = auth.organization?.id;
  if (!organizationId) {
    throw new Error('Active organization is required');
  }

  for (const override of payload.overrides) {
    const existing = await findUserProviderOverride(
      {
        organizationId,
        userId: auth.user.id,
        family: override.family,
        providerId: override.providerId,
      },
      executor,
    );

    const encryptedSecret = override.clearSecret
      ? null
      : typeof override.secret === 'string'
        ? encryptSecret(override.secret)
        : (existing?.encryptedSecret ?? null);

    const saved = await upsertUserProviderOverride(
      {
        organizationId,
        userId: auth.user.id,
        family: override.family,
        providerId: override.providerId,
        encryptedSecret,
        baseUrl: override.baseUrl ?? null,
        preferredModel: override.preferredModel ?? null,
        enabled: override.enabled,
      },
      executor,
    );

    await appendAuditLog(
      {
        organizationId,
        userId: auth.user.id,
        actorRole: auth.session.role,
        action: 'user_provider_override.updated',
        resourceType: 'user_provider_override',
        resourceId: saved.id,
        metadata: {
          family: saved.family,
          providerId: saved.providerId,
          enabled: saved.enabled,
          hasSecret: !!saved.encryptedSecret,
          preferredModel: saved.preferredModel,
          hasBaseUrl: !!saved.baseUrl,
        },
      },
      executor,
    );
  }
}

async function saveUserOverridesSnapshotInJsonStore(
  auth: AuthContext,
  payload: UserOverridesSnapshotInput,
) {
  const organizationId = auth.organization?.id;
  if (!organizationId) {
    throw new Error('Active organization is required');
  }

  await updatePlatformStore((store) => {
    for (const override of payload.overrides) {
      const existing = store.userProviderOverrides.find(
        (record) =>
          record.organizationId === organizationId &&
          record.userId === auth.user.id &&
          record.family === override.family &&
          record.providerId === override.providerId,
      );

      const encryptedSecret = override.clearSecret
        ? null
        : typeof override.secret === 'string'
          ? encryptSecret(override.secret)
          : (existing?.encryptedSecret ?? null);

      const saved = upsertUserProviderOverrideInStore(store, {
        organizationId,
        userId: auth.user.id,
        family: override.family,
        providerId: override.providerId,
        encryptedSecret,
        baseUrl: override.baseUrl ?? null,
        preferredModel: override.preferredModel ?? null,
        enabled: override.enabled,
      });

      appendAuditLogInStore(store, {
        organizationId,
        userId: auth.user.id,
        actorRole: auth.session.role,
        action: 'user_provider_override.updated',
        resourceType: 'user_provider_override',
        resourceId: saved.id,
        metadata: {
          family: saved.family,
          providerId: saved.providerId,
          enabled: saved.enabled,
          hasSecret: !!saved.encryptedSecret,
          preferredModel: saved.preferredModel,
          hasBaseUrl: !!saved.baseUrl,
        },
      });
    }
  });
}

export async function saveUserOverridesSnapshot(
  auth: AuthContext,
  payload: UserOverridesSnapshotInput,
) {
  const committed = await runPostgresTransaction(async (executor) => {
    await saveUserOverridesSnapshotInPostgres(auth, payload, executor);
    return true;
  });

  if (committed === null) {
    await saveUserOverridesSnapshotInJsonStore(auth, payload);
  }

  return getUserOverridesSnapshot(auth);
}

export async function findApprovedOrganizationProvider(input: {
  organizationId: string;
  family: AIProviderFamily;
  providerId: string;
}) {
  return findOrganizationProviderConfig(input);
}

export async function findExistingUserOverride(input: {
  organizationId: string;
  userId: string;
  family: AIProviderFamily;
  providerId: string;
}) {
  return findUserProviderOverride(input);
}
