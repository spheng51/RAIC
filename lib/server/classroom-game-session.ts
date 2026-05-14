import 'server-only';

import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { listRecentClassroomSessions } from '@/lib/db/repositories/sessions';
import { findUserById } from '@/lib/db/repositories/users';
import { getDataPath } from '@/lib/server/data-root';
import { ensureDirPath, writeJsonFileAtomic } from '@/lib/server/json-file';
import { readClassroom } from '@/lib/server/classroom-storage';
import type { SessionRecord } from '@/lib/db/schema';
import type {
  ClassroomGameSessionPayload,
  ClassroomGameSessionPlayer,
  ClassroomGameSessionState,
} from '@/lib/types/classroom-game-session';

const CLASSROOM_GAME_SESSIONS_DIR = getDataPath('classroom-game-sessions');
const gameSessionWriteLocks = new Map<string, Promise<void>>();
export const GAME_ROUND_READY_COUNTDOWN_MS = 45_000;
export const GAME_ROUND_DURATION_MS = 5 * 60_000;
export const GAME_ROUND_THRESHOLD_RATIO = 0.8;

function resolveGameSessionPath(classroomId: string) {
  return `${CLASSROOM_GAME_SESSIONS_DIR}/${classroomId}.json`;
}

function nowIso() {
  return new Date().toISOString();
}

function toDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addMs(date: Date, ms: number) {
  return new Date(date.getTime() + ms).toISOString();
}

function thresholdForCount(count: number) {
  return count > 0 ? Math.max(1, Math.ceil(count * GAME_ROUND_THRESHOLD_RATIO)) : 0;
}

function getEligiblePlayerIds(state: ClassroomGameSessionState) {
  return new Set(state.eligibleSessionIds ?? []);
}

function countEligiblePlayers(
  state: ClassroomGameSessionState,
  predicate: (player: ClassroomGameSessionPlayer) => boolean,
) {
  const eligibleIds = getEligiblePlayerIds(state);
  if (eligibleIds.size === 0) return 0;

  return Object.values(state.players).filter(
    (player) => eligibleIds.has(player.sessionId) && predicate(player),
  ).length;
}

function normalizePlayer(
  state: ClassroomGameSessionState,
  player: ClassroomGameSessionPlayer,
): ClassroomGameSessionPlayer {
  const eligible = getEligiblePlayerIds(state).has(player.sessionId);
  const late =
    player.late ??
    Boolean(state.roundId && state.status !== 'idle' && state.status !== 'completed' && !eligible);

  return {
    ...player,
    eligible,
    late: eligible ? false : late,
  };
}

function normalizeGameSessionState(
  classroomId: string,
  raw?: Partial<ClassroomGameSessionState>,
): ClassroomGameSessionState {
  const state = {
    ...createDefaultGameSessionState(classroomId),
    ...raw,
    classroomId,
  };

  state.eligibleSessionIds = Array.isArray(state.eligibleSessionIds)
    ? state.eligibleSessionIds.filter(
        (sessionId): sessionId is string => typeof sessionId === 'string',
      )
    : [];
  state.players = Object.fromEntries(
    Object.values(state.players ?? {}).map((player) => [
      player.sessionId,
      normalizePlayer(state, player),
    ]),
  );

  return state;
}

function createDefaultGameSessionState(classroomId: string): ClassroomGameSessionState {
  const now = nowIso();
  return {
    classroomId,
    roundId: null,
    roundNumber: 0,
    mode: 'both',
    status: 'idle',
    pausedStatus: null,
    controllerSessionId: null,
    latestSharedState: null,
    eligibleSessionIds: [],
    armedAt: null,
    autoStartAt: null,
    liveStartedAt: null,
    autoEndAt: null,
    pausedAt: null,
    players: {},
    createdAt: now,
    updatedAt: now,
  };
}

async function withGameSessionWriteLock<T>(
  classroomId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = gameSessionWriteLocks.get(classroomId) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  gameSessionWriteLocks.set(
    classroomId,
    previous.then(
      () => current,
      () => current,
    ),
  );

  await previous.catch(() => undefined);

  try {
    return await operation();
  } finally {
    releaseCurrent();
    if (gameSessionWriteLocks.get(classroomId) === current) {
      gameSessionWriteLocks.delete(classroomId);
    }
  }
}

