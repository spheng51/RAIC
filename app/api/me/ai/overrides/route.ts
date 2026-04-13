import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireRequestRole } from '@/lib/auth/authorize';
import { appendAuditLog } from '@/lib/db/repositories/audit-logs';
import { findOrganizationAIPolicy } from '@/lib/db/repositories/organization-ai-policies';
import { createLogger } from '@/lib/logger';
import {
  apiError,
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
} from '@/lib/server/api-response';
import {
  findApprovedOrganizationProvider,
  getUserOverridesSnapshot,
  saveUserOverridesSnapshot,
} from '@/lib/server/ai-governance';
import { hasEncryptionKeyConfigured } from '@/lib/server/encrypted-secrets';
import type { AIProviderFamily } from '@/lib/types/ai-governance';

const log = createLogger('MyAIOverrides API');

const overridePayloadSchema = z.object({
  overrides: z.array(
    z.object({
      family: z.enum(['llm', 'tts', 'asr', 'pdf', 'image', 'video', 'webSearch']),
      providerId: z.string().min(1),
      enabled: z.boolean(),
      baseUrl: z.string().url().nullable().optional(),
      preferredModel: z.string().nullable().optional(),
      secret: z.string().optional(),
      clearSecret: z.boolean().optional(),
    }),
  ),
});

function encryptionUnavailableResponse() {
  return apiError(
    'INTERNAL_ERROR',
    503,
    'RAIC_SECRET_ENCRYPTION_KEY is required for personal AI overrides.',
  );
}

export async function GET(request: NextRequest) {
  const auth = await requireRequestRole(request, ['teacher']);
  if ('status' in auth) {
    return auth;
  }

  if (!hasEncryptionKeyConfigured()) {
    return encryptionUnavailableResponse();
  }

  try {
    const snapshot = await getUserOverridesSnapshot(auth);
    return apiSuccessWithRequestSession(request, snapshot);
  } catch (error) {
    log.error('Failed to load user AI overrides:', error);
    return apiErrorWithRequestSession(
      request,
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to load user overrides',
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireRequestRole(request, ['teacher']);
  if ('status' in auth) {
    return auth;
  }

  if (!hasEncryptionKeyConfigured()) {
    return encryptionUnavailableResponse();
  }

  const organizationId = auth.organization?.id;
  if (!organizationId) {
    return apiError('INVALID_REQUEST', 400, 'Active organization is required');
  }

  try {
    const payload = overridePayloadSchema.parse(await request.json());
    const policyRecord = await findOrganizationAIPolicy(organizationId);

    if (!policyRecord?.allowPersonalOverrides) {
      await appendAuditLog({
        organizationId,
        userId: auth.user.id,
        actorRole: auth.session.role,
        action: 'user_provider_override.denied',
        resourceType: 'organization_ai_policy',
        metadata: {
          reason: 'personal_overrides_disabled',
        },
      });
      return apiErrorWithRequestSession(
        request,
        'FORBIDDEN',
        403,
        'Personal overrides are disabled for this organization.',
      );
    }

    for (const override of payload.overrides) {
      const approvedProvider = await findApprovedOrganizationProvider({
        organizationId,
        family: override.family as AIProviderFamily,
        providerId: override.providerId,
      });

      if (!approvedProvider) {
        await appendAuditLog({
          organizationId,
          userId: auth.user.id,
          actorRole: auth.session.role,
          action: 'user_provider_override.denied',
          resourceType: 'organization_provider_config',
          metadata: {
            family: override.family,
            providerId: override.providerId,
            reason: 'provider_not_approved',
          },
        });
        return apiErrorWithRequestSession(
          request,
          'INVALID_REQUEST',
          400,
          `Provider "${override.providerId}" is not approved for personal overrides.`,
        );
      }

      if (override.baseUrl && !policyRecord.allowPersonalCustomBaseUrls) {
        await appendAuditLog({
          organizationId,
          userId: auth.user.id,
          actorRole: auth.session.role,
          action: 'user_provider_override.denied',
          resourceType: 'organization_ai_policy',
          metadata: {
            family: override.family,
            providerId: override.providerId,
            reason: 'personal_base_urls_disabled',
          },
        });
        return apiErrorWithRequestSession(
          request,
          'INVALID_REQUEST',
          400,
          'Personal custom base URLs are disabled for this organization.',
        );
      }
    }

    const snapshot = await saveUserOverridesSnapshot(auth, payload);
    return apiSuccessWithRequestSession(request, snapshot);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiErrorWithRequestSession(
        request,
        'INVALID_REQUEST',
        400,
        error.issues[0]?.message || 'Invalid AI override payload',
      );
    }

    log.error('Failed to save user AI overrides:', error);
    return apiErrorWithRequestSession(
      request,
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to save user overrides',
    );
  }
}
