import { NextRequest, NextResponse } from 'next/server';
import { createOpaqueToken, hashToken } from '@/lib/auth/session';
import { requireRequestRole } from '@/lib/auth/authorize';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import { createJoinTokenRecord } from '@/lib/db/repositories/join-tokens';
import { buildRequestOrigin, isValidClassroomId } from '@/lib/server/classroom-storage';
import { recordAuditEvent } from '@/lib/server/audit-log';
import { withRequestWebSession } from '@/lib/server/api-response';

export async function POST(request: NextRequest) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const body = (await request.json()) as {
    classroomId?: string;
    displayName?: string;
    expiresInMinutes?: number;
  };

  if (!body.classroomId || !isValidClassroomId(body.classroomId)) {
    return withRequestWebSession(
      request,
      NextResponse.json(
        {
          success: false,
          errorCode: 'INVALID_CLASSROOM_ID',
          error: 'A valid classroomId is required',
        },
        { status: 400 },
      ),
    );
  }

  const access = await requireClassroomAccess(request, body.classroomId);
  if (access instanceof NextResponse) {
    return access;
  }

  const expiresInMinutes = Math.min(Math.max(body.expiresInMinutes ?? 120, 10), 24 * 60);
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();
  const rawToken = createOpaqueToken();
  const joinToken = await createJoinTokenRecord({
    classroomId: body.classroomId,
    createdByUserId: auth.user.id,
    organizationId: auth.session.organizationId,
    displayName: body.displayName?.trim() || `Classroom ${body.classroomId}`,
    tokenHash: hashToken(rawToken),
    expiresAt,
  });

  await recordAuditEvent({
    organizationId: auth.session.organizationId,
    userId: auth.user.id,
    actorRole: auth.session.role,
    action: 'classroom.join_token.created',
    resourceType: 'classroom',
    resourceId: body.classroomId,
    metadata: {
      joinTokenId: joinToken.id,
      expiresAt,
      displayName: joinToken.displayName,
    },
  });

  const joinUrl = `${buildRequestOrigin(request)}/join/${rawToken}`;
  return withRequestWebSession(
    request,
    NextResponse.json({
      success: true,
      joinUrl,
      joinCode: rawToken,
      expiresAt,
    }),
  );
}
