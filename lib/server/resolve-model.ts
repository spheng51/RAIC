/**
 * Shared model resolution utilities for API routes.
 *
 * Normalizes request-supplied model preferences against the org-managed
 * provider resolver before instantiating the SDK model.
 */

import type { NextRequest } from 'next/server';
import { getModel, parseModelString, type ModelWithInfo } from '@/lib/ai/providers';
import type { AuthContext } from '@/lib/auth/current-user';
import { getRequestAuth } from '@/lib/auth/current-user';
import { resolveLLMGovernedConfig } from '@/lib/server/ai-governance';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';

export interface ResolvedModel extends ModelWithInfo {
  modelString: string;
  providerId: string;
  apiKey: string;
}

export async function resolveModel(params: {
  modelString?: string;
  apiKey?: string;
  baseUrl?: string;
  providerType?: string;
  auth?: AuthContext | null;
  organizationId?: string | null;
  userId?: string | null;
  mode?: 'interactive' | 'background';
}): Promise<ResolvedModel> {
  const requestedModelString = params.modelString || process.env.DEFAULT_MODEL || 'gpt-4o-mini';
  const { providerId, modelId } = parseModelString(requestedModelString);

  if (params.baseUrl && process.env.NODE_ENV === 'production') {
    const ssrfError = await validateUrlForSSRF(params.baseUrl);
    if (ssrfError) {
      throw new Error(ssrfError);
    }
  }

  const resolved = await resolveLLMGovernedConfig({
    auth: params.auth ?? null,
    organizationId: params.organizationId,
    userId: params.userId,
    providerId,
    modelId,
    requestedSecret: params.apiKey || undefined,
    requestedBaseUrl: params.baseUrl || undefined,
    requestedProviderType: params.providerType as 'openai' | 'anthropic' | 'google' | undefined,
    mode: params.mode,
  });

  const { model, modelInfo } = getModel({
    providerId: resolved.providerId as typeof providerId,
    modelId: resolved.modelId,
    apiKey: resolved.apiKey,
    baseUrl: resolved.baseUrl,
    proxy: resolved.proxy,
    providerType: resolved.providerType,
  });

  return {
    model,
    modelInfo,
    modelString: `${resolved.providerId}:${resolved.modelId}`,
    providerId: resolved.providerId,
    apiKey: resolved.apiKey,
  };
}

export async function resolveModelFromHeaders(req: NextRequest): Promise<ResolvedModel> {
  return resolveModelFromHeadersWithScope(req, {});
}

export async function resolveModelFromHeadersWithScope(
  req: NextRequest,
  scope: {
    auth?: AuthContext | null;
    organizationId?: string | null;
    userId?: string | null;
    mode?: 'interactive' | 'background';
  },
): Promise<ResolvedModel> {
  const auth =
    scope.auth !== undefined
      ? scope.auth
      : await getRequestAuth(req);

  return resolveModel({
    modelString: req.headers.get('x-model') || undefined,
    apiKey: req.headers.get('x-api-key') || undefined,
    baseUrl: req.headers.get('x-base-url') || undefined,
    providerType: req.headers.get('x-provider-type') || undefined,
    auth,
    organizationId: scope.organizationId,
    userId: scope.userId,
    mode: scope.mode,
  });
}
