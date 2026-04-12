import { NextRequest } from 'next/server';
import { getRequestAuth } from '@/lib/auth/current-user';
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

const log = createLogger('Verify PDF Provider');

export async function POST(req: NextRequest) {
  let providerId: string | undefined;
  try {
    const body = await req.json();
    providerId = body.providerId;
    const { apiKey, baseUrl } = body;
    const auth = await getRequestAuth(req);

    if (!providerId) {
      return apiErrorWithRequestSession(
        req,
        'MISSING_REQUIRED_FIELD',
        400,
        'Provider ID is required',
      );
    }

    const clientBaseUrl = (baseUrl as string | undefined) || undefined;
    if (clientBaseUrl && process.env.NODE_ENV === 'production') {
      const ssrfError = await validateUrlForSSRF(clientBaseUrl);
      if (ssrfError) {
        return apiErrorWithRequestSession(req, 'INVALID_URL', 403, ssrfError);
      }
    }

    const resolved = await resolveGovernedProviderConfig({
      auth,
      family: 'pdf',
      providerId,
      requestedSecret: (apiKey as string | undefined) || undefined,
      requestedBaseUrl: clientBaseUrl,
    });

    const resolvedBaseUrl = resolved.baseUrl;
    if (!resolvedBaseUrl) {
      return apiErrorWithRequestSession(req, 'MISSING_REQUIRED_FIELD', 400, 'Base URL is required');
    }

    const headers: Record<string, string> = {};
    if (resolved.apiKey) {
      headers['Authorization'] = `Bearer ${resolved.apiKey}`;
    }

    const response = await fetch(resolvedBaseUrl, {
      headers,
      signal: AbortSignal.timeout(10000),
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      return apiErrorWithRequestSession(
        req,
        'REDIRECT_NOT_ALLOWED',
        403,
        'Redirects are not allowed',
      );
    }

    // MinerU's FastAPI root returns 404 (no root route), but the server is reachable.
    // Any HTTP response (including 404) means the server is up.
    return apiSuccessWithRequestSession(req, {
      message: 'Connection successful',
      status: response.status,
    });
  } catch (error) {
    const governanceError = toGovernedProviderApiErrorResponse(error);
    if (governanceError) {
      return withRequestWebSession(req, governanceError);
    }

    log.error(`PDF provider verification failed [provider=${providerId ?? 'unknown'}]:`, error);

    let errorMessage = 'Connection failed';
    if (error instanceof Error) {
      if (error.message.includes('ECONNREFUSED')) {
        errorMessage = 'Cannot connect to server, please check the Base URL';
      } else if (error.message.includes('ENOTFOUND')) {
        errorMessage = 'Server not found, please check the Base URL';
      } else if (error.message.includes('timeout') || error.name === 'TimeoutError') {
        errorMessage = 'Connection timed out';
      } else {
        errorMessage = error.message;
      }
    }

    return apiErrorWithRequestSession(req, 'INTERNAL_ERROR', 500, errorMessage);
  }
}
