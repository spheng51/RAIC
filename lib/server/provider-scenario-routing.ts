import 'server-only';

import { parseModelString } from '@/lib/ai/providers';
import { ASR_PROVIDERS, TTS_PROVIDERS } from '@/lib/audio/constants';
import type { TTSVoiceInfo } from '@/lib/audio/types';
import type { AuthContext } from '@/lib/auth/current-user';
import { appendAuditLog } from '@/lib/db/repositories/audit-logs';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import type { ImageProviderId, VideoProviderId } from '@/lib/media/types';
import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import {
  GovernedProviderResolutionError,
  isGovernedProviderResolutionError,
  resolveGovernedProviderConfig,
} from '@/lib/server/ai-governance';
import { getProviderScenarioProfile } from '@/lib/server/provider-scenarios';
import { resolveModel, type ResolvedModel } from '@/lib/server/resolve-model';
import type {
  ProviderScenarioCandidate,
  ProviderScenarioTaskBucket,
} from '@/lib/types/classroom-intelligence';
import type { ProviderType } from '@/lib/types/provider';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search/constants';

export type VerificationScenarioRouteId =
  | 'verify-model'
  | 'verify-image-provider'
  | 'verify-video-provider';

export type ScenarioRouteId =
  | VerificationScenarioRouteId
  | 'web-search'
  | 'transcription'
  | 'generate-tts'
  | 'generate-image'
  | 'generate-video'
  | 'scene-outlines-stream'
  | 'scene-content'
  | 'scene-actions';

type ScenarioManagedFamily = 'asr' | 'image' | 'tts' | 'video' | 'webSearch';
type ScenarioSelectionMode = 'authoritative' | 'requested_provider';
type ScenarioValidationStatus = 'selected' | 'fallback_selected' | 'failed_closed';
type SceneGenerationScenarioRouteId = Extract<
  ScenarioRouteId,
  'scene-outlines-stream' | 'scene-content' | 'scene-actions'
>;

interface ScenarioAttemptRecord {
  providerId: string;
  modelId: string | null;
  status: 'selected' | 'rejected';
  reason?: string;
}

interface ScenarioAuditMetadata extends Record<string, unknown> {
  scenarioProfileId: string;
  taskBucket: ProviderScenarioTaskBucket;
  routeId: ScenarioRouteId;
  selectedProviderId: string | null;
  selectedModelId: string | null;
  fallbackProviderId: string | null;
  fallbackModelId: string | null;
  fallbackReason: string | null;
  validationStatus: ScenarioValidationStatus;
  attemptedCandidates: ScenarioAttemptRecord[];
  requestedProviderId: string | null;
  requestedModelId: string | null;
}

interface ManagedScenarioCandidates {
  managed: boolean;
  candidates: ProviderScenarioCandidate[];
}

interface ScenarioProviderRegistryEntry {
  providerId: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  clientOnly?: boolean;
  models?: Array<{ id: string; name: string }>;
  voices?: TTSVoiceInfo[];
}

interface ScenarioProviderSelection {
  providerId: string;
  modelId: string | null;
  apiKey: string;
  baseUrl?: string;
  scenarioProfileId: string;
}

interface ResolveVerificationModelScenarioInput {
  auth: AuthContext | null;
  routeId: VerificationScenarioRouteId;
  taskBucket: ProviderScenarioTaskBucket;
  requestedModelString: string;
  apiKey?: string;
  baseUrl?: string;
  providerType?: ProviderType;
}

interface ResolveSceneGenerationScenarioInput {
  auth: AuthContext | null;
  routeId: SceneGenerationScenarioRouteId;
  requestedModelString?: string;
  apiKey?: string;
  baseUrl?: string;
  providerType?: ProviderType;
}

interface ResolveScenarioManagedProviderRouteInput {
  auth: AuthContext | null;
  routeId: ScenarioRouteId;
  taskBucket: ProviderScenarioTaskBucket;
  family: ScenarioManagedFamily;
  requestedProviderId?: string | null;
  requestedModelId?: string | null;
  requestedSecret?: string;
  requestedBaseUrl?: string;
  selectionMode?: ScenarioSelectionMode;
  validateResolvedCandidate?: ScenarioProviderRouteValidator;
}

