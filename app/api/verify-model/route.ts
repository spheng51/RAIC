import { NextRequest } from 'next/server';
import { generateText } from 'ai';
import { getRequestAuth } from '@/lib/auth/current-user';
import { createLogger } from '@/lib/logger';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  withRequestWebSession,
} from '@/lib/server/api-response';
import { toGovernedProviderApiErrorResponse } from '@/lib/server/ai-governance';
import { resolveModel } from '@/lib/server/resolve-model';
const log = createLogger('Verify Model');

export async function POST(req: NextRequest) {
  let model: string | undefined;
  try {
    const body = await req.json();
    const { apiKey, baseUrl, providerType } = body;
    model = body.model;
    const auth = await getRequestAuth(req);

    if (!model) {
      return apiErrorWithRequestSession(req, 'MISSING_REQUIRED_FIELD', 400, 'Model name is required');
    }

    // Parse model string and resolve server-side fallback
    let languageModel;
    try {
      const result = await resolveModel({
        modelString: model,
        apiKey: apiKey || '',
        baseUrl: baseUrl || undefined,
        providerType,
        auth,
      });
      languageModel = result.model;
    } catch (error) {
      return (
        (await (async () => {
          const governanceError = toGovernedProviderApiErrorResponse(error);
          if (governanceError) {
            return withRequestWebSession(req, governanceError);
          }

          return apiErrorWithRequestSession(
            req,
            'INVALID_REQUEST',
            401,
            error instanceof Error ? error.message : String(error),
          );
        })())
      );
    }

    // Send a minimal test message
    const { text } = await generateText({
      model: languageModel,
      prompt: 'Say "OK" if you can hear me.',
    });

    return apiSuccessWithRequestSession(req, {
      message: 'Connection successful',
      response: text,
    });
  } catch (error) {
    log.error(`Model verification failed [model="${model ?? 'unknown'}"]:`, error);

    let errorMessage = 'Connection failed';
    if (error instanceof Error) {
      // Parse common error messages
      if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        errorMessage = 'API key is invalid or expired';
      } else if (error.message.includes('404') || error.message.includes('not found')) {
        errorMessage = 'Model not found or API endpoint error';
      } else if (error.message.includes('429')) {
        errorMessage = 'API rate limit exceeded, please try again later';
      } else if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
        errorMessage = 'Cannot connect to API server, please check the Base URL';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'Connection timed out, please check your network';
      } else {
        errorMessage = error.message;
      }
    }

    return apiErrorWithRequestSession(req, 'INTERNAL_ERROR', 500, errorMessage);
  }
}
