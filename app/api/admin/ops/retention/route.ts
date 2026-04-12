import { type NextRequest, NextResponse } from 'next/server';
import { requireRequestRole } from '@/lib/auth/authorize';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  API_ERROR_CODES,
} from '@/lib/server/api-response';
import {
  runPlatformRetentionCleanup,
  type PlatformRetentionPolicy,
} from '@/lib/server/platform-retention';
import { recordAuditEvent } from '@/lib/server/audit-log';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePolicy(value: unknown): Partial<PlatformRetentionPolicy> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isPlainObject(value)) {
    throw new Error('policy must be an object');
  }

  const policy: Partial<PlatformRetentionPolicy> = {};

  for (const key of [
    'staleSessionRetentionDays',
    'expiredJoinTokenRetentionDays',
    'guestUserRetentionDays',
    'auditLogRetentionDays',
  ] as const) {
    const rawValue = value[key];
    if (rawValue === undefined) {
      continue;
    }

    if (typeof rawValue !== 'number') {
      throw new Error(`${key} must be a number`);
    }

    policy[key] = rawValue;
  }

  return policy;
}

export async function GET(request: NextRequest) {
  const auth = await requireRequestRole(request, ['system_admin']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const result = await runPlatformRetentionCleanup({ dryRun: true });
  return apiSuccessWithRequestSession(request, {
    retention: result,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireRequestRole(request, ['system_admin']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  try {
    const rawBody = await request.json().catch(() => ({}));
    if (!isPlainObject(rawBody)) {
      return apiErrorWithRequestSession(
        request,
        API_ERROR_CODES.INVALID_REQUEST,
        400,
        'Retention request body must be a JSON object',
      );
    }

    const dryRun = typeof rawBody.dryRun === 'boolean' ? rawBody.dryRun : true;
    const result = await runPlatformRetentionCleanup({
      dryRun,
      policy: parsePolicy(rawBody.policy),
    });

    await recordAuditEvent({
      organizationId: auth.session.organizationId,
      userId: auth.user.id,
      actorRole: auth.session.role,
      action: 'platform.retention.cleanup',
      resourceType: 'platform',
      resourceId: result.mode,
      metadata: {
        dryRun,
        candidates: result.candidates,
        deleted: result.deleted,
        policy: result.policy,
      },
    });

    return apiSuccessWithRequestSession(request, {
      retention: result,
    });
  } catch (error) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      error instanceof Error ? error.message : 'Retention cleanup failed',
    );
  }
}
