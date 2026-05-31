import type {
  ScheduledClassEvent,
  ScheduledClassEventInput,
  ScheduledClassMultiplayerGame,
  ScheduledClassMultiplayerGameInput,
} from '@/lib/types/scheduled-classes';

export const MAX_VISIBLE_SCHEDULED_CLASSES = 5;
export const MAX_SCHEDULED_CLASS_TITLE_LENGTH = 120;
export const MAX_SCHEDULED_CLASS_DURATION_MINUTES = 24 * 60;
export const DEFAULT_SCHEDULED_CLASS_DURATION_MINUTES = 60;
export const SCHEDULED_MULTIPLAYER_INVITE_GRACE_MINUTES = 60;

export interface NormalizedScheduledClassEventInput {
  title: string;
  startsAt: string;
  durationMinutes?: number;
  classroomId?: string;
  multiplayerGame?: ScheduledClassMultiplayerGame;
}

export type ScheduledClassValidationResult =
  | {
      ok: true;
      value: NormalizedScheduledClassEventInput;
    }
  | {
      ok: false;
      error: string;
    };

function parseDate(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function normalizeMultiplayerGameInput(
  input: ScheduledClassMultiplayerGameInput | null | undefined,
): ScheduledClassMultiplayerGame | undefined {
  if (!input?.enabled) {
    return undefined;
  }

  return {
    enabled: true,
    mode:
      input.mode === 'leaderboard' || input.mode === 'shared-control' || input.mode === 'both'
        ? input.mode
        : 'both',
    linkPolicy: 'always_open',
    ...(typeof input.inviteExpiresAt === 'string' && input.inviteExpiresAt.trim()
      ? { inviteExpiresAt: input.inviteExpiresAt.trim() }
      : {}),
    ...(typeof input.joinTokenId === 'string' && input.joinTokenId.trim()
      ? { joinTokenId: input.joinTokenId.trim() }
      : {}),
    ...(typeof input.inviteUrl === 'string' && input.inviteUrl.trim()
      ? { inviteUrl: input.inviteUrl.trim() }
      : {}),
  };
}

export function getScheduledClassInviteExpiresAt(input: {
  startsAt: string;
  durationMinutes?: number | null;
}): string {
  const start = parseDate(input.startsAt);
  const durationMinutes =
    input.durationMinutes && input.durationMinutes > 0
      ? input.durationMinutes
      : DEFAULT_SCHEDULED_CLASS_DURATION_MINUTES;
  const startMs = start?.getTime();
  const baseMs = Number.isFinite(startMs) ? startMs! : Date.now();
  return new Date(
    baseMs + (durationMinutes + SCHEDULED_MULTIPLAYER_INVITE_GRACE_MINUTES) * 60_000,
  ).toISOString();
}

export function normalizeScheduledClassInput(
  input: Partial<ScheduledClassEventInput>,
  options: { requireFutureStart?: boolean; now?: Date } = {},
): ScheduledClassValidationResult {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) {
    return { ok: false, error: 'Class title is required.' };
  }

  const startsAt = typeof input.startsAt === 'string' ? input.startsAt.trim() : '';
  const startsAtDate = startsAt ? parseDate(startsAt) : null;
  if (!startsAtDate) {
    return { ok: false, error: 'Choose a valid start date and time.' };
  }

  if (options.requireFutureStart) {
    const now = options.now ?? new Date();
    if (startsAtDate.getTime() <= now.getTime()) {
      return { ok: false, error: 'Choose a future start time.' };
    }
  }

  const rawDuration = input.durationMinutes;
  let durationMinutes: number | undefined;
  if (rawDuration !== null && rawDuration !== undefined) {
    const numericDuration = Number(rawDuration);
    if (
      !Number.isFinite(numericDuration) ||
      numericDuration < 1 ||
      numericDuration > MAX_SCHEDULED_CLASS_DURATION_MINUTES
    ) {
      return { ok: false, error: 'Duration must be between 1 minute and 24 hours.' };
    }
    durationMinutes = Math.floor(numericDuration);
  }

  const classroomId =
    typeof input.classroomId === 'string' && input.classroomId.trim()
      ? input.classroomId.trim()
      : undefined;
  const multiplayerGame = normalizeMultiplayerGameInput(input.multiplayerGame);

  return {
    ok: true,
    value: {
      title: title.slice(0, MAX_SCHEDULED_CLASS_TITLE_LENGTH),
      startsAt: startsAtDate.toISOString(),
      ...(durationMinutes ? { durationMinutes } : {}),
      ...(classroomId ? { classroomId } : {}),
      ...(multiplayerGame ? { multiplayerGame } : {}),
    },
  };
}

export function sortScheduledClassEvents(
  events: readonly ScheduledClassEvent[],
): ScheduledClassEvent[] {
  return [...events].sort((left, right) => {
    const leftTime = Date.parse(left.startsAt);
    const rightTime = Date.parse(right.startsAt);
    const safeLeft = Number.isFinite(leftTime) ? leftTime : Number.POSITIVE_INFINITY;
    const safeRight = Number.isFinite(rightTime) ? rightTime : Number.POSITIVE_INFINITY;
    return safeLeft - safeRight || left.title.localeCompare(right.title);
  });
}

export function mergeScheduledClassEvent(
  events: readonly ScheduledClassEvent[],
  nextEvent: ScheduledClassEvent,
): ScheduledClassEvent[] {
  let replaced = false;
  const merged = events.map((event) => {
    if (event.id !== nextEvent.id) {
      return event;
    }
    replaced = true;
    return nextEvent;
  });

  return sortScheduledClassEvents(replaced ? merged : [...merged, nextEvent]);
}

export function getUpcomingScheduledClassEvents(
  events: readonly ScheduledClassEvent[],
  options: { now?: Date; limit?: number } = {},
): ScheduledClassEvent[] {
  const nowTime = (options.now ?? new Date()).getTime();
  const limit = options.limit ?? MAX_VISIBLE_SCHEDULED_CLASSES;

  return sortScheduledClassEvents(events)
    .filter((event) => {
      const startsAt = Date.parse(event.startsAt);
      return Number.isFinite(startsAt) && startsAt >= nowTime;
    })
    .slice(0, limit);
}