export async function readClassroomGameSessionState(
  classroomId: string,
): Promise<ClassroomGameSessionState> {
  await ensureDirPath(CLASSROOM_GAME_SESSIONS_DIR);
  try {
    const content = await fs.readFile(resolveGameSessionPath(classroomId), 'utf-8');
    return normalizeGameSessionState(classroomId, JSON.parse(content) as ClassroomGameSessionState);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createDefaultGameSessionState(classroomId);
    }
    throw error;
  }
}

export async function updateClassroomGameSessionState(
  classroomId: string,
  updater: (state: ClassroomGameSessionState) => ClassroomGameSessionState,
): Promise<ClassroomGameSessionState> {
  return withGameSessionWriteLock(classroomId, async () => {
    const current = await readClassroomGameSessionState(classroomId);
    const next = {
      ...updater(current),
      classroomId,
      updatedAt: nowIso(),
    };
    await writeJsonFileAtomic(resolveGameSessionPath(classroomId), next);
    return next;
  });
}

function buildPlayerFromSession(
  session: SessionRecord,
  displayName: string,
  state: ClassroomGameSessionState,
  existing?: ClassroomGameSessionPlayer,
): ClassroomGameSessionPlayer {
  const timestamp = nowIso();
  const eligible = getEligiblePlayerIds(state).has(session.id);
  const late =
    existing?.late ??
    Boolean(state.roundId && state.status !== 'idle' && state.status !== 'completed' && !eligible);
  return {
    sessionId: session.id,
    userId: session.userId,
    displayName,
    role: session.role,
    ready: existing?.ready ?? false,
    score: existing?.score ?? 0,
    progress: existing?.progress ?? 0,
    completed: existing?.completed ?? false,
    bridgeReady: existing?.bridgeReady ?? false,
    eligible,
    late: eligible ? false : late,
    lastEventAt: existing?.lastEventAt ?? timestamp,
    lastSeenAt: session.lastSeenAt,
  };
}

export function canSessionManageGameSession(session: SessionRecord) {
  return session.kind === 'web' && session.role !== 'student';
}

export function canSessionSubmitGameEvent(
  state: ClassroomGameSessionState,
  session: SessionRecord,
  eventType?: string,
) {
  if (canSessionManageGameSession(session)) {
    return true;
  }

  if (session.kind !== 'classroom' || session.role !== 'student') {
    return false;
  }

  if (eventType === 'bridge_ready') {
    return true;
  }

  if (eventType === 'ready') {
    return state.status === 'arming' || state.status === 'live';
  }

  if (eventType === 'score' || eventType === 'progress' || eventType === 'complete') {
    return state.status === 'live';
  }

  if (eventType === 'shared_state' || eventType === 'control_input') {
    return (
      state.status === 'live' &&
      state.mode !== 'leaderboard' &&
      state.controllerSessionId === session.id
    );
  }

  return false;
}

