import { type NextRequest, NextResponse } from 'next/server';
import { requireRequestRole } from '@/lib/auth/authorize';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  API_ERROR_CODES,
  withRequestWebSession,
} from '@/lib/server/api-response';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';
import {
  ScheduledClassDiscordSyncError,
  syncScheduledClassDiscordForAccess,
  type ScheduledClassAccessScope,
} from '@/lib/server/scheduled-classes';

const log = createLogger('Scheduled Class Discord Sync API');

interface DiscordSyncBody {
  connectionId?: unknown;
}

const RECOVERABLE_DISCORD_SYNC_ERROR_PREFIXES = [
  'Assign this scheduled class',
  'Choose a classroom',
  'Choose an accessible classroom',
  'Choose a Discord announcement channel',
  'Connect Discord',
  'Reconnect Discord',
];

function isRecoverableDiscordSyncError(message: string) {
  return RECOVERABLE_DISCORD_SYNC_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix));
}

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
  const body = (await request.json().catch(() => null)) as DiscordSyncBody | null;
  const bodyConnectionId = typeof body?.connectionId === 'string' ? body.connectionId.trim() : '';
  const queryConnectionId = request.nextUrl.searchParams.get('connectionId')?.trim() ?? '';
  const connectionId = bodyConnectionId || queryConnectionId;
  try {
    const event = await syncScheduledClassDiscordForAccess(getScope(auth), id, {
      baseUrl: buildRequestOrigin(request),
      ...(connectionId ? { connectionId } : {}),
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
    const message =
      error instanceof Error ? error.message : 'Failed to sync scheduled class with Discord.';
    if (error instanceof ScheduledClassDiscordSyncError && error.event) {
      return withRequestWebSession(
        request,
        NextResponse.json(
          {
            success: false,
            errorCode: API_ERROR_CODES.INVALID_REQUEST,
            error: message,
            event: error.event,
          },
          { status: 400 },
        ),
      );
    }

    if (isRecoverableDiscordSyncError(message)) {
      return apiErrorWithRequestSession(request, API_ERROR_CODES.INVALID_REQUEST, 400, message);
    }

    log.error('Unexpected scheduled class Discord sync failure:', error);
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to sync scheduled class with Discord.',
    );
  }
}