interface ResolveScenarioProviderCandidateInput {
  auth: AuthContext | null;
  routeId: ScenarioRouteId;
  taskBucket: ProviderScenarioTaskBucket;
  family: ScenarioManagedFamily;
  candidate: ProviderScenarioCandidate;
  requestedSecret?: string;
  requestedBaseUrl?: string;
  validateResolvedCandidate?: ScenarioProviderRouteValidator;
  requestedProviderId: string | null;
  requestedModelId: string | null;
}

export interface ScenarioProviderCandidateValidationContext {
  routeId: ScenarioRouteId;
  taskBucket: ProviderScenarioTaskBucket;
  family: ScenarioManagedFamily;
  candidate: ProviderScenarioCandidate;
  provider: ScenarioProviderRegistryEntry;
  resolved: Awaited<ReturnType<typeof resolveGovernedProviderConfig>>;
  selectedModelId: string | null;
  requestedProviderId: string | null;
  requestedModelId: string | null;
}

export type ScenarioProviderRouteValidator = (
  input: ScenarioProviderCandidateValidationContext,
) => string | null | Promise<string | null>;

function buildFallbackReason(attempts: ScenarioAttemptRecord[]): string | null {
  const rejectedAttempts = attempts.filter((attempt) => attempt.status === 'rejected');
  if (rejectedAttempts.length === 0) {
    return null;
  }

  return rejectedAttempts
    .map((attempt) => {
      const candidateLabel = attempt.modelId
        ? `${attempt.providerId}:${attempt.modelId}`
        : attempt.providerId;
      return `${candidateLabel}: ${attempt.reason ?? 'validation failed'}`;
    })
    .join('; ');
}

function createScenarioResolutionError(message: string): GovernedProviderResolutionError {
  return new GovernedProviderResolutionError('MISSING_PROVIDER_CONFIGURATION', message, {
    status: 400,
    apiErrorCode: 'INVALID_REQUEST',
  });
}

async function appendScenarioAuditLog(
  auth: AuthContext | null,
  action: 'provider_scenario.route_selected' | 'provider_scenario.route_denied',
  metadata: ScenarioAuditMetadata,
) {
  try {
    await appendAuditLog({
      organizationId: auth?.organization?.id ?? null,
      userId: auth?.user?.id ?? null,
      actorRole: auth?.session.role ?? null,
      action,
      resourceType: 'provider_scenario',
      resourceId: metadata.routeId,
      metadata,
    });
  } catch {
    // Best-effort scenario telemetry must not block request handling.
  }
}

function getRequestedScenarioCandidates(
  candidates: ProviderScenarioCandidate[],
  requestedProviderId?: string | null,
  requestedModelId?: string | null,
): ManagedScenarioCandidates {
  const normalizedProviderId = requestedProviderId?.trim();
  if (!normalizedProviderId) {
    return { managed: false, candidates: [] };
  }

  const providerMatches = candidates.filter(
    (candidate) => candidate.providerId === normalizedProviderId,
  );
  if (providerMatches.length === 0) {
    return { managed: false, candidates: [] };
  }

  const normalizedModelId = requestedModelId?.trim();
  if (!normalizedModelId) {
    return {
      managed: true,
      candidates: providerMatches,
    };
  }

  const exactModelMatches = providerMatches.filter((candidate) => {
    const candidateModelId = candidate.modelId?.trim();
    return !candidateModelId || candidateModelId === normalizedModelId;
  });

  if (exactModelMatches.length === 0) {
    return { managed: false, candidates: [] };
  }

  return {
    managed: true,
    candidates: exactModelMatches,
  };
}

function getScenarioCandidatesForRoute(
  candidates: ProviderScenarioCandidate[],
  selectionMode: ScenarioSelectionMode,
  requestedProviderId?: string | null,
  requestedModelId?: string | null,
): ManagedScenarioCandidates {
  if (selectionMode === 'authoritative') {
    return {
      managed: candidates.length > 0,
      candidates,
    };
  }

  return getRequestedScenarioCandidates(candidates, requestedProviderId, requestedModelId);
}

function resolveCandidateModelId(candidate: ProviderScenarioCandidate): string | null {
  return candidate.modelId?.trim() || null;
}