export async function getClassroomGameSessionPayload(
  classroomId: string,
  session: SessionRecord,
): Promise<ClassroomGameSessionPayload | null> {
  const classroom = await readClassroom(classroomId);
  if (!classroom) {
    return null;
  }

  let state = await readClassroomGameSessionState(classroomId);
  const advancedState = advanceGameSessionState(state);
  if (advancedState !== state) {
    state = await updateClassroomGameSessionState(classroomId, advanceGameSessionState);
  }

  const sessions = await listRecentClassroomSessions(classroomId);
  const users = await Promise.all(sessions.map((entry) => findUserById(entry.userId)));
  const activePlayers = sessions.map((entry, index) =>
    buildPlayerFromSession(
      entry,
      users[index]?.displayName || 'Student',
      state,
      state.players[entry.id],
    ),
  );
  const activeSessionIds = new Set(activePlayers.map((player) => player.sessionId));
  const allPlayers = {
    ...state.players,
    ...Object.fromEntries(activePlayers.map((player) => [player.sessionId, player])),
  };
  const participants = Object.values(allPlayers).sort(
    (left, right) =>
      Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt) ||
      left.displayName.localeCompare(right.displayName),
  );
  const activeStudentParticipants = activePlayers.filter((player) => player.role === 'student');
  const leaderboard = [...participants.filter((player) => player.role === 'student')].sort(
    (left, right) =>
      right.score - left.score ||
      right.progress - left.progress ||
      Date.parse(left.lastEventAt) - Date.parse(right.lastEventAt),
  );
  const controllerSessionId =
    state.controllerSessionId && activeSessionIds.has(state.controllerSessionId)
      ? state.controllerSessionId
      : null;
  const viewerCanManage = canSessionManageGameSession(session);
  const eligibleCount = state.eligibleSessionIds.length;
  const readyCount = countEligiblePlayers(state, (player) => player.ready);
  const completedCount = countEligiblePlayers(state, (player) => player.completed);
  const readyThreshold = thresholdForCount(eligibleCount);
  const completionThreshold = thresholdForCount(eligibleCount);
  const now = new Date();
  const serverNow = now.toISOString();
  const pausedAt = toDate(state.pausedAt);
  const phaseReferenceDate = state.status === 'paused' && pausedAt ? pausedAt : now;
  const phaseEndsAt =
    state.status === 'arming'
      ? state.autoStartAt
      : state.status === 'live'
        ? state.autoEndAt
        : state.status === 'paused' && state.pausedStatus === 'arming'
          ? state.autoStartAt
          : state.status === 'paused' && state.pausedStatus === 'live'
            ? state.autoEndAt
            : null;
  const phaseEndDate = toDate(phaseEndsAt);
  const viewerPlayer = allPlayers[session.id];

  return {
    ...state,
    roomVersion: classroom.roomVersion,
    controllerSessionId,
    players: allPlayers,
    participants: activeStudentParticipants,
    participantCount: activeStudentParticipants.length,
    leaderboard,
    viewerSessionId: session.id,
    viewerRole: session.role,
    viewerKind: session.kind,
    viewerCanManage,
    viewerCanSubmit: canSessionSubmitGameEvent(state, session),
    viewerIsController: controllerSessionId === session.id,
    multiplayerSupported: participants.some((player) => player.bridgeReady),
    eligibleCount,
    readyCount,
    readyThreshold,
    completedCount,
    completionThreshold,
    viewerIsLate: viewerPlayer?.late ?? false,
    phaseEndsAt,
    phaseRemainingMs: phaseEndDate
      ? Math.max(0, phaseEndDate.getTime() - phaseReferenceDate.getTime())
      : null,
    serverNow,
  };
}

export function getClassroomGameSessionFingerprint(payload: ClassroomGameSessionPayload) {
  return JSON.stringify({
    roundId: payload.roundId,
    roundNumber: payload.roundNumber,
    mode: payload.mode,
    status: payload.status,
    pausedStatus: payload.pausedStatus,
    controllerSessionId: payload.controllerSessionId,
    latestSharedState: payload.latestSharedState,
    eligibleSessionIds: payload.eligibleSessionIds,
    armedAt: payload.armedAt,
    autoStartAt: payload.autoStartAt,
    liveStartedAt: payload.liveStartedAt,
    autoEndAt: payload.autoEndAt,
    pausedAt: payload.pausedAt,
    participantCount: payload.participantCount,
    readyCount: payload.readyCount,
    completedCount: payload.completedCount,
    phaseRemainingMs: payload.phaseRemainingMs,
    viewerSessionId: payload.viewerSessionId,
    viewerCanManage: payload.viewerCanManage,
    viewerCanSubmit: payload.viewerCanSubmit,
    viewerIsController: payload.viewerIsController,
    multiplayerSupported: payload.multiplayerSupported,
    players: payload.leaderboard.map((player) => ({
      sessionId: player.sessionId,
      displayName: player.displayName,
      ready: player.ready,
      score: player.score,
      progress: player.progress,
      completed: player.completed,
      bridgeReady: player.bridgeReady,
      eligible: player.eligible,
      late: player.late,
      lastEventAt: player.lastEventAt,
    })),
  });
}

export function startNewGameRound(
  state: ClassroomGameSessionState,
  eligiblePlayers: ClassroomGameSessionPlayer[] = [],
  now: Date = new Date(),
): ClassroomGameSessionState {
  const roundNumber = state.roundNumber + 1;
  const eligibleSessionIds = eligiblePlayers.map((player) => player.sessionId);
  const nextPlayers = {
    ...state.players,
    ...Object.fromEntries(eligiblePlayers.map((player) => [player.sessionId, player])),
  };
  const eligibleIds = new Set(eligibleSessionIds);
  const resetPlayers = Object.fromEntries(
    Object.values(nextPlayers).map((player) => [
      player.sessionId,
      {
        ...player,
        ready: false,
        score: 0,
        progress: 0,
        completed: false,
        eligible: eligibleIds.has(player.sessionId),
        late: eligibleIds.has(player.sessionId) ? false : Boolean(state.roundId),
        lastEventAt: now.toISOString(),
      },
    ]),
  );

  return {
    ...state,
    roundId: randomUUID(),
    roundNumber,
    status: 'arming',
    pausedStatus: null,
    controllerSessionId: null,
    latestSharedState: null,
    eligibleSessionIds,
    armedAt: now.toISOString(),
    autoStartAt: addMs(now, GAME_ROUND_READY_COUNTDOWN_MS),
    liveStartedAt: null,
    autoEndAt: null,
    pausedAt: null,
    players: resetPlayers,
  };
}

