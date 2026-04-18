/**
 * Image Generation API
 *
 * Generates an image from a text prompt using the specified provider.
 * Called by the client during media generation after slides are produced.
 *
 * POST /api/generate/image
 *
 * Headers:
 *   x-image-provider: ImageProviderId (default: 'seedream')
 *   x-api-key: string (optional, server fallback)
 *   x-base-url: string (optional, server fallback)
 *
 * Body: { prompt, negativePrompt?, width?, height?, aspectRatio?, style? }
 * Response: { success: boolean, result?: ImageGenerationResult, error?: string }
 */

import { NextRequest } from 'next/server';
import {
  aspectRatioToDimensions,
  generateImage,
  IMAGE_PROVIDERS,
} from '@/lib/media/image-providers';
import { getRequestAuth } from '@/lib/auth/current-user';
import type { ImageProviderId, ImageGenerationOptions } from '@/lib/media/types';
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

const log = createLogger('ImageGeneration API');

export const maxDuration = 60;

function createImageScenarioValidator(options: ImageGenerationOptions) {
  return async function validateImageScenarioCandidate({
    provider,
    resolved,
  }: ScenarioProviderCandidateValidationContext): Promise<string | null> {
    const providerConfig = IMAGE_PROVIDERS[provider.providerId as ImageProviderId];
    if (!providerConfig) {
      return `provider "${provider.providerId}" is not registered for image generation`;
    }

    if (resolved.baseUrl) {
      const ssrfError = await validateUrlForSSRF(resolved.baseUrl);
      if (ssrfError) {
        return `provider "${provider.providerId}" resolved with an unsafe base URL: ${ssrfError}`;
      }
    }

    if (
      options.aspectRatio &&
      !providerConfig.supportedAspectRatios.includes(options.aspectRatio)
    ) {
      return `aspect ratio "${options.aspectRatio}" is not supported by provider "${provider.providerId}"`;
    }

    if (options.style && !providerConfig.supportedStyles?.includes(options.style)) {
      return `style "${options.style}" is not supported by provider "${provider.providerId}"`;
    }

    return null;
  };
}

export async function POST(request: NextRequest) {
  let resolvedProviderId: string | undefined;
  let resolvedModelId: string | undefined;
  try {
    const body = (await request.json()) as ImageGenerationOptions;

    if (!body.prompt) {
      return apiErrorWithRequestSession(request, 'MISSING_REQUIRED_FIELD', 400, 'Missing prompt');
    }

    const providerId = (request.headers.get('x-image-provider') || 'seedream') as ImageProviderId;
    const clientApiKey =
      request.headers.get('x-image-api-key') || request.headers.get('x-api-key') || undefined;
    const clientBaseUrl =
      request.headers.get('x-image-base-url') || request.headers.get('x-base-url') || undefined;
    const clientModel = request.headers.get('x-image-model') || undefined;
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
        routeId: 'generate-image',
        taskBucket: 'image',
        family: 'image',
        requestedProviderId: providerId,
        requestedModelId: clientModel,
        requestedSecret: clientApiKey,
        requestedBaseUrl: clientBaseUrl,
        validateResolvedCandidate: createImageScenarioValidator(body),
      })) ||
      (await resolveGovernedProviderConfig({
        auth,
        family: 'image',
        providerId,
        requestedSecret: clientApiKey,
        requestedBaseUrl: clientBaseUrl,
        requestedModel: clientModel,
      }));
    resolvedProviderId = resolved.providerId;
    resolvedModelId = resolved.modelId || clientModel || undefined;

    // Resolve dimensions from aspect ratio if not explicitly set
    if (!body.width && !body.height && body.aspectRatio) {
      const dims = aspectRatioToDimensions(body.aspectRatio);
      body.width = dims.width;
      body.height = dims.height;
    }

    log.info(
      `Generating image: provider=${resolvedProviderId}, model=${resolvedModelId || 'default'}, ` +
        `prompt="${body.prompt.slice(0, 80)}...", size=${body.width ?? 'auto'}x${body.height ?? 'auto'}`,
    );

    const result = await generateImage(
      {
        providerId: resolved.providerId as ImageProviderId,
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        model: resolved.modelId || clientModel,
      },
      body,
    );

    return apiSuccessWithRequestSession(request, { result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const governanceError = toGovernedProviderApiErrorResponse(error);
    if (governanceError) {
      return withRequestWebSession(request, governanceError);
    }
    // Detect content safety filter rejections (e.g. Seedream OutputImageSensitiveContentDetected)
    if (message.includes('SensitiveContent') || message.includes('sensitive information')) {
      log.warn(`Image blocked by content safety filter: ${message}`);
      return apiErrorWithRequestSession(request, 'CONTENT_SENSITIVE', 400, message);
    }
    log.error(
      `Image generation failed [provider=${resolvedProviderId ?? 'seedream'}, model=${resolvedModelId ?? 'default'}]:`,
      error,
    );
    return apiErrorWithRequestSession(request, 'INTERNAL_ERROR', 500, message);
  }
}
