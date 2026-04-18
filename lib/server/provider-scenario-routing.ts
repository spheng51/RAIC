import 'server-only';

import { parseModelString } from '@/lib/ai/providers';
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

export type VerificationScenarioRouteId =
  | 'verify-model'
  | 'verify-image-provider'
  | 'verify-video-provider';

type ScenarioValidationStatus = 'selected' | 'fallback_selected' | 'failed_closed';

interface ScenarioAttemptRecord {
  providerId: string;
  modelId: string | null;
  status: 'selected' | 'rejected';
  reason?: string;
}

interface ScenarioAuditMetadata extends Record<string, unknown> {
  scenarioProfileId: string;
  taskBucket: ProviderScenarioTaskBucket;
  routeId: VerificationScenarioRouteId;
  selectedProviderId: string | null;
  selectedModelId: string | null;
  fallbackProviderId: string | null;
  fallbackModelId: string | null;
  fallbackReason: string | null;
  validationStatus: ScenarioValidationStatus;
  attemptedCandidates: ScenarioAttemptRecord[];
  requestedProviderId: string;
  requestedModelId: string | null;
}

interface ManagedScenarioCandidates {
  managed: boolean;
  candidates: ProviderScenarioCandidate[];
}

interface ScenarioProviderSelection {
  providerId: string;
  modelId?: string;
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

interface ResolveVerificationProviderScenarioInput {
  auth: AuthContext | null;
  routeId: VerificationScenarioRouteId;
  taskBucket: ProviderScenarioTaskBucket;
  family: 'image' | 'video';
  providerId: ImageProviderId | VideoProviderId;
  modelId?: string;
  requestedSecret?: string;
  requestedBaseUrl?: string;
}

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
    // Best-effort scenario telemetry must not block verification.
  }
}

function getManagedScenarioCandidates(
  candidates: ProviderScenarioCandidate[],
  preferredProviderId: string,
  preferredModelId?: string,
): ManagedScenarioCandidates {
  const providerMatches = candidates.filter(
    (candidate) => candidate.providerId === preferredProviderId,
  );
  if (providerMatches.length === 0) {
    return { managed: false, candidates: [] };
  }

  if (!preferredModelId) {
    return {
      managed: true,
      candidates: providerMatches,
    };
  }

  const exactModelMatches = providerMatches.filter((candidate) => {
    const candidateModelId = candidate.modelId?.trim();
    return !candidateModelId || candidateModelId === preferredModelId;
  });

  if (exactModelMatches.length === 0) {
    return { managed: false, candidates: [] };
  }

  return {
    managed: true,
    candidates: exactModelMatches,
  };
}

function resolveCandidateModelId(
  candidate: ProviderScenarioCandidate,
  preferredModelId?: string,
): string | null {
  return candidate.modelId?.trim() || preferredModelId?.trim() || null;
}

function createAuditMetadata(input: {
  profileId: string;
  taskBucket: ProviderScenarioTaskBucket;
  routeId: VerificationScenarioRouteId;
  selectedProviderId: string | null;
  selectedModelId: string | null;
  fallbackProviderId: string | null;
  fallbackModelId: string | null;
  validationStatus: ScenarioValidationStatus;
  attempts: ScenarioAttemptRecord[];
  requestedProviderId: string;
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

function getSceneCapabilityValidationError(
  result: ResolvedModel,
  expectedModelString: string,
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

  if (!result.modelInfo.capabilities?.tools) {
    return `resolved model "${expectedModelString}" lacks tool capability`;
  }

  return null;
}

async function tryResolveScenarioModelCandidate(input: {
  auth: AuthContext | null;
  candidate: ProviderScenarioCandidate;
  preferredModelId?: string;
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
  const modelId = resolveCandidateModelId(input.candidate, input.preferredModelId);
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
    const validationError = getSceneCapabilityValidationError(resolved, modelString);
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

async function tryResolveScenarioProviderCandidate(input: {
  auth: AuthContext | null;
  family: 'image' | 'video';
  candidate: ProviderScenarioCandidate;
  preferredModelId?: string;
  requestedSecret?: string;
  requestedBaseUrl?: string;
}): Promise<
  | {
      ok: true;
      result: Awaited<ReturnType<typeof resolveGovernedProviderConfig>>;
      modelId: string;
    }
  | {
      ok: false;
      reason: string;
      error?: unknown;
      modelId: string | null;
    }
> {
  const provider =
    input.family === 'image'
      ? IMAGE_PROVIDERS[input.candidate.providerId as ImageProviderId]
      : VIDEO_PROVIDERS[input.candidate.providerId as VideoProviderId];
  if (!provider) {
    return {
      ok: false,
      reason: `provider "${input.candidate.providerId}" is not registered for ${input.family}`,
      modelId: null,
    };
  }

  const modelId = resolveCandidateModelId(input.candidate, input.preferredModelId);
  if (!modelId) {
    return {
      ok: false,
      reason: `scenario candidate "${input.candidate.providerId}" is missing a concrete model`,
      modelId: null,
    };
  }

  if (!provider.models.some((model) => model.id === modelId)) {
    return {
      ok: false,
      reason: `model "${modelId}" is not registered for provider "${input.candidate.providerId}"`,
      modelId,
    };
  }

  try {
    const resolved = await resolveGovernedProviderConfig({
      auth: input.auth,
      family: input.family,
      providerId: input.candidate.providerId,
      requestedSecret: input.requestedSecret,
      requestedBaseUrl: input.requestedBaseUrl,
      requestedModel: modelId,
    });

    if (!resolved.apiKey) {
      return {
        ok: false,
        reason: `provider "${input.candidate.providerId}" resolved without an API key`,
        modelId,
      };
    }

    if ((resolved.modelId ?? null) !== modelId) {
      return {
        ok: false,
        reason: `governance resolved model "${resolved.modelId ?? 'none'}" instead of "${modelId}"`,
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

export async function resolveVerificationModelScenario(
  input: ResolveVerificationModelScenarioInput,
): Promise<ResolvedModel | null> {
  const profile = getProviderScenarioProfile();
  if (!profile?.buckets[input.taskBucket]?.length) {
    return null;
  }

  const requested = parseModelString(input.requestedModelString);
  const managed = getManagedScenarioCandidates(
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
      candidate,
      preferredModelId: requested.modelId,
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

export async function resolveVerificationProviderScenario(
  input: ResolveVerificationProviderScenarioInput,
): Promise<ScenarioProviderSelection | null> {
  const profile = getProviderScenarioProfile();
  if (!profile?.buckets[input.taskBucket]?.length) {
    return null;
  }

  const managed = getManagedScenarioCandidates(
    profile.buckets[input.taskBucket] ?? [],
    input.providerId,
    input.modelId,
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
      family: input.family,
      candidate,
      preferredModelId: input.modelId,
      requestedSecret: input.requestedSecret,
      requestedBaseUrl: input.requestedBaseUrl,
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
        requestedProviderId: input.providerId,
        requestedModelId: input.modelId ?? null,
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
    requestedProviderId: input.providerId,
    requestedModelId: input.modelId ?? null,
  });
  await appendScenarioAuditLog(input.auth, 'provider_scenario.route_denied', failureMetadata);

  if (lastError && isGovernedProviderResolutionError(lastError)) {
    throw lastError;
  }

  throw createScenarioResolutionError(
    `No validated ${input.taskBucket} scenario candidate is available for route "${input.routeId}".`,
  );
}
