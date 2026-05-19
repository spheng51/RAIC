import { type NextRequest, NextResponse } from 'next/server';
import { requireRequestRole } from '@/lib/auth/authorize';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  API_ERROR_CODES,
} from '@/lib/server/api-response';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import {
  syncScheduledClassDiscordForAccess,
  type ScheduledClassAccessScope,
} from '@/lib/server/scheduled-classes';

function getScope(auth: Awaited<ReturnType<typeof requireRequestRole>>): ScheduledClassAccessScope {
  if (auth instanceof NextResponse) {
    throw new Error('Cannot build schedule scope from an auth response');
  }

  return {
    role: auth.session.role,
    userId: auth.user.id,
    organizationId: auth.session.organizationId ?? null,
  };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const { id } = await params;
  try {
    const event = await syncScheduledClassDiscordForAccess(getScope(auth), id, {
      baseUrl: buildRequestOrigin(request),
    });
    if (!event) {
      return apiErrorWithRequestSession(
        request,
        API_ERROR_CODES.INVALID_REQUEST,
        404,
        'Scheduled class not found',
      );
    }
    return apiSuccessWithRequestSession(request, { event });
  } catch (error) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      error instanceof Error ? error.message : 'Failed to sync scheduled class with Discord.',
    );
  }
}
