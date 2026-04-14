export type ParticipantActivityState = 'active' | 'just-left' | 'idle';

export interface ParticipantPresenceSortable {
  readonly isSpeaking?: boolean;
  readonly isController?: boolean;
  readonly lastSeenAt?: string | null;
  readonly displayName?: string;
  readonly name?: string;
}

interface ParticipantPresenceSortOptions {
  readonly nowMs?: number;
  readonly getIsSpeaking?: (participant: ParticipantPresenceSortable) => boolean;
  readonly getIsController?: (participant: ParticipantPresenceSortable) => boolean;
}

const ACTIVE_PARTICIPANT_WINDOW_MS = 60_000;
const JUST_LEFT_PARTICIPANT_WINDOW_MS = 5 * 60_000;

function parseParticipantLastSeen(lastSeenAt: string | null | undefined): number | null {
  if (!lastSeenAt) {
    return null;
  }

  const parsed = Date.parse(lastSeenAt);
  return Number.isNaN(parsed) ? null : parsed;
}

export function getParticipantActivity(
  lastSeenAt: string | null | undefined,
  nowMs = Date.now(),
): ParticipantActivityState {
  const seenAt = parseParticipantLastSeen(lastSeenAt);

  if (seenAt === null) {
    return 'idle';
  }

  const inactiveMs = Math.max(0, nowMs - seenAt);

  if (inactiveMs <= ACTIVE_PARTICIPANT_WINDOW_MS) {
    return 'active';
  }

  if (inactiveMs <= JUST_LEFT_PARTICIPANT_WINDOW_MS) {
    return 'just-left';
  }

  return 'idle';
}

export function getParticipantRelativeActivityText(
  lastSeenAt: string | null | undefined,
  nowMs = Date.now(),
): string {
  const seenAt = parseParticipantLastSeen(lastSeenAt);

  if (seenAt === null) {
    return 'unknown';
  }

  const inactiveMs = Math.max(0, nowMs - seenAt);
  const inactiveMinutes = Math.floor(inactiveMs / 60_000);

  if (inactiveMs < 30_000) {
    return 'just now';
  }

  if (inactiveMinutes < 60) {
    return `${inactiveMinutes}m ago`;
  }

  const inactiveHours = Math.floor(inactiveMinutes / 60);
  if (inactiveHours < 24) {
    return `${inactiveHours}h ago`;
  }

  const inactiveDays = Math.floor(inactiveHours / 24);
  return inactiveDays < 7
    ? `${inactiveDays}d ago`
    : `${Math.floor(inactiveDays / 7)}w ago`;
}

export function getParticipantActivityLabel(
  lastSeenAt: string | null | undefined,
  nowMs = Date.now(),
): { state: ParticipantActivityState; label: string } {
  const state = getParticipantActivity(lastSeenAt, nowMs);
  const relative = getParticipantRelativeActivityText(lastSeenAt, nowMs);

  if (state === 'active') {
    return {
      state,
      label: `active - ${relative}`,
    };
  }

  if (state === 'just-left') {
    return {
      state,
      label: `just-left - ${relative}`,
    };
  }

  return {
    state,
    label: `idle - ${relative}`,
  };
}

export function sortParticipantsByPresence<T extends ParticipantPresenceSortable>(
  participants: readonly T[],
  options: ParticipantPresenceSortOptions = {},
): T[] {
  const nowMs = options.nowMs ?? Date.now();
  const isSpeaking = options.getIsSpeaking ?? ((participant) => Boolean(participant.isSpeaking));
  const isController = options.getIsController ?? ((participant) => Boolean(participant.isController));
  const getLastSeenAt = (participant: T) => participant.lastSeenAt;

  const activityOrder: Record<ParticipantActivityState, number> = {
    active: 0,
    'just-left': 1,
    idle: 2,
  };

  const getName = (participant: T) => {
    if ('displayName' in participant && typeof participant.displayName === 'string') {
      return participant.displayName;
    }

    if ('name' in participant && typeof participant.name === 'string') {
      return participant.name;
    }

    return '';
  };

  return [...participants].sort((a, b) => {
    const aIsSpeaking = isSpeaking(a);
    const bIsSpeaking = isSpeaking(b);

    if (aIsSpeaking !== bIsSpeaking) {
      return aIsSpeaking ? -1 : 1;
    }

    const aIsController = isController(a);
    const bIsController = isController(b);

    if (aIsController !== bIsController) {
      return aIsController ? -1 : 1;
    }

    const aActivity = getParticipantActivity(getLastSeenAt(a), nowMs);
    const bActivity = getParticipantActivity(getLastSeenAt(b), nowMs);

    const activityDiff = activityOrder[aActivity] - activityOrder[bActivity];
    if (activityDiff !== 0) {
      return activityDiff;
    }

    const aName = getName(a);
    const bName = getName(b);
    if (aName && bName) {
      return aName.localeCompare(bName);
    }

    return 0;
  });
}
