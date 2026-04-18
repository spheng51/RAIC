/**
 * Web Search API
 *
 * POST /api/web-search
 * Simple JSON request/response using Tavily search.
 */

import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import type { AICallFn } from '@/lib/generation/pipeline-types';
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
import {
  buildSearchQuery,
  SEARCH_QUERY_REWRITE_EXCERPT_LENGTH,
} from '@/lib/server/search-query-builder';
import { resolveScenarioManagedProviderRoute } from '@/lib/server/provider-scenario-routing';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { searchWithTavily, formatSearchResultsAsContext } from '@/lib/web-search/tavily';

const log = createLogger('WebSearch');

export async function POST(req: NextRequest) {
  let query: string | undefined;
  try {
    const body = await req.json();
    const {
      query: requestQuery,
      pdfText,
      apiKey: clientApiKey,
    } = body as {
      query?: string;
      pdfText?: string;
      apiKey?: string;
    };
    query = requestQuery;

    if (!query || !query.trim()) {
      return apiErrorWithRequestSession(req, 'MISSING_REQUIRED_FIELD', 400, 'query is required');
    }

    const auth = await getRequestAuth(req);
    const resolvedWebSearch =
      (await resolveScenarioManagedProviderRoute({
        auth,
        routeId: 'web-search',
        taskBucket: 'webSearch',
        family: 'webSearch',
        requestedProviderId: 'tavily',
        requestedSecret: clientApiKey || undefined,
      })) ||
      (await resolveGovernedProviderConfig({
        auth,
        family: 'webSearch',
        providerId: 'tavily',
        requestedSecret: clientApiKey || undefined,
      }));

    const boundedPdfText = pdfText?.slice(0, SEARCH_QUERY_REWRITE_EXCERPT_LENGTH);

    let aiCall: AICallFn | undefined;
    try {
      const { model: languageModel } = await resolveModelFromHeaders(req);
      aiCall = async (systemPrompt, userPrompt) => {
        const result = await callLLM(
          {
            model: languageModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            maxOutputTokens: 256,
          },
          'web-search-query-rewrite',
        );
        return result.text;
      };
    } catch (error) {
      log.warn('Search query rewrite model unavailable, falling back to raw requirement:', error);
    }

    const searchQuery = await buildSearchQuery(query, boundedPdfText, aiCall);

    log.info('Running web search API request', {
      hasPdfContext: searchQuery.hasPdfContext,
      rawRequirementLength: searchQuery.rawRequirementLength,
      rewriteAttempted: searchQuery.rewriteAttempted,
      finalQueryLength: searchQuery.finalQueryLength,
    });

    const result = await searchWithTavily({
      query: searchQuery.query,
      apiKey: resolvedWebSearch.apiKey,
      baseUrl: resolvedWebSearch.baseUrl,
    });
    const context = formatSearchResultsAsContext(result);

    return apiSuccessWithRequestSession(req, {
      answer: result.answer,
      sources: result.sources,
      context,
      query: result.query,
      responseTime: result.responseTime,
    });
  } catch (err) {
    const governanceError = toGovernedProviderApiErrorResponse(err);
    if (governanceError) {
      return withRequestWebSession(req, governanceError);
    }

    log.error(`Web search failed [query="${query?.substring(0, 60) ?? 'unknown'}"]:`, err);
    const message = err instanceof Error ? err.message : 'Web search failed';
    return apiErrorWithRequestSession(req, 'INTERNAL_ERROR', 500, message);
  }
}
