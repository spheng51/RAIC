import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireRequestRole } from '@/lib/auth/authorize';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import { recordAuditEvent } from '@/lib/server/audit-log';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
} from '@/lib/server/api-response';
import {
  assertMiroFishAuthoringAvailable,
  buildMiroFishCreationBriefPreview,
  publishMiroFishAuthoringJob,
} from '@/lib/server/mirofish-authoring';
import {
  createMiroFishCreationJob,
  type MiroFishCreationJobRecord,
} from '@/lib/server/mirofish-authoring-job-store';
import { isMiroFishMultiUserEnabled } from '@/lib/server/mirofish';
import { miroFishCreationSpecSchema } from '@/lib/types/mirofish-authoring';

interface CreateMiroFishBody {
  spec?: unknown;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestRole(request, ['teacher']);
    if (auth instanceof NextResponse) {
      return auth;
    }

    const { id } = await params;
    const access = await requireClassroomAccess(request, id);
    if (access instanceof NextResponse) {
      return access;
    }

    assertMiroFishAuthoringAvailable();

    const body = (await request.json()) as CreateMiroFishBody;
    const spec = miroFishCreationSpecSchema.parse(body.spec);

    if (spec.collaborationMode === 'multi-user' && !isMiroFishMultiUserEnabled()) {
      return apiErrorWithRequestSession(
        request,
        'INVALID_REQUEST',
        400,
        'MiroFish multi-user mode is not enabled for this deployment',
      );
    }

    const { jobId: externalJobId } = await publishMiroFishAuthoringJob({
      spec,
      includeReport: spec.includeReport,
      source: 'raic-classroom',
    });

    const now = new Date().toISOString();
    const job: MiroFishCreationJobRecord = {
      id: randomUUID(),
      classroomId: id,
      externalJobId,
      status: 'queued',
      owner: {
        organizationId: access.classroom.organizationId,
        userId: auth.user.id,
        actorRole: auth.session.role,
      },
      spec,
      briefPreview: buildMiroFishCreationBriefPreview(spec.goal),
      attempt: 1,
      maxAttempts: 1,
      canRetry: false,
      createdAt: now,
      updatedAt: now,
    };

    await createMiroFishCreationJob(job);

    await recordAuditEvent({
      organizationId: access.classroom.organizationId,
      userId: auth.user.id,
      actorRole: auth.session.role,
      action: 'classroom.mirofish.creation.started',
      resourceType: 'classroom',
      resourceId: id,
      metadata: {
        classroomId: id,
        jobId: job.id,
        externalJobId,
        includeReport: spec.includeReport,
        defaultSurface: spec.defaultSurface,
        collaborationMode: spec.collaborationMode,
      },
    });

    return apiSuccessWithRequestSession(request, {
      jobId: job.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      (error instanceof Error && error.name === 'ZodError') ||
      message.includes('disabled') ||
      message.includes('required') ||
      message.includes('not enabled')
        ? 400
        : 500;
    return apiErrorWithRequestSession(
      request,
      status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
      status,
      message,
    );
  }
}
