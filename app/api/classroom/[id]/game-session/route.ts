import { type NextRequest, NextResponse } from 'next/server';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  API_ERROR_CODES,
} from '@/lib/server/api-response';
import {
  canSessionManageGameSession,
  canSessionSubmitGameEvent,
  getClassroomGameSessionPayload,
  readClassroomGameSessionState,
  startNewGameRound,
  updateClassroomGameSessionState,
} from '@/lib/server/classroom-game-session';
import {
  buildClassroomRoomEventActor,
  recordClassroomRoomEvent,
} from '@/lib/server/classroom-room-events';
import { isValidClassroomId } from '@/lib/server/classroom-storage';
import type {
  ClassroomGameSessionMode,
  ClassroomGameStudentEventType,
  ClassroomGameTeacherAction,
} from '@/lib/types/classroom-game-session';

interface GameSessionBody {
  action?: ClassroomGameTeacherAction;
  event?: ClassroomGameStudentEventType;
  mode?: ClassroomGameSessionMode;
  targetSessionId?: string;
  score?: number;
  progress?: number;
  state?: Record<string, unknown>;
  input?: Record<string, unknown>;
}

const TEACHER_ACTIONS = new Set<ClassroomGameTeacherAction>([
  'start_round',
  'pause',
  'resume',
  'reset',
  'complete',
  'set_mode',
  'assign_controller',
  'clear_controller',
]);
const STUDENT_EVENTS = new Set<ClassroomGameStudentEventType>([
  'ready',
  'progress',
  'score',
  'complete',
  'shared_state',
  'control_input',
  'bridge_ready',
]);

function clampProgress(value: unknown) {
  const progress = Number(value);
  return Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : undefined;
}

function normalizeScore(value: unknown) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.floor(score)) : undefined;
}

function isMode(value: unknown): value is ClassroomGameSessionMode {
  return value === 'both' || value === 'leaderboard' || value === 'shared-control';
}

async function requireAccess(request: NextRequest, classroomId: string) {
  if (!isValidClassroomId(classroomId)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Invalid classroom id',
    );
  }

  return requireClassroomAccess(request, classroomId);
}

async function emitGameSessionEvent(
  classroomId: string,
  access: Exclude<Awaited<ReturnType<typeof requireClassroomAccess>>, NextResponse>,
  metadata: Record<string, unknown>,
) {
  const payload = await getClassroomGameSessionPayload(classroomId, access.auth.session);
  await recordClassroomRoomEvent({
    classroomId,
    roomVersion: payload?.roomVersion ?? 0,
    kind: 'game_session.updated',
    actor: buildClassroomRoomEventActor({
      sessionId: access.auth.session.id,
      userId: access.auth.user.id,
      role: access.auth.session.role,
      kind: access.source,
    }),
    metadata,
  });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireAccess(request, id);
  if (access instanceof NextResponse) {
    return access;
  }

  const payload = await getClassroomGameSessionPayload(id, access.auth.session);
  if (!payload) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      404,
      'Classroom not found',
    );
  }

  return apiSuccessWithRequestSession(request, payload);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireAccess(request, id);
  if (access instanceof NextResponse) {
    return access;
  }

  if (!canSessionManageGameSession(access.auth.session)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.FORBIDDEN,
      403,
      'Only teachers can manage multiplayer game sessions.',
    );
  }

  const body = ((await request.json().catch(() => ({}))) ?? {}) as GameSessionBody;
  const action = body.action;
  if (!action || !TEACHER_ACTIONS.has(action)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Invalid game session action',
    );
  }

  const updated = await updateClassroomGameSessionState(id, (state) => {
    switch (action) {
      case 'start_round':
        return startNewGameRound(state);
      case 'pause':
        return { ...state, status: 'paused' };
      case 'resume':
        return { ...state, status: 'live' };
      case 'complete':
        return { ...state, status: 'completed' };
      case 'reset':
        return {
          ...state,
          roundId: null,
          status: 'idle',
          controllerSessionId: null,
          latestSharedState: null,
          players: {},
        };
      case 'set_mode':
        return isMode(body.mode) ? { ...state, mode: body.mode } : state;
      case 'assign_controller':
        return { ...state, controllerSessionId: body.targetSessionId?.trim() || null };
      case 'clear_controller':
        return { ...state, controllerSessionId: null };
      default:
        return state;
    }
  });

  await emitGameSessionEvent(id, access, {
    action,
    mode: updated.mode,
    targetSessionId: body.targetSessionId ?? null,
  });

  const payload = await getClassroomGameSessionPayload(id, access.auth.session);
  return apiSuccessWithRequestSession(request, { gameSession: payload });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireAccess(request, id);
  if (access instanceof NextResponse) {
    return access;
  }

  const body = ((await request.json().catch(() => ({}))) ?? {}) as GameSessionBody;
  const event = body.event;
  if (!event || !STUDENT_EVENTS.has(event)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Invalid game session event',
    );
  }

  const current = await readClassroomGameSessionState(id);
  if (!canSessionSubmitGameEvent(current, access.auth.session, event)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.FORBIDDEN,
      403,
      'This classroom session cannot submit that game event.',
    );
  }

  const updated = await updateClassroomGameSessionState(id, (state) => {
    const existing = state.players[access.auth.session.id];
    const timestamp = new Date().toISOString();
    const progress = clampProgress(body.progress);
    const score = normalizeScore(body.score);
    const player = {
      sessionId: access.auth.session.id,
      userId: access.auth.user.id,
      displayName: access.auth.user.displayName || 'Student',
      role: access.auth.session.role,
      ready: existing?.ready ?? false,
      score: existing?.score ?? 0,
      progress: existing?.progress ?? 0,
      completed: existing?.completed ?? false,
      bridgeReady: existing?.bridgeReady ?? false,
      lastEventAt: timestamp,
      lastSeenAt: timestamp,
    };

    if (event === 'ready') player.ready = true;
    if (event === 'bridge_ready') player.bridgeReady = true;
    if (score !== undefined) player.score = score;
    if (progress !== undefined) player.progress = progress;
    if (event === 'complete') {
      player.completed = true;
      player.progress = progress ?? 100;
      if (score !== undefined) player.score = score;
    }

    return {
      ...state,
      latestSharedState:
        event === 'shared_state' || event === 'control_input'
          ? (body.state ?? body.input ?? state.latestSharedState)
          : state.latestSharedState,
      players: {
        ...state.players,
        [player.sessionId]: player,
      },
    };
  });

  await emitGameSessionEvent(id, access, {
    event,
    status: updated.status,
    score: body.score ?? null,
    progress: body.progress ?? null,
  });

  const payload = await getClassroomGameSessionPayload(id, access.auth.session);
  return apiSuccessWithRequestSession(request, { gameSession: payload });
}
