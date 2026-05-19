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
import { listDiscordGuildChannels } from '@/lib/server/discord';
import type {
  DiscordChannelSummary,
  DiscordConnectionSummary,
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

async function readConnectionSnapshot(ownerUserId: string) {
  const connections = await listDiscordConnectionsForUser(ownerUserId);
  const connection = connections[0] ?? null;
  let channels: DiscordChannelSummary[] = [];
  if (connection) {
    channels = await listDiscordGuildChannels(connection.guildId).catch(() => []);
  }
  return {
    connection: connection ? toSummary(connection) : null,
    channels: channels.map((channel) => ({ id: channel.id, name: channel.name })),
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const snapshot = await readConnectionSnapshot(auth.user.id);
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

  const connection = await readDiscordConnectionForUser(auth.user.id, connectionId);
  if (!connection) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      404,
      'Discord connection not found.',
    );
  }

  const channels = await listDiscordGuildChannels(connection.guildId);
  const channel = channels.find((item) => item.id === channelId);
  if (!channel) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Choose an accessible Discord announcement channel.',
    );
  }

  await upsertDiscordConnection({
    ownerUserId: auth.user.id,
    organizationId: auth.session.organizationId ?? null,
    guildId: connection.guildId,
    guildName: connection.guildName,
    channelId: channel.id,
    channelName: channel.name,
  });

  const snapshot = await readConnectionSnapshot(auth.user.id);
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

  await deleteDiscordConnectionForUser(auth.user.id, id);
  const snapshot = await readConnectionSnapshot(auth.user.id);
  return apiSuccessWithRequestSession(request, snapshot);
}
