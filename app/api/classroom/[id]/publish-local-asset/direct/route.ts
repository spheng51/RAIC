import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { type NextRequest, NextResponse } from 'next/server';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import { isValidClassroomId, readClassroom } from '@/lib/server/classroom-storage';
import {
  DIRECT_PUBLISH_ASSET_UPLOAD_LIMIT_BYTES,
  isDirectPublishAssetUploadConfigured,
  isPublishAssetReferenced,
  parseDirectPublishAssetTokenPayload,
  publishAssetPathname,
  writeRemotePublishAssetReference,
  type PublishAssetKind,
} from '@/lib/server/classroom-publish-assets';
import { createLogger } from '@/lib/logger';

const log = createLogger('PublishLocalClassroomDirectAsset API');

type DirectUploadClientPayload = {
  kind: PublishAssetKind;
  assetId: string;
  filename: string;
  mimeType: string;
};

function parseClientPayload(rawValue: string | null): DirectUploadClientPayload | null {
  if (!rawValue) return null;

  try {
    const payload = JSON.parse(rawValue) as Partial<DirectUploadClientPayload>;
    if (
      (payload.kind === 'media' || payload.kind === 'audio') &&
      typeof payload.assetId === 'string' &&
      payload.assetId.trim() &&
      typeof payload.filename === 'string' &&
      payload.filename.trim() &&
      typeof payload.mimeType === 'string' &&
      payload.mimeType.trim()
    ) {
      return {
        kind: payload.kind,
        assetId: payload.assetId.trim(),
        filename: payload.filename.trim(),
        mimeType: payload.mimeType.trim(),
      };
    }
  } catch {
    return null;
  }

  return null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidClassroomId(id)) {
    return NextResponse.json({ error: 'Invalid classroom id' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid direct upload request' }, { status: 400 });
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!isDirectPublishAssetUploadConfigured()) {
          throw new Error('Direct asset upload storage is not configured');
        }

        const payload = parseClientPayload(clientPayload);
        if (!payload) {
          throw new Error('Invalid asset upload payload');
        }

        const expectedPathname = publishAssetPathname({
          classroomId: id,
          kind: payload.kind,
          assetId: payload.assetId,
          filename: payload.filename,
        });
        if (pathname !== expectedPathname) {
          throw new Error('Invalid asset upload pathname');
        }

        const access = await requireClassroomAccess(request, id);
        if (access instanceof NextResponse) {
          throw new Error('Only teachers can upload classroom publish assets');
        }

        if (access.source !== 'web' || access.auth.session.role === 'student') {
          throw new Error('Only teachers can upload classroom publish assets');
        }

        const classroom = await readClassroom(id);
        if (!classroom) {
          throw new Error('Classroom not found');
        }

        if (
          !isPublishAssetReferenced({
            scenes: classroom.scenes,
            kind: payload.kind,
            assetId: payload.assetId,
          })
        ) {
          throw new Error('Asset is not referenced by this classroom');
        }

        return {
          allowedContentTypes: [payload.mimeType],
          maximumSizeInBytes: DIRECT_PUBLISH_ASSET_UPLOAD_LIMIT_BYTES,
          addRandomSuffix: true,
          cacheControlMaxAge: 60 * 60 * 24 * 30,
          tokenPayload: JSON.stringify({
            classroomId: id,
            kind: payload.kind,
            assetId: payload.assetId,
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = parseDirectPublishAssetTokenPayload(tokenPayload);
        if (!payload) {
          throw new Error('Invalid completed upload payload');
        }

        const result = await writeRemotePublishAssetReference({
          classroomId: payload.classroomId,
          kind: payload.kind,
          assetId: payload.assetId,
          url: blob.url,
        });

        if (result.status !== 'written') {
          throw new Error(`Could not attach uploaded classroom asset: ${result.status}`);
        }
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    log.warn('Direct classroom asset upload failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
