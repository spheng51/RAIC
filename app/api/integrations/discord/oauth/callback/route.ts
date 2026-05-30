import { type NextRequest, NextResponse } from 'next/server';
import { requireRequestRole } from '@/lib/auth/authorize';
import { upsertDiscordConnection } from '@/lib/db/repositories/discord-connections';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import {
  DISCORD_OAUTH_STATE_COOKIE,
  exchangeDiscordOAuthCode,
  getDiscordGuild,
  listDiscordGuildChannels,
} from '@/lib/server/discord';

function redirectToStudio(request: NextRequest, status: string) {
  const url = new URL('/studio', request.nextUrl.origin);
  url.searchParams.set('discord', status);
  const response = NextResponse.redirect(url);
  response.cookies.delete(DISCORD_OAUTH_STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    const response = NextResponse.redirect(
      new URL('/sign-in?redirectTo=/studio', request.nextUrl.origin),
    );
    response.cookies.delete(DISCORD_OAUTH_STATE_COOKIE);
    return response;
  }

  const expectedState = request.cookies.get(DISCORD_OAUTH_STATE_COOKIE)?.value ?? '';
  const state = request.nextUrl.searchParams.get('state') ?? '';
  const oauthError = request.nextUrl.searchParams.get('error') ?? '';
  const code = request.nextUrl.searchParams.get('code') ?? '';
  const guildId = request.nextUrl.searchParams.get('guild_id') ?? '';
  const response = redirectToStudio(request, 'connected');

  try {
    if (!expectedState || state !== expectedState) {
      return redirectToStudio(request, 'invalid_state');
    }
    if (oauthError) {
      return redirectToStudio(request, 'error');
    }
    if (!code || !guildId) {
      return redirectToStudio(request, 'missing_guild');
    }

    await exchangeDiscordOAuthCode({
      code,
      redirectUri: `${buildRequestOrigin(request)}/api/integrations/discord/oauth/callback`,
    });
    const guild = await getDiscordGuild(guildId);
    const channels = await listDiscordGuildChannels(guildId);
    const channel = channels[0] ?? null;
    await upsertDiscordConnection({
      ownerUserId: auth.user.id,
      organizationId: auth.session.organizationId ?? null,
      guildId: guild.id,
      guildName: guild.name,
      channelId: channel?.id ?? null,
      channelName: channel?.name ?? null,
    });
    return response;
  } catch {
    return redirectToStudio(request, 'error');
  }
}