function createAuditMetadata(input: {
  profileId: string;
  taskBucket: ProviderScenarioTaskBucket;
  routeId: ScenarioRouteId;
  selectedProviderId: string | null;
  selectedModelId: string | null;
  fallbackProviderId: string | null;
  fallbackModelId: string | null;
  validationStatus: ScenarioValidationStatus;
  attempts: ScenarioAttemptRecord[];
  requestedProviderId: string | null;
  requestedModelId: string | null;
}): ScenarioAuditMetadata {
  return {
    scenarioProfileId: input.profileId,
    taskBucket: input.taskBucket,
    routeId: input.routeId,
    selectedProviderId: input.selectedProviderId,
    selectedModelId: input.selectedModelId,
    fallbackProviderId: input.fallbackProviderId,
    fallbackModelId: input.fallbackModelId,
    fallbackReason: buildFallbackReason(input.attempts),
    validationStatus: input.validationStatus,
    attemptedCandidates: input.attempts,
    requestedProviderId: input.requestedProviderId,
    requestedModelId: input.requestedModelId,
  };
}

function getProviderRegistryEntry(
  family: ScenarioManagedFamily,
  providerId: string,
): ScenarioProviderRegistryEntry | null {
  switch (family) {
    case 'asr': {
      const provider = ASR_PROVIDERS[providerId as keyof typeof ASR_PROVIDERS];
      if (!provider) {
        return null;
      }
      return {
        providerId: provider.id,
        requiresApiKey: provider.requiresApiKey,
        defaultBaseUrl: provider.defaultBaseUrl,
        clientOnly: provider.id === 'browser-native',
        models: provider.models,
      };
    }
    case 'tts': {
      const provider = TTS_PROVIDERS[providerId as keyof typeof TTS_PROVIDERS];
      if (!provider) {
        return null;
      }
      return {
        providerId: provider.id,
        requiresApiKey: provider.requiresApiKey,
        defaultBaseUrl: provider.defaultBaseUrl,
        clientOnly: provider.id === 'browser-native-tts',
        models: provider.models,
        voices: provider.voices,
      };
    }
    case 'image': {
      const provider = IMAGE_PROVIDERS[providerId as ImageProviderId];
      if (!provider) {
        return null;
      }
      return {
        providerId: provider.id,
        requiresApiKey: provider.requiresApiKey,
        defaultBaseUrl: provider.defaultBaseUrl,
        models: provider.models,
      };
    }
    case 'video': {
      const provider = VIDEO_PROVIDERS[providerId as VideoProviderId];
      if (!provider) {
        return null;
      }
      return {
        providerId: provider.id,
        requiresApiKey: provider.requiresApiKey,
        defaultBaseUrl: provider.defaultBaseUrl,
        models: provider.models,
      };
    }
    case 'webSearch': {
      const provider = WEB_SEARCH_PROVIDERS[providerId as keyof typeof WEB_SEARCH_PROVIDERS];
      if (!provider) {
        return null;
      }
      return {
        providerId: provider.id,
        requiresApiKey: provider.requiresApiKey,
        defaultBaseUrl: provider.defaultBaseUrl,
      };
    }
  }
}

function validateResolvedProviderCandidate(
  provider: ScenarioProviderRegistryEntry,
  candidateModelId: string | null,
  resolved: Awaited<ReturnType<typeof resolveGovernedProviderConfig>>,
): string | null {
  if (provider.clientOnly) {
    return `provider "${provider.providerId}" is client-only and cannot be used on the server`;
  }

  if (provider.requiresApiKey && !resolved.apiKey) {
    return `provider "${provider.providerId}" resolved without an API key`;
  }

  if (provider.models?.length) {
    const selectedModelId = resolved.modelId ?? candidateModelId;
    if (!selectedModelId) {
      return `provider "${provider.providerId}" resolved without a model`;
    }

    if (!provider.models.some((model) => model.id === selectedModelId)) {
      return `model "${selectedModelId}" is not registered for provider "${provider.providerId}"`;
    }
  } else if (candidateModelId) {
    return `provider "${provider.providerId}" does not support explicit model selection`;
  }

  return null;
}

function getSceneCapabilityValidationError(
  result: ResolvedModel,
  expectedModelString: string,
  routeId: ScenarioRouteId,
): string | null {
  if (result.modelString !== expectedModelString) {
    return `resolved model "${result.modelString}" does not match scenario candidate "${expectedModelString}"`;
  }

  if (!result.modelInfo) {
    return `resolved model "${expectedModelString}" is missing registry metadata`;
  }

  if (!result.modelInfo.capabilities?.streaming) {
    return `resolved model "${expectedModelString}" lacks streaming capability`;
  }

  if (!result.modelInfo.outputWindow || result.modelInfo.outputWindow <= 0) {
    return `resolved model "${expectedModelString}" is missing an output window`;
  }

  if (routeId === 'verify-model' && !result.modelInfo.capabilities?.tools) {
    return `resolved model "${expectedModelString}" lacks tool capability`;
  }

  return null;
}

