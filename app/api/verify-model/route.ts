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
import { remapModelVerificationError } from '@/lib/server/model-verification-errors';
import { resolveModel } from '@/lib/server/resolve-model';
const log = createLogger('Verify Model');

export async function POST(req: NextRequest) {
  let model: string | undefined;
  let testedModel: string | undefined;
  let requestedBaseUrl: string | undefined;
  try {
    const body = await req.json();
    const { apiKey, baseUrl, providerType } = body;
    model = body.model;
    testedModel = model;
    requestedBaseUrl = baseUrl || undefined;
    const auth = await getRequestAuth(req);

    if (!model) {
      return apiErrorWithRequestSession(
        req,
        'MISSING_REQUIRED_FIELD',
        400,
        'Model name is required',
      );
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
      testedModel = result.modelString;
    } catch (error) {
      const remappedError = remapModelVerificationError({
        modelString: testedModel || model,
        baseUrl: requestedBaseUrl,
        requestHostname: req.nextUrl.hostname,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      return await (async () => {
        const governanceError = toGovernedProviderApiErrorResponse(error);
        if (governanceError) {
          return withRequestWebSession(req, governanceError);
        }

        return apiErrorWithRequestSession(
          req,
          'INVALID_REQUEST',
          401,
          remappedError || (error instanceof Error ? error.message : String(error)),
        );
      })();
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
    const resolvedModel = testedModel || model || 'unknown';
    if (error instanceof Error) {
      const remappedError = remapModelVerificationError({
        modelString: resolvedModel,
        baseUrl: requestedBaseUrl,
        requestHostname: req.nextUrl.hostname,
        errorMessage: error.message,
      });

      if (remappedError) {
        errorMessage = remappedError;
      } else {
        // Parse common error messages
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
          errorMessage = `API key is invalid or expired for model "${resolvedModel}"`;
        } else if (
          error.message.includes('403') ||
          error.message.toLowerCase().includes('permission') ||
          error.message.toLowerCase().includes('access denied') ||
          error.message.toLowerCase().includes('forbidden')
        ) {
          errorMessage = `Your API key does not have access to model "${resolvedModel}"`;
        } else if (error.message.includes('404') || error.message.includes('not found')) {
          errorMessage = `Model "${resolvedModel}" was not found or the API endpoint rejected it`;
        } else if (error.message.includes('429')) {
          errorMessage = 'API rate limit exceeded, please try again later';
        } else if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
          errorMessage = 'Cannot connect to API server, please check the Base URL';
        } else if (error.message.includes('timeout')) {
          errorMessage = 'Connection timed out, please check your network';
        } else {
          errorMessage = `Connection failed for model "${resolvedModel}": ${error.message}`;
        }
      }
    }

    return apiErrorWithRequestSession(req, 'INTERNAL_ERROR', 500, errorMessage);
  }
}
