import { NextRequest, NextResponse } from 'next/server';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import { requireRequestRole } from '@/lib/auth/authorize';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  API_ERROR_CODES,
} from '@/lib/server/api-response';
import { recordAuditEvent } from '@/lib/server/audit-log';
import {
  buildClassroomRoomEventActor,
  recordClassroomRoomEvent,
} from '@/lib/server/classroom-room-events';
import { isValidClassroomId, updateClassroom } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';
import { buildManualZoomLiveMeeting, validateZoomMeetingUrl } from '@/lib/utils/live-meeting';

interface LiveMeetingBody {
  joinUrl?: unknown;
  label?: unknown;
}

const log = createLogger('Classroom Live Meeting');
const MAX_LIVE_MEETING_LABEL_LENGTH = 120;

function normalizeLiveMeetingLabel(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_LIVE_MEETING_LABEL_LENGTH) : undefined;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidClassroomId(id)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Invalid classroom id',
    );
  }

  const access = await requireClassroomAccess(request, id);
  if (access instanceof NextResponse) {
    return access;
  }

  return apiSuccessWithRequestSession(request, {
    liveMeeting: access.classroom.stage.liveMeeting ?? null,
  });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const { id } = await params;
  if (!isValidClassroomId(id)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Invalid classroom id',
    );
  }

  const access = await requireClassroomAccess(request, id);
  if (access instanceof NextResponse) {
    return access;
  }

  if (access.source !== 'web' || access.auth.session.role === 'student') {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.FORBIDDEN,
      403,
      'Only teacher web sessions can update the live meeting link',
    );
  }

  const body = (await request.json().catch(() => null)) as LiveMeetingBody | null;
  const validation = validateZoomMeetingUrl(body?.joinUrl);
  if (!validation.ok) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      validation.error,
    );
  }

  const previousLiveMeeting = access.classroom.stage.liveMeeting ?? null;
  const liveMeeting = buildManualZoomLiveMeeting({
    joinUrl: validation.url,
    label: normalizeLiveMeetingLabel(body?.label),
    attachedByUserId: auth.user.id,
  });

  const updated = await updateClassroom(id, (current) => ({
    ...current,
    stage: {
      ...current.stage,
      liveMeeting,
    },
  }));

  if (!updated) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      404,
      'Classroom not found',
    );
  }

  const action = previousLiveMeeting
    ? 'classroom.live_meeting.updated'
    : 'classroom.live_meeting.attached';

  await recordAuditEvent({
    organizationId: auth.session.organizationId,
    userId: auth.user.id,
    actorRole: auth.session.role,
    action,
    resourceType: 'classroom',
    resourceId: id,
    metadata: {
      provider: liveMeeting.provider,
      source: liveMeeting.source,
      label: liveMeeting.label ?? null,
      previousAttached: Boolean(previousLiveMeeting),
      host: new URL(liveMeeting.joinUrl).hostname,
      actorSessionId: auth.session.id,
    },
  });

  log.info('Live meeting link saved', {
    classroomId: id,
    actorSessionId: auth.session.id,
    actorUserId: auth.user.id,
    result: previousLiveMeeting ? 'updated' : 'attached',
  });

  if (updated.roomVersion !== access.classroom.roomVersion) {
    await recordClassroomRoomEvent({
      classroomId: id,
      roomVersion: updated.roomVersion,
      kind: 'live_meeting.updated',
      actor: buildClassroomRoomEventActor({
        sessionId: auth.session.id,
        userId: auth.user.id,
        role: auth.session.role,
        kind: 'web',
      }),
      metadata: {
        action,
        provider: liveMeeting.provider,
      },
    });
  }

  return apiSuccessWithRequestSession(request, {
    liveMeeting,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const { id } = await params;
  if (!isValidClassroomId(id)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Invalid classroom id',
    );
  }

  const access = await requireClassroomAccess(request, id);
  if (access instanceof NextResponse) {
    return access;
  }

  if (access.source !== 'web' || access.auth.session.role === 'student') {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.FORBIDDEN,
      403,
      'Only teacher web sessions can remove the live meeting link',
    );
  }

  const previousLiveMeeting = access.classroom.stage.liveMeeting ?? null;
  const updated = await updateClassroom(id, (current) => {
    const { liveMeeting: _removed, ...stageWithoutLiveMeeting } = current.stage;
    return {
      ...current,
      stage: stageWithoutLiveMeeting,
    };
  });

  if (!updated) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      404,
      'Classroom not found',
    );
  }

  await recordAuditEvent({
    organizationId: auth.session.organizationId,
    userId: auth.user.id,
    actorRole: auth.session.role,
    action: 'classroom.live_meeting.removed',
    resourceType: 'classroom',
    resourceId: id,
    metadata: {
      provider: previousLiveMeeting?.provider ?? 'zoom',
      previousAttached: Boolean(previousLiveMeeting),
      actorSessionId: auth.session.id,
    },
  });

  log.info('Live meeting link removed', {
    classroomId: id,
    actorSessionId: auth.session.id,
    actorUserId: auth.user.id,
    hadLiveMeeting: Boolean(previousLiveMeeting),
  });

  if (updated.roomVersion !== access.classroom.roomVersion) {
    await recordClassroomRoomEvent({
      classroomId: id,
      roomVersion: updated.roomVersion,
      kind: 'live_meeting.updated',
      actor: buildClassroomRoomEventActor({
        sessionId: auth.session.id,
        userId: auth.user.id,
        role: auth.session.role,
        kind: 'web',
      }),
      metadata: {
        action: 'classroom.live_meeting.removed',
        provider: previousLiveMeeting?.provider ?? 'zoom',
      },
    });
  }

  return apiSuccessWithRequestSession(request, {
    liveMeeting: null,
  });
}