async function tryResolveScenarioModelCandidate(input: {
  auth: AuthContext | null;
  routeId: ScenarioRouteId;
  candidate: ProviderScenarioCandidate;
  apiKey?: string;
  baseUrl?: string;
  providerType?: ProviderType;
}): Promise<
  | {
      ok: true;
      result: ResolvedModel;
      modelId: string;
    }
  | {
      ok: false;
      reason: string;
      error?: unknown;
      modelId: string | null;
    }
> {
  const modelId = resolveCandidateModelId(input.candidate);
  if (!modelId) {
    return {
      ok: false,
      reason: `scenario candidate "${input.candidate.providerId}" is missing a concrete model`,
      modelId: null,
    };
  }

  const modelString = `${input.candidate.providerId}:${modelId}`;

  try {
    const resolved = await resolveModel({
      modelString,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      providerType: input.providerType,
      auth: input.auth,
    });
    const validationError = getSceneCapabilityValidationError(resolved, modelString, input.routeId);
    if (validationError) {
      return {
        ok: false,
        reason: validationError,
        modelId,
      };
    }

    return {
      ok: true,
      result: resolved,
      modelId,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      error,
      modelId,
    };
  }
}

async function tryResolveScenarioProviderCandidate(
  input: ResolveScenarioProviderCandidateInput,
): Promise<
  | {
      ok: true;
      result: Awaited<ReturnType<typeof resolveGovernedProviderConfig>>;
      modelId: string | null;
      provider: ScenarioProviderRegistryEntry;
    }
  | {
      ok: false;
      reason: string;
      error?: unknown;
      modelId: string | null;
    }
> {
  const provider = getProviderRegistryEntry(input.family, input.candidate.providerId);
  if (!provider) {
    return {
      ok: false,
      reason: `provider "${input.candidate.providerId}" is not registered for ${input.family}`,
      modelId: null,
    };
  }

  const candidateModelId = resolveCandidateModelId(input.candidate);
  if (candidateModelId && provider.models?.length) {
    if (!provider.models.some((model) => model.id === candidateModelId)) {
      return {
        ok: false,
        reason: `model "${candidateModelId}" is not registered for provider "${input.candidate.providerId}"`,
        modelId: candidateModelId,
      };
    }
  }

  try {
    const resolved = await resolveGovernedProviderConfig({
      auth: input.auth,
      family: input.family,
      providerId: input.candidate.providerId,
      requestedSecret: input.requestedSecret,
      requestedBaseUrl: input.requestedBaseUrl,
      requestedModel: candidateModelId || undefined,
    });

    const selectedModelId = provider.models?.length
      ? (resolved.modelId ?? candidateModelId ?? null)
      : null;
    const baseValidationError = validateResolvedProviderCandidate(
      provider,
      candidateModelId,
      resolved,
    );
    if (baseValidationError) {
      return {
        ok: false,
        reason: baseValidationError,
        modelId: selectedModelId,
      };
    }

    if (input.validateResolvedCandidate) {
      const customValidationError = await input.validateResolvedCandidate({
        routeId: input.routeId,
        taskBucket: input.taskBucket,
        family: input.family,
        candidate: input.candidate,
        provider,
        resolved,
        selectedModelId,
        requestedProviderId: input.requestedProviderId,
        requestedModelId: input.requestedModelId,
      });
      if (customValidationError) {
        return {
          ok: false,
          reason: customValidationError,
          modelId: selectedModelId,
        };
      }
    }

    return {
      ok: true,
      result: resolved,
      modelId: selectedModelId,
      provider,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      error,
      modelId: candidateModelId,
    };
  }
}

