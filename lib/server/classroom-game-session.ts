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

function resolveGameSessionPath(classroomId: string) {
  return `${CLASSROOM_GAME_SESSIONS_DIR}/${classroomId}.json`;
}

function nowIso() {
  return new Date().toISOString();
}

function createDefaultGameSessionState(classroomId: string): ClassroomGameSessionState {
  const now = nowIso();
  return {
    classroomId,
    roundId: null,
    roundNumber: 0,
    mode: 'both',
    status: 'idle',
    controllerSessionId: null,
    latestSharedState: null,
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
    return {
      ...createDefaultGameSessionState(classroomId),
      ...(JSON.parse(content) as ClassroomGameSessionState),
      classroomId,
    };
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
  existing?: ClassroomGameSessionPlayer,
): ClassroomGameSessionPlayer {
  const timestamp = nowIso();
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

  if (eventType === 'shared_state' || eventType === 'control_input') {
    return state.mode !== 'leaderboard' && state.controllerSessionId === session.id;
  }

  return true;
}

export async function getClassroomGameSessionPayload(
  classroomId: string,
  session: SessionRecord,
): Promise<ClassroomGameSessionPayload | null> {
  const classroom = await readClassroom(classroomId);
  if (!classroom) {
    return null;
  }

  const state = await readClassroomGameSessionState(classroomId);
  const sessions = await listRecentClassroomSessions(classroomId);
  const users = await Promise.all(sessions.map((entry) => findUserById(entry.userId)));
  const activePlayers = sessions.map((entry, index) =>
    buildPlayerFromSession(entry, users[index]?.displayName || 'Student', state.players[entry.id]),
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
  const studentParticipants = participants.filter((player) => player.role === 'student');
  const leaderboard = [...studentParticipants].sort(
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

  return {
    ...state,
    roomVersion: classroom.roomVersion,
    controllerSessionId,
    players: allPlayers,
    participants: studentParticipants,
    participantCount: studentParticipants.length,
    leaderboard,
    viewerSessionId: session.id,
    viewerRole: session.role,
    viewerKind: session.kind,
    viewerCanManage,
    viewerCanSubmit: canSessionSubmitGameEvent(state, session),
    viewerIsController: controllerSessionId === session.id,
    multiplayerSupported: participants.some((player) => player.bridgeReady),
  };
}

export function getClassroomGameSessionFingerprint(payload: ClassroomGameSessionPayload) {
  return JSON.stringify({
    roundId: payload.roundId,
    roundNumber: payload.roundNumber,
    mode: payload.mode,
    status: payload.status,
    controllerSessionId: payload.controllerSessionId,
    latestSharedState: payload.latestSharedState,
    participantCount: payload.participantCount,
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
      lastEventAt: player.lastEventAt,
    })),
  });
}

export function startNewGameRound(state: ClassroomGameSessionState): ClassroomGameSessionState {
  const roundNumber = state.roundNumber + 1;
  const resetPlayers = Object.fromEntries(
    Object.values(state.players).map((player) => [
      player.sessionId,
      {
        ...player,
        ready: false,
        score: 0,
        progress: 0,
        completed: false,
        lastEventAt: nowIso(),
      },
    ]),
  );

  return {
    ...state,
    roundId: randomUUID(),
    roundNumber,
    status: 'live',
    players: resetPlayers,
  };
}
