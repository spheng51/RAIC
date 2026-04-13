import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireRequestRole } from '@/lib/auth/authorize';
import { createLogger } from '@/lib/logger';
import {
  apiError,
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
} from '@/lib/server/api-response';
import { getAdminConfigSnapshot, saveAdminConfigSnapshot } from '@/lib/server/ai-governance';
import { hasEncryptionKeyConfigured } from '@/lib/server/encrypted-secrets';

const log = createLogger('AdminAIConfig API');

const providerDefinitionSchema = z
  .object({
    name: z.string().min(1),
    providerType: z.enum(['openai', 'anthropic', 'google']).optional(),
    defaultBaseUrl: z.string().url().optional(),
    icon: z.string().optional(),
    requiresApiKey: z.boolean().optional(),
    models: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1),
        }),
      )
      .optional(),
  })
  .nullable()
  .optional();

const adminConfigSchema = z.object({
  policy: z.object({
    allowPersonalOverrides: z.boolean(),
    allowPersonalCustomBaseUrls: z.boolean(),
  }),
  configs: z.array(
    z.object({
      family: z.enum(['llm', 'tts', 'asr', 'pdf', 'image', 'video', 'webSearch']),
      providerId: z.string().min(1),
      enabled: z.boolean(),
      baseUrl: z.string().url().nullable().optional(),
      allowedModels: z.array(z.string().min(1)).optional(),
      defaultModel: z.string().nullable().optional(),
      secret: z.string().optional(),
      clearSecret: z.boolean().optional(),
      definition: providerDefinitionSchema,
    }),
  ),
});

function encryptionUnavailableResponse() {
  return apiError(
    'INTERNAL_ERROR',
    503,
    'RAIC_SECRET_ENCRYPTION_KEY is required for organization AI configuration.',
  );
}

export async function GET(request: NextRequest) {
  const auth = await requireRequestRole(request, ['org_admin']);
  if ('status' in auth) {
    return auth;
  }

  if (!hasEncryptionKeyConfigured()) {
    return encryptionUnavailableResponse();
  }

  try {
    const snapshot = await getAdminConfigSnapshot(auth);
    return apiSuccessWithRequestSession(request, snapshot);
  } catch (error) {
    log.error('Failed to load admin AI config snapshot:', error);
    return apiErrorWithRequestSession(
      request,
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to load admin AI config',
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireRequestRole(request, ['org_admin']);
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
    const payload = adminConfigSchema.parse(await request.json());
    const snapshot = await saveAdminConfigSnapshot(auth, payload);
    return apiSuccessWithRequestSession(request, snapshot);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiErrorWithRequestSession(
        request,
        'INVALID_REQUEST',
        400,
        error.issues[0]?.message || 'Invalid admin AI config payload',
      );
    }

    log.error('Failed to save admin AI config:', error);
    return apiErrorWithRequestSession(
      request,
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to save admin AI config',
    );
  }
}
