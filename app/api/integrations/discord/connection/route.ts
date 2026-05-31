import { type NextRequest, NextResponse } from 'next/server';
import { requireRequestRole } from '@/lib/auth/authorize';
import {
  deleteDiscordConnectionForUser,
  listDiscordConnectionsForUser,
  readDiscordConnectionForUser,
  upsertDiscordConnection,
} from '@/lib/db/repositories/discord-connections';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  API_ERROR_CODES,
} from '@/lib/server/api-response';
import {
  getDiscordConfig,
  listDiscordGuildChannels,
  normalizeDiscordError,
} from '@/lib/server/discord';
import type {
  DiscordChannelSummary,
  DiscordConnectionSummary,
  DiscordIntegrationSnapshot,
} from '@/lib/types/scheduled-classes';

interface ConnectionBody {
  id?: unknown;
  connectionId?: unknown;
  channelId?: unknown;
}

function toSummary(connection: {
  id: string;
  guildId: string;
  guildName: string;
  channelId: string | null;
  channelName: string | null;
}): DiscordConnectionSummary {
  return {
    id: connection.id,
    guildId: connection.guildId,
    guildName: connection.guildName,
    channelId: connection.channelId,
    channelName: connection.channelName,
  };
}

function connectionMatchesOrganization(
  connection: { organizationId: string | null },
  organizationId: string | null,
): boolean {
  return connection.organizationId === organizationId;
}

async function readConnectionSnapshot(
  ownerUserId: string,
  organizationId: string | null,
  options: { connectionId?: string } = {},
): Promise<DiscordIntegrationSnapshot> {
  const configured = Boolean(getDiscordConfig());
  const connections = (await listDiscordConnectionsForUser(ownerUserId)).filter((connection) =>
    connectionMatchesOrganization(connection, organizationId),
  );
  const connection = options.connectionId
    ? (connections.find((item) => item.id === options.connectionId) ?? null)
    : (connections[0] ?? null);
  let channels: DiscordChannelSummary[] = [];
  let channelsError: string | undefined;
  if (configured && connection) {
    try {
      channels = await listDiscordGuildChannels(connection.guildId);
    } catch (error) {
      channelsError = normalizeDiscordError(error);
    }
  }
  return {
    configured,
    connection: connection ? toSummary(connection) : null,
    connections: connections.map(toSummary),
    channels: channels.map((channel) => ({ id: channel.id, name: channel.name })),
    ...(channelsError ? { channelsError } : {}),
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const connectionId = request.nextUrl.searchParams.get('connectionId')?.trim() || undefined;
  const snapshot = await readConnectionSnapshot(auth.user.id, auth.session.organizationId ?? null, {
    connectionId,
  });
  if (connectionId && !snapshot.connection) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      404,
      'Discord connection not found.',
    );
  }
  return apiSuccessWithRequestSession(request, snapshot);
}

export async function POST(request: NextRequest) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const body = (await request.json().catch(() => null)) as ConnectionBody | null;
  const connectionId =
    typeof body?.connectionId === 'string'
      ? body.connectionId.trim()
      : typeof body?.id === 'string'
        ? body.id.trim()
        : '';
  const channelId = typeof body?.channelId === 'string' ? body.channelId.trim() : '';

  if (!connectionId || !channelId) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.MISSING_REQUIRED_FIELD,
      400,
      'Choose a Discord connection and announcement channel.',
    );
  }

  if (!getDiscordConfig()) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.MISSING_API_KEY,
      503,
      'Discord integration is not configured.',
    );
  }

  const connection = await readDiscordConnectionForUser(auth.user.id, connectionId);
  if (!connection) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      404,
      'Discord connection not found.',
    );
  }
  if (!connectionMatchesOrganization(connection, auth.session.organizationId ?? null)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      404,
      'Discord connection not found.',
    );
  }

  let channels: DiscordChannelSummary[];
  try {
    channels = await listDiscordGuildChannels(connection.guildId);
  } catch (error) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.UPSTREAM_ERROR,
      502,
      'Unable to load Discord announcement channels.',
      normalizeDiscordError(error),
    );
  }

  const channel = channels.find((item) => item.id === channelId);
  if (!channel) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Choose an accessible Discord announcement channel.',
    );
  }

  const saved = await upsertDiscordConnection({
    ownerUserId: auth.user.id,
    organizationId: auth.session.organizationId ?? null,
    guildId: connection.guildId,
    guildName: connection.guildName,
    channelId: channel.id,
    channelName: channel.name,
  });

  const snapshot = await readConnectionSnapshot(auth.user.id, auth.session.organizationId ?? null, {
    connectionId: saved.id,
  });
  return apiSuccessWithRequestSession(request, snapshot);
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const body = (await request.json().catch(() => null)) as ConnectionBody | null;
  const id =
    (typeof body?.id === 'string' ? body.id.trim() : '') ||
    request.nextUrl.searchParams.get('id')?.trim() ||
    '';
  if (!id) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.MISSING_REQUIRED_FIELD,
      400,
      'Missing required field: id',
    );
  }

  const connection = await readDiscordConnectionForUser(auth.user.id, id);
  if (
    !connection ||
    !connectionMatchesOrganization(connection, auth.session.organizationId ?? null)
  ) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      404,
      'Discord connection not found.',
    );
  }

  await deleteDiscordConnectionForUser(auth.user.id, id);
  const snapshot = await readConnectionSnapshot(auth.user.id, auth.session.organizationId ?? null);
  return apiSuccessWithRequestSession(request, snapshot);
}
