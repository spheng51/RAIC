import { NextRequest } from 'next/server';
import { getRequestAuth } from '@/lib/auth/current-user';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
} from '@/lib/server/api-response';
import { getEffectiveAIOptions } from '@/lib/server/ai-governance';
import { createLogger } from '@/lib/logger';

const log = createLogger('AIOptions API');

export async function GET(request: NextRequest) {
  try {
    const auth = await getRequestAuth(request);
    const options = await getEffectiveAIOptions(auth);
    return apiSuccessWithRequestSession(request, options);
  } catch (error) {
    log.error('Failed to resolve effective AI options:', error);
    return apiErrorWithRequestSession(
      request,
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to resolve AI options',
    );
  }
}
