import type { ClassroomLiveMeeting } from '@/lib/types/stage';

export type ValidatedZoomMeetingUrl =
  | {
      ok: true;
      url: string;
    }
  | {
      ok: false;
      error: string;
    };

export interface ValidateZoomMeetingUrlOptions {
  readonly allowedHosts?: readonly string[];
  readonly envAllowedHosts?: string | null;
}

const DEFAULT_ZOOM_MEETING_HOSTS = ['zoom.us', 'zoomgov.com'] as const;
const HOST_ONLY_START_PATHS = new Set(['s', 'start']);
const ZOOM_MEETING_ID_PATTERN = /^\d{6,20}$/;

function parseHostList(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeAllowedHosts(input?: ValidateZoomMeetingUrlOptions): string[] {
  if (input?.allowedHosts?.length) {
    return input.allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean);
  }

  const envHosts = parseHostList(input?.envAllowedHosts ?? process.env.ZOOM_ALLOWED_MEETING_HOSTS);
  return envHosts.length > 0 ? envHosts : [...DEFAULT_ZOOM_MEETING_HOSTS];
}

export function getAllowedZoomMeetingHosts(
  envAllowedHosts = process.env.ZOOM_ALLOWED_MEETING_HOSTS,
): string[] {
  return normalizeAllowedHosts({ envAllowedHosts });
}

export function isAllowedZoomMeetingHost(hostname: string, allowedHosts: readonly string[]) {
  const candidate = hostname.toLowerCase();
  return allowedHosts.some((allowedHost) => {
    const normalizedAllowedHost = allowedHost.toLowerCase();
    return candidate === normalizedAllowedHost || candidate.endsWith(`.${normalizedAllowedHost}`);
  });
}

function hasHostOnlyCredentials(url: URL) {
  const firstPathSegment = url.pathname
    .split('/')
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean)[0];

  return (
    Boolean(firstPathSegment && HOST_ONLY_START_PATHS.has(firstPathSegment)) ||
    url.searchParams.has('zak') ||
    Boolean(url.username || url.password)
  );
}

function isAttendeeJoinPath(url: URL) {
  const pathSegments = url.pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  return (
    pathSegments.length === 2 &&
    pathSegments[0].toLowerCase() === 'j' &&
    ZOOM_MEETING_ID_PATTERN.test(pathSegments[1])
  );
}

export function validateZoomMeetingUrl(
  value: unknown,
  options?: ValidateZoomMeetingUrlOptions,
): ValidatedZoomMeetingUrl {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, error: 'Zoom meeting link is required.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return { ok: false, error: 'Zoom meeting link must be a valid URL.' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Zoom meeting link must use HTTPS.' };
  }

  const allowedHosts = normalizeAllowedHosts(options);
  if (!isAllowedZoomMeetingHost(parsed.hostname, allowedHosts)) {
    return { ok: false, error: 'Only approved Zoom meeting links can be attached.' };
  }

  if (hasHostOnlyCredentials(parsed)) {
    return {
      ok: false,
      error: 'Use the attendee join link, not a host start link or credentialed URL.',
    };
  }

  if (!isAttendeeJoinPath(parsed)) {
    return {
      ok: false,
      error: 'Use an attendee Zoom invite link in the format https://zoom.us/j/{meetingId}.',
    };
  }

  return { ok: true, url: parsed.href };
}

export function buildManualZoomLiveMeeting(input: {
  joinUrl: string;
  label?: string | null;
  attachedByUserId: string;
  attachedAt?: string;
}): ClassroomLiveMeeting {
  const label = input.label?.trim();

  return {
    provider: 'zoom',
    source: 'manual-link',
    joinUrl: input.joinUrl,
    ...(label ? { label } : {}),
    attachedAt: input.attachedAt ?? new Date().toISOString(),
    attachedByUserId: input.attachedByUserId,
  };
}