export async function resolveVerificationModelScenario(
  input: ResolveVerificationModelScenarioInput,
): Promise<ResolvedModel | null> {
  const profile = getProviderScenarioProfile();
  if (!profile) {
    return null;
  }

  if (!profile.buckets[input.taskBucket]?.length) {
    return null;
  }

  const requested = parseModelString(input.requestedModelString);
  const managed = getRequestedScenarioCandidates(
    profile.buckets[input.taskBucket] ?? [],
    requested.providerId,
    requested.modelId,
  );
  if (!managed.managed) {
    return null;
  }

  const attempts: ScenarioAttemptRecord[] = [];
  let lastError: unknown = null;

  for (let index = 0; index < managed.candidates.length; index += 1) {
    const candidate = managed.candidates[index];
    const attempt = await tryResolveScenarioModelCandidate({
      auth: input.auth,
      routeId: input.routeId,
      candidate,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      providerType: input.providerType,
    });

    if (attempt.ok) {
      const metadata = createAuditMetadata({
        profileId: profile.id,
        taskBucket: input.taskBucket,
        routeId: input.routeId,
        selectedProviderId: candidate.providerId,
        selectedModelId: attempt.modelId,
        fallbackProviderId: index > 0 ? candidate.providerId : null,
        fallbackModelId: index > 0 ? attempt.modelId : null,
        validationStatus: index > 0 ? 'fallback_selected' : 'selected',
        attempts: [
          ...attempts,
          {
            providerId: candidate.providerId,
            modelId: attempt.modelId,
            status: 'selected',
          },
        ],
        requestedProviderId: requested.providerId,
        requestedModelId: requested.modelId,
      });
      await appendScenarioAuditLog(input.auth, 'provider_scenario.route_selected', metadata);
      return attempt.result;
    }

    attempts.push({
      providerId: candidate.providerId,
      modelId: attempt.modelId,
      status: 'rejected',
      reason: attempt.reason,
    });
    lastError = attempt.error ?? lastError;
  }

  const failureMetadata = createAuditMetadata({
    profileId: profile.id,
    taskBucket: input.taskBucket,
    routeId: input.routeId,
    selectedProviderId: null,
    selectedModelId: null,
    fallbackProviderId: null,
    fallbackModelId: null,
    validationStatus: 'failed_closed',
    attempts,
    requestedProviderId: requested.providerId,
    requestedModelId: requested.modelId,
  });
  await appendScenarioAuditLog(input.auth, 'provider_scenario.route_denied', failureMetadata);

  if (lastError && isGovernedProviderResolutionError(lastError)) {
    throw lastError;
  }

  throw createScenarioResolutionError(
    `No validated ${input.taskBucket} scenario candidate is available for route "${input.routeId}".`,
  );
}

export async function resolveSceneGenerationScenario(
  input: ResolveSceneGenerationScenarioInput,
): Promise<ResolvedModel | null> {
  const profile = getProviderScenarioProfile();
  if (!profile) {
    return null;
  }

  const candidates = profile.buckets.scene;
  if (!candidates?.length) {
    return null;
  }

  const requested = input.requestedModelString
    ? parseModelString(input.requestedModelString)
    : { providerId: null, modelId: null };
  const attempts: ScenarioAttemptRecord[] = [];
  let lastError: unknown = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const attempt = await tryResolveScenarioModelCandidate({
      auth: input.auth,
      routeId: input.routeId,
      candidate,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      providerType: input.providerType,
    });

    if (attempt.ok) {
      const metadata = createAuditMetadata({
        profileId: profile.id,
        taskBucket: 'scene',
        routeId: input.routeId,
        selectedProviderId: candidate.providerId,
        selectedModelId: attempt.modelId,
        fallbackProviderId: index > 0 ? candidate.providerId : null,
        fallbackModelId: index > 0 ? attempt.modelId : null,
        validationStatus: index > 0 ? 'fallback_selected' : 'selected',
        attempts: [
          ...attempts,
          {
            providerId: candidate.providerId,
            modelId: attempt.modelId,
            status: 'selected',
          },
        ],
        requestedProviderId: requested.providerId,
        requestedModelId: requested.modelId,
      });
      await appendScenarioAuditLog(input.auth, 'provider_scenario.route_selected', metadata);
      return attempt.result;
    }

    attempts.push({
      providerId: candidate.providerId,
      modelId: attempt.modelId,
      status: 'rejected',
      reason: attempt.reason,
    });
    lastError = attempt.error ?? lastError;
  }

  const failureMetadata = createAuditMetadata({
    profileId: profile.id,
    taskBucket: 'scene',
    routeId: input.routeId,
    selectedProviderId: null,
    selectedModelId: null,
    fallbackProviderId: null,
    fallbackModelId: null,
    validationStatus: 'failed_closed',
    attempts,
    requestedProviderId: requested.providerId,
    requestedModelId: requested.modelId,
  });
  await appendScenarioAuditLog(input.auth, 'provider_scenario.route_denied', failureMetadata);

  if (lastError && isGovernedProviderResolutionError(lastError)) {
    throw lastError;
  }

  throw createScenarioResolutionError(
    `No validated scene scenario candidate is available for route "${input.routeId}".`,
  );
}

