/**
 * Verify Video Provider API
 *
 * Lightweight endpoint that validates provider credentials without generating video.
 *
 * POST /api/verify-video-provider
 *
 * Headers:
 *   x-video-provider: VideoProviderId
 *   x-video-model: string (optional)
 *   x-api-key: string (optional, server fallback)
 *   x-base-url: string (optional, server fallback)
 *
 * Response: { success: boolean, message: string }
 */

import { NextRequest } from 'next/server';
import { getRequestAuth } from '@/lib/auth/current-user';
import { testVideoConnectivity } from '@/lib/media/video-providers';
import {
  resolveGovernedProviderConfig,
  toGovernedProviderApiErrorResponse,
} from '@/lib/server/ai-governance';
import type { VideoProviderId } from '@/lib/media/types';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  withRequestWebSession,
} from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';

const log = createLogger('VerifyVideoProvider');

export async function POST(request: NextRequest) {
  try {
    const providerId = (request.headers.get('x-video-provider') || 'seedance') as VideoProviderId;
    const model = request.headers.get('x-video-model') || undefined;
    const clientApiKey =
      request.headers.get('x-video-api-key') || request.headers.get('x-api-key') || undefined;
    const clientBaseUrl =
      request.headers.get('x-video-base-url') || request.headers.get('x-base-url') || undefined;
    const auth = await getRequestAuth(request);

    if (clientBaseUrl && process.env.NODE_ENV === 'production') {
      const ssrfError = await validateUrlForSSRF(clientBaseUrl);
      if (ssrfError) {
        return apiErrorWithRequestSession(request, 'INVALID_URL', 403, ssrfError);
      }
    }

    const resolved = await resolveGovernedProviderConfig({
      auth,
      family: 'video',
      providerId,
      requestedSecret: clientApiKey,
      requestedBaseUrl: clientBaseUrl,
      requestedModel: model,
    });

    if (!resolved.apiKey) {
      return apiErrorWithRequestSession(request, 'MISSING_API_KEY', 400, 'No API key configured');
    }

    const result = await testVideoConnectivity({
      providerId,
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      model: resolved.modelId || model,
    });

    if (!result.success) {
      return apiErrorWithRequestSession(request, 'UPSTREAM_ERROR', 500, result.message);
    }

    return apiSuccessWithRequestSession(request, { message: result.message });
  } catch (err) {
    const governanceError = toGovernedProviderApiErrorResponse(err);
    if (governanceError) {
      return withRequestWebSession(request, governanceError);
    }

    log.error(
      `Video provider verification failed [provider=${request.headers.get('x-video-provider') ?? 'seedance'}]:`,
      err,
    );
    return apiErrorWithRequestSession(request, 'INTERNAL_ERROR', 500, `Connectivity test error: ${err}`);
  }
}
