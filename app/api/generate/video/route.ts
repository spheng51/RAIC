/**
 * Video Generation API
 *
 * Generates a video from a text prompt using the specified provider.
 * Uses async task pattern (submit → poll) so maxDuration is set to 5 minutes.
 *
 * POST /api/generate/video
 *
 * Headers:
 *   x-video-provider: VideoProviderId (default: 'seedance')
 *   x-video-model: string (optional model override)
 *   x-api-key: string (optional, server fallback)
 *   x-base-url: string (optional, server fallback)
 *
 * Body: { prompt, duration?, aspectRatio?, resolution? }
 * Response: { success: boolean, result?: VideoGenerationResult, error?: string }
 */

import { NextRequest } from 'next/server';
import { generateVideo, normalizeVideoOptions, VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import { getRequestAuth } from '@/lib/auth/current-user';
import type { VideoProviderId, VideoGenerationOptions } from '@/lib/media/types';
import { createLogger } from '@/lib/logger';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  withRequestWebSession,
} from '@/lib/server/api-response';
import {
  resolveGovernedProviderConfig,
  toGovernedProviderApiErrorResponse,
} from '@/lib/server/ai-governance';
import {
  resolveScenarioManagedProviderRoute,
  type ScenarioProviderCandidateValidationContext,
} from '@/lib/server/provider-scenario-routing';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';

const log = createLogger('VideoGeneration API');

export const maxDuration = 300;

function createVideoScenarioValidator(options: VideoGenerationOptions) {
  return async function validateVideoScenarioCandidate({
    provider,
    resolved,
  }: ScenarioProviderCandidateValidationContext): Promise<string | null> {
    const providerConfig = VIDEO_PROVIDERS[provider.providerId as VideoProviderId];
    if (!providerConfig) {
      return `provider "${provider.providerId}" is not registered for video generation`;
    }

    if (resolved.baseUrl) {
      const ssrfError = await validateUrlForSSRF(resolved.baseUrl);
      if (ssrfError) {
        return `provider "${provider.providerId}" resolved with an unsafe base URL: ${ssrfError}`;
      }
    }

    const normalizedOptions = normalizeVideoOptions(
      provider.providerId as VideoProviderId,
      options,
    );

    if (
      normalizedOptions.duration &&
      providerConfig.supportedDurations?.length &&
      !providerConfig.supportedDurations.includes(normalizedOptions.duration)
    ) {
      return `duration "${normalizedOptions.duration}" is not supported by provider "${provider.providerId}"`;
    }

    if (
      normalizedOptions.aspectRatio &&
      providerConfig.supportedAspectRatios?.length &&
      !providerConfig.supportedAspectRatios.includes(normalizedOptions.aspectRatio)
    ) {
      return `aspect ratio "${normalizedOptions.aspectRatio}" is not supported by provider "${provider.providerId}"`;
    }

    if (
      normalizedOptions.resolution &&
      providerConfig.supportedResolutions?.length &&
      !providerConfig.supportedResolutions.includes(normalizedOptions.resolution)
    ) {
      return `resolution "${normalizedOptions.resolution}" is not supported by provider "${provider.providerId}"`;
    }

    return null;
  };
}

export async function POST(request: NextRequest) {
  let resolvedProviderId: string | undefined;
  let resolvedModelId: string | undefined;
  try {
    const body = (await request.json()) as VideoGenerationOptions;

    if (!body.prompt) {
      return apiErrorWithRequestSession(request, 'MISSING_REQUIRED_FIELD', 400, 'Missing prompt');
    }

    const providerId = (request.headers.get('x-video-provider') || 'seedance') as VideoProviderId;
    const clientApiKey =
      request.headers.get('x-video-api-key') || request.headers.get('x-api-key') || undefined;
    const clientBaseUrl =
      request.headers.get('x-video-base-url') || request.headers.get('x-base-url') || undefined;
    const clientModel = request.headers.get('x-video-model') || undefined;
    resolvedProviderId = providerId;
    resolvedModelId = clientModel ?? undefined;

    if (clientBaseUrl && process.env.NODE_ENV === 'production') {
      const ssrfError = await validateUrlForSSRF(clientBaseUrl);
      if (ssrfError) {
        return apiErrorWithRequestSession(request, 'INVALID_URL', 403, ssrfError);
      }
    }

    const auth = await getRequestAuth(request);
    const resolved =
      (await resolveScenarioManagedProviderRoute({
        auth,
        routeId: 'generate-video',
        taskBucket: 'video',
        family: 'video',
        requestedProviderId: providerId,
        requestedModelId: clientModel,
        requestedSecret: clientApiKey,
        requestedBaseUrl: clientBaseUrl,
        validateResolvedCandidate: createVideoScenarioValidator(body),
      })) ||
      (await resolveGovernedProviderConfig({
        auth,
        family: 'video',
        providerId,
        requestedSecret: clientApiKey,
        requestedBaseUrl: clientBaseUrl,
        requestedModel: clientModel,
      }));
    resolvedProviderId = resolved.providerId;
    resolvedModelId = resolved.modelId || clientModel || undefined;

    // Normalize options against provider capabilities
    const options = normalizeVideoOptions(resolved.providerId as VideoProviderId, body);

    log.info(
      `Generating video: provider=${resolvedProviderId}, model=${resolvedModelId || 'default'}, ` +
        `prompt="${body.prompt.slice(0, 80)}...", duration=${options.duration ?? 'auto'}, ` +
        `aspect=${options.aspectRatio ?? 'auto'}, resolution=${options.resolution ?? 'auto'}`,
    );

    const result = await generateVideo(
      {
        providerId: resolved.providerId as VideoProviderId,
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        model: resolved.modelId || clientModel,
      },
      options,
    );

    log.info(
      `Video generated: url=${result.url ? 'yes' : 'no'}, ${result.width}x${result.height}, ${result.duration}s`,
    );

    return apiSuccessWithRequestSession(request, { result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const governanceError = toGovernedProviderApiErrorResponse(error);
    if (governanceError) {
      return withRequestWebSession(request, governanceError);
    }
    // Detect content safety filter rejections (e.g. Seedance SensitiveContent errors)
    if (message.includes('SensitiveContent') || message.includes('sensitive information')) {
      log.warn(`Video blocked by content safety filter: ${message}`);
      return apiErrorWithRequestSession(request, 'CONTENT_SENSITIVE', 400, message);
    }
    log.error(
      `Video generation failed [provider=${resolvedProviderId ?? 'seedance'}, model=${resolvedModelId ?? 'default'}]:`,
      error,
    );
    return apiErrorWithRequestSession(request, 'INTERNAL_ERROR', 500, message);
  }
}