export async function resolveScenarioManagedProviderRoute(
  input: ResolveScenarioManagedProviderRouteInput,
): Promise<ScenarioProviderSelection | null> {
  const profile = getProviderScenarioProfile();
  if (!profile) {
    return null;
  }

  const bucketCandidates = profile.buckets[input.taskBucket];
  if (!bucketCandidates?.length) {
    return null;
  }

  const requestedProviderId = input.requestedProviderId?.trim() || null;
  const requestedModelId = input.requestedModelId?.trim() || null;
  const managed = getScenarioCandidatesForRoute(
    bucketCandidates,
    input.selectionMode ?? 'authoritative',
    requestedProviderId,
    requestedModelId,
  );
  if (!managed.managed) {
    return null;
  }

  const attempts: ScenarioAttemptRecord[] = [];
  let lastError: unknown = null;

  for (let index = 0; index < managed.candidates.length; index += 1) {
    const candidate = managed.candidates[index];
    const attempt = await tryResolveScenarioProviderCandidate({
      auth: input.auth,
      routeId: input.routeId,
      taskBucket: input.taskBucket,
      family: input.family,
      candidate,
      requestedSecret: input.requestedSecret,
      requestedBaseUrl: input.requestedBaseUrl,
      validateResolvedCandidate: input.validateResolvedCandidate,
      requestedProviderId,
      requestedModelId,
    });

    if (attempt.ok) {
      const metadata = createAuditMetadata({
        profileId: profile.id,
        taskBucket: input.taskBucket,
        routeId: input.routeId,
        selectedProviderId: candidate.providerId,
        selectedModelId: attempt.modelId,
        fallbackProviderId: index > 0 ? candidate.providerId : null,
        fallbackModelId: index > 0 ? attempt.modelId : null,
        validationStatus: index > 0 ? 'fallback_selected' : 'selected',
        attempts: [
          ...attempts,
          {
            providerId: candidate.providerId,
            modelId: attempt.modelId,
            status: 'selected',
          },
        ],
        requestedProviderId,
        requestedModelId,
      });
      await appendScenarioAuditLog(input.auth, 'provider_scenario.route_selected', metadata);

      return {
        providerId: candidate.providerId,
        modelId: attempt.modelId,
        apiKey: attempt.result.apiKey,
        baseUrl: attempt.result.baseUrl,
        scenarioProfileId: profile.id,
      };
    }

    attempts.push({
      providerId: candidate.providerId,
      modelId: attempt.modelId,
      status: 'rejected',
      reason: attempt.reason,
    });
    lastError = attempt.error ?? lastError;
  }

  const failureMetadata = createAuditMetadata({
    profileId: profile.id,
    taskBucket: input.taskBucket,
    routeId: input.routeId,
    selectedProviderId: null,
    selectedModelId: null,
    fallbackProviderId: null,
    fallbackModelId: null,
    validationStatus: 'failed_closed',
    attempts,
    requestedProviderId,
    requestedModelId,
  });
  await appendScenarioAuditLog(input.auth, 'provider_scenario.route_denied', failureMetadata);

  if (lastError && isGovernedProviderResolutionError(lastError)) {
    throw lastError;
  }

  throw createScenarioResolutionError(
    `No validated ${input.taskBucket} scenario candidate is available for route "${input.routeId}".`,
  );
}

export async function resolveVerificationProviderScenario(input: {
  auth: AuthContext | null;
  routeId: Extract<ScenarioRouteId, 'verify-image-provider' | 'verify-video-provider'>;
  taskBucket: ProviderScenarioTaskBucket;
  family: Extract<ScenarioManagedFamily, 'image' | 'video'>;
  providerId: ImageProviderId | VideoProviderId;
  modelId?: string;
  requestedSecret?: string;
  requestedBaseUrl?: string;
}) {
  return resolveScenarioManagedProviderRoute({
    auth: input.auth,
    routeId: input.routeId,
    taskBucket: input.taskBucket,
    family: input.family,
    requestedProviderId: input.providerId,
    requestedModelId: input.modelId,
    requestedSecret: input.requestedSecret,
    requestedBaseUrl: input.requestedBaseUrl,
    selectionMode: 'requested_provider',
  });
}
