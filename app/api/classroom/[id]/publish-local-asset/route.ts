import { type NextRequest, NextResponse } from 'next/server';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
} from '@/lib/server/api-response';
import { buildRequestOrigin, isValidClassroomId } from '@/lib/server/classroom-storage';
import {
  parseRemotePublishAssetPayload,
  writeSinglePublishAsset,
  writeRemotePublishAssetReference,
  type PublishAssetKind,
} from '@/lib/server/classroom-publish-assets';
import { createLogger } from '@/lib/logger';

const log = createLogger('PublishLocalClassroomAsset API');

function parseAssetKind(value: FormDataEntryValue | null): PublishAssetKind | null {
  return value === 'media' || value === 'audio' ? value : null;
}

function parseRequiredString(value: FormDataEntryValue | null) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidClassroomId(id)) {
    return apiErrorWithRequestSession(request, 'INVALID_REQUEST', 400, 'Invalid classroom id');
  }

  const access = await requireClassroomAccess(request, id);
  if (access instanceof NextResponse) {
    return access;
  }

  if (access.source !== 'web' || access.auth.session.role === 'student') {
    return apiErrorWithRequestSession(
      request,
      'FORBIDDEN',
      403,
      'Only teachers can upload classroom publish assets',
    );
  }

  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const payload = parseRemotePublishAssetPayload(await request.json().catch(() => null));
      if (!payload) {
        return apiErrorWithRequestSession(
          request,
          'INVALID_REQUEST',
          400,
          'Missing required fields: kind, assetId, url',
        );
      }

      const result = await writeRemotePublishAssetReference({
        classroomId: id,
        kind: payload.kind,
        assetId: payload.assetId,
        url: payload.url,
      });

      if (result.status === 'classroom_not_found') {
        return apiErrorWithRequestSession(request, 'INVALID_REQUEST', 404, 'Classroom not found');
      }

      if (result.status === 'unreferenced') {
        return apiErrorWithRequestSession(
          request,
          'INVALID_REQUEST',
          400,
          'Asset is not referenced by this classroom',
        );
      }

      if (result.status === 'invalid_asset') {
        return apiErrorWithRequestSession(
          request,
          'INVALID_REQUEST',
          result.httpStatus,
          result.warning.message,
        );
      }

      return apiSuccessWithRequestSession(request, {
        kind: payload.kind,
        assetId: payload.assetId,
        url: result.url,
        warnings: [],
      });
    }

    const formData = await request.formData();
    const kind = parseAssetKind(formData.get('kind'));
    const assetId = parseRequiredString(formData.get('assetId'));
    const file = formData.get('file');

    if (!kind || !assetId || !(file instanceof File)) {
      return apiErrorWithRequestSession(
        request,
        'INVALID_REQUEST',
        400,
        'Missing required fields: kind, assetId, file',
      );
    }

    const result = await writeSinglePublishAsset({
      classroomId: id,
      baseUrl: buildRequestOrigin(request),
      kind,
      assetId,
      file,
    });

    if (result.status === 'classroom_not_found') {
      return apiErrorWithRequestSession(request, 'INVALID_REQUEST', 404, 'Classroom not found');
    }

    if (result.status === 'unreferenced') {
      return apiErrorWithRequestSession(
        request,
        'INVALID_REQUEST',
        400,
        'Asset is not referenced by this classroom',
      );
    }

    if (result.status === 'invalid_asset') {
      return apiErrorWithRequestSession(
        request,
        'INVALID_REQUEST',
        result.httpStatus,
        result.warning.message,
      );
    }

    return apiSuccessWithRequestSession(request, {
      kind,
      assetId,
      url: result.url,
      warnings: [],
    });
  } catch (error) {
    log.error('Failed to upload local publish asset:', error);
    return apiErrorWithRequestSession(
      request,
      'INTERNAL_ERROR',
      500,
      'Failed to upload classroom asset',
      error instanceof Error ? error.message : String(error),
    );
  }
}