export function startLiveGameRound(
  state: ClassroomGameSessionState,
  now: Date = new Date(),
): ClassroomGameSessionState {
  if (!state.roundId || state.status === 'live' || state.status === 'completed') {
    return state;
  }

  return {
    ...state,
    status: 'live',
    pausedStatus: null,
    liveStartedAt: state.liveStartedAt ?? now.toISOString(),
    autoEndAt: state.autoEndAt ?? addMs(now, GAME_ROUND_DURATION_MS),
    pausedAt: null,
  };
}

export function completeGameRound(state: ClassroomGameSessionState): ClassroomGameSessionState {
  if (!state.roundId || state.status === 'idle' || state.status === 'completed') {
    return state;
  }

  return {
    ...state,
    status: 'completed',
    pausedStatus: null,
    pausedAt: null,
  };
}

export function pauseGameRound(
  state: ClassroomGameSessionState,
  now: Date = new Date(),
): ClassroomGameSessionState {
  if (state.status !== 'arming' && state.status !== 'live') {
    return state;
  }

  return {
    ...state,
    status: 'paused',
    pausedStatus: state.status,
    pausedAt: now.toISOString(),
  };
}

export function resumeGameRound(
  state: ClassroomGameSessionState,
  now: Date = new Date(),
): ClassroomGameSessionState {
  if (state.status !== 'paused') {
    return state;
  }

  const pausedAt = toDate(state.pausedAt);
  const pausedMs = pausedAt ? Math.max(0, now.getTime() - pausedAt.getTime()) : 0;
  const shiftDeadline = (value: string | null) => {
    const date = toDate(value);
    return date ? addMs(date, pausedMs) : value;
  };

  return {
    ...state,
    status: state.pausedStatus ?? 'live',
    pausedStatus: null,
    autoStartAt:
      state.pausedStatus === 'arming' ? shiftDeadline(state.autoStartAt) : state.autoStartAt,
    autoEndAt: state.pausedStatus === 'live' ? shiftDeadline(state.autoEndAt) : state.autoEndAt,
    pausedAt: null,
  };
}

export function resetGameRound(state: ClassroomGameSessionState): ClassroomGameSessionState {
  return {
    ...state,
    roundId: null,
    status: 'idle',
    pausedStatus: null,
    controllerSessionId: null,
    latestSharedState: null,
    eligibleSessionIds: [],
    armedAt: null,
    autoStartAt: null,
    liveStartedAt: null,
    autoEndAt: null,
    pausedAt: null,
    players: {},
  };
}

export function advanceGameSessionState(
  state: ClassroomGameSessionState,
  now: Date = new Date(),
): ClassroomGameSessionState {
  if (state.status === 'arming') {
    const eligibleCount = state.eligibleSessionIds.length;
    const readyThreshold = thresholdForCount(eligibleCount);
    const readyCount = countEligiblePlayers(state, (player) => player.ready);
    const deadline = toDate(state.autoStartAt);
    const readyThresholdMet = eligibleCount > 0 && readyCount >= readyThreshold;
    const countdownExpired = Boolean(deadline && deadline.getTime() <= now.getTime());

    if (readyThresholdMet || countdownExpired) {
      return startLiveGameRound(state, now);
    }
  }

  if (state.status === 'live') {
    const eligibleCount = state.eligibleSessionIds.length;
    const completionThreshold = thresholdForCount(eligibleCount);
    const completedCount = countEligiblePlayers(state, (player) => player.completed);
    const deadline = toDate(state.autoEndAt);
    const completionThresholdMet = eligibleCount > 0 && completedCount >= completionThreshold;
    const roundExpired = Boolean(deadline && deadline.getTime() <= now.getTime());

    if (completionThresholdMet || roundExpired) {
      return completeGameRound(state);
    }
  }

  return state;
}
