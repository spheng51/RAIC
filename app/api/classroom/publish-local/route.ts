import { randomUUID } from 'crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { requireRequestRole } from '@/lib/auth/authorize';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
} from '@/lib/server/api-response';
import { buildRequestOrigin, persistClassroom } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';
import type { Scene, Stage } from '@/lib/types/stage';
import {
  collectAudioIds,
  collectMediaPlaceholders,
  rewriteSceneAssets,
  writeAssetsFromFormData,
  type PublishWarning,
} from '@/lib/server/classroom-publish-assets';

const log = createLogger('PublishLocalClassroom API');

function parseJsonField<T>(value: FormDataEntryValue | null, fieldName: string): T {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required field: ${fieldName}`);
  }
  return JSON.parse(value) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function parsePublishPayload(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    return {
      stage: parseJsonField<unknown>(formData.get('stage'), 'stage'),
      scenes: parseJsonField<unknown>(formData.get('scenes'), 'scenes'),
      formData,
    };
  }

  const body = (await request.json()) as { stage?: unknown; scenes?: unknown };
  return {
    stage: body.stage,
    scenes: body.scenes,
    formData: null,
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  try {
    const payload = await parsePublishPayload(request);

    if (!isRecord(payload.stage) || !Array.isArray(payload.scenes)) {
      return apiErrorWithRequestSession(
        request,
        'INVALID_REQUEST',
        400,
        'Invalid stage or scenes payload',
      );
    }

    const classroomId = randomUUID();
    const baseUrl = buildRequestOrigin(request);
    const stage = structuredClone(payload.stage) as unknown as Stage;
    const scenes = structuredClone(payload.scenes) as Scene[];
    const warnings: PublishWarning[] = [];

    stage.id = classroomId;
    stage.updatedAt = Date.now();
    for (const scene of scenes) {
      scene.stageId = classroomId;
      scene.updatedAt = Date.now();
    }

    if (payload.formData) {
      const wantedMedia = collectMediaPlaceholders(scenes);
      const wantedAudio = collectAudioIds(scenes);
      const { mediaMap, audioMap } = await writeAssetsFromFormData({
        formData: payload.formData,
        classroomId,
        baseUrl,
        wantedMedia,
        wantedAudio,
        warnings,
      });

      rewriteSceneAssets({
        scenes,
        mediaMap,
        audioMap,
        warnings,
      });
    }

    const persisted = await persistClassroom(
      {
        id: classroomId,
        ownerUserId: auth.user.id,
        organizationId: auth.session.organizationId ?? null,
        stage,
        scenes,
      },
      baseUrl,
    );

    return apiSuccessWithRequestSession(
      request,
      {
        id: persisted.id,
        url: persisted.url,
        warnings,
      },
      201,
    );
  } catch (error) {
    log.error('Failed to publish local classroom:', error);
    return apiErrorWithRequestSession(
      request,
      'INTERNAL_ERROR',
      500,
      'Failed to publish classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}
