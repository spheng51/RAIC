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
import { generateVideo, normalizeVideoOptions } from '@/lib/media/video-providers';
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
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';

const log = createLogger('VideoGeneration API');

export const maxDuration = 300;

export async function POST(request: NextRequest) {
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

    if (clientBaseUrl && process.env.NODE_ENV === 'production') {
      const ssrfError = await validateUrlForSSRF(clientBaseUrl);
      if (ssrfError) {
        return apiErrorWithRequestSession(request, 'INVALID_URL', 403, ssrfError);
      }
    }

    const auth = await getRequestAuth(request);
    const resolved = await resolveGovernedProviderConfig({
      auth,
      family: 'video',
      providerId,
      requestedSecret: clientApiKey,
      requestedBaseUrl: clientBaseUrl,
      requestedModel: clientModel,
    });

    // Normalize options against provider capabilities
    const options = normalizeVideoOptions(providerId, body);

    log.info(
      `Generating video: provider=${providerId}, model=${clientModel || 'default'}, ` +
        `prompt="${body.prompt.slice(0, 80)}...", duration=${options.duration ?? 'auto'}, ` +
        `aspect=${options.aspectRatio ?? 'auto'}, resolution=${options.resolution ?? 'auto'}`,
    );

    const result = await generateVideo(
      {
        providerId,
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
      `Video generation failed [provider=${request.headers.get('x-video-provider') ?? 'kling'}, model=${request.headers.get('x-video-model') ?? 'default'}]:`,
      error,
    );
    return apiErrorWithRequestSession(request, 'INTERNAL_ERROR', 500, message);
  }
}
