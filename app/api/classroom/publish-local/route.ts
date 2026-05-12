import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { requireRequestRole } from '@/lib/auth/authorize';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
} from '@/lib/server/api-response';
import {
  buildRequestOrigin,
  CLASSROOMS_DIR,
  persistClassroom,
} from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';
import type { Scene, Stage } from '@/lib/types/stage';

const log = createLogger('PublishLocalClassroom API');

const MAX_PUBLISH_ASSET_BYTES = 100 * 1024 * 1024;
const MEDIA_FIELD_PREFIX = 'media:';
const AUDIO_FIELD_PREFIX = 'audio:';
const MEDIA_PLACEHOLDER_RE = /^gen_(img|vid)_[\w-]+$/i;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/aac': '.aac',
};

type PublishWarning = {
  code: string;
  message: string;
};

function parseJsonField<T>(value: FormDataEntryValue | null, fieldName: string): T {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required field: ${fieldName}`);
  }
  return JSON.parse(value) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeAssetSegment(value: string) {
  return value.replace(/[^\w-]/g, '_').slice(0, 120) || 'asset';
}

function extensionForFile(file: File, fallback: string) {
  const fromMime = MIME_EXTENSIONS[file.type.toLowerCase()];
  if (fromMime) return fromMime;

  const fromName = path.extname(file.name).toLowerCase();
  if (fromName && /^[.\w-]+$/.test(fromName)) {
    return fromName;
  }

  return fallback;
}

function mediaServingUrl(baseUrl: string, classroomId: string, subPath: string) {
  return `${baseUrl}/api/classroom-media/${classroomId}/${subPath}`;
}

function collectMediaPlaceholders(scenes: Scene[]) {
  const placeholders = new Set<string>();
  for (const scene of scenes) {
    if (scene.type !== 'slide') continue;
    const canvas = (
      scene.content as {
        canvas?: { elements?: Array<{ src?: unknown; type?: unknown }> };
      }
    )?.canvas;
    for (const element of canvas?.elements ?? []) {
      if (
        (element.type === 'image' || element.type === 'video') &&
        typeof element.src === 'string' &&
        MEDIA_PLACEHOLDER_RE.test(element.src)
      ) {
        placeholders.add(element.src);
      }
    }
  }
  return placeholders;
}

function collectAudioIds(scenes: Scene[]) {
  const audioIds = new Set<string>();
  for (const scene of scenes) {
    for (const action of scene.actions ?? []) {
      const candidate = action as { type?: string; audioId?: unknown };
      if (candidate.type === 'speech' && typeof candidate.audioId === 'string') {
        audioIds.add(candidate.audioId);
      }
    }
  }
  return audioIds;
}

async function writeUploadedAsset(input: {
  file: File;
  destinationDir: string;
  filename: string;
  warnings: PublishWarning[];
}) {
  if (input.file.size <= 0) {
    input.warnings.push({
      code: 'empty_asset',
      message: `${input.file.name || input.filename} was empty and was skipped.`,
    });
    return false;
  }

  if (input.file.size > MAX_PUBLISH_ASSET_BYTES) {
    input.warnings.push({
      code: 'asset_too_large',
      message: `${input.file.name || input.filename} is larger than 100 MB and was skipped.`,
    });
    return false;
  }

  await fs.mkdir(input.destinationDir, { recursive: true });
  const buffer = Buffer.from(await input.file.arrayBuffer());
  await fs.writeFile(path.join(input.destinationDir, input.filename), buffer);
  return true;
}

async function writeAssets(input: {
  formData: FormData;
  classroomId: string;
  baseUrl: string;
  wantedMedia: Set<string>;
  wantedAudio: Set<string>;
  warnings: PublishWarning[];
}) {
  const mediaMap = new Map<string, string>();
  const audioMap = new Map<string, string>();
  const mediaDir = path.join(CLASSROOMS_DIR, input.classroomId, 'media');
  const audioDir = path.join(CLASSROOMS_DIR, input.classroomId, 'audio');

  for (const [fieldName, value] of input.formData.entries()) {
    if (!(value instanceof File)) continue;

    if (fieldName.startsWith(MEDIA_FIELD_PREFIX)) {
      const elementId = fieldName.slice(MEDIA_FIELD_PREFIX.length);
      if (!input.wantedMedia.has(elementId)) continue;

      const ext = extensionForFile(value, elementId.startsWith('gen_vid') ? '.mp4' : '.png');
      const filename = `${safeAssetSegment(elementId)}${ext}`;
      const written = await writeUploadedAsset({
        file: value,
        destinationDir: mediaDir,
        filename,
        warnings: input.warnings,
      });
      if (written) {
        mediaMap.set(
          elementId,
          mediaServingUrl(input.baseUrl, input.classroomId, `media/${filename}`),
        );
      }
      continue;
    }

    if (fieldName.startsWith(AUDIO_FIELD_PREFIX)) {
      const audioId = fieldName.slice(AUDIO_FIELD_PREFIX.length);
      if (!input.wantedAudio.has(audioId)) continue;

      const filename = `${safeAssetSegment(audioId)}${extensionForFile(value, '.mp3')}`;
      const written = await writeUploadedAsset({
        file: value,
        destinationDir: audioDir,
        filename,
        warnings: input.warnings,
      });
      if (written) {
        audioMap.set(
          audioId,
          mediaServingUrl(input.baseUrl, input.classroomId, `audio/${filename}`),
        );
      }
    }
  }

  return { mediaMap, audioMap };
}

function rewriteSceneAssets(input: {
  scenes: Scene[];
  mediaMap: Map<string, string>;
  audioMap: Map<string, string>;
  warnings: PublishWarning[];
}) {
  const missingMedia = new Set<string>();
  const missingAudio = new Set<string>();

  for (const scene of input.scenes) {
    scene.stageId = scene.stageId || '';

    if (scene.type === 'slide') {
      const canvas = (
        scene.content as {
          canvas?: { elements?: Array<{ src?: unknown; type?: unknown }> };
        }
      )?.canvas;

      for (const element of canvas?.elements ?? []) {
        if (
          (element.type === 'image' || element.type === 'video') &&
          typeof element.src === 'string' &&
          MEDIA_PLACEHOLDER_RE.test(element.src)
        ) {
          const nextSrc = input.mediaMap.get(element.src);
          if (nextSrc) {
            element.src = nextSrc;
          } else {
            missingMedia.add(element.src);
          }
        }
      }
    }

    for (const action of scene.actions ?? []) {
      const speechAction = action as {
        type?: string;
        audioId?: unknown;
        audioUrl?: string;
      };
      if (speechAction.type !== 'speech' || typeof speechAction.audioId !== 'string') {
        continue;
      }

      const audioUrl = input.audioMap.get(speechAction.audioId);
      if (audioUrl) {
        speechAction.audioUrl = audioUrl;
      } else {
        missingAudio.add(speechAction.audioId);
      }
    }
  }

  for (const elementId of missingMedia) {
    input.warnings.push({
      code: 'media_asset_missing',
      message: `Generated media "${elementId}" was not available and may be missing for students.`,
    });
  }

  for (const audioId of missingAudio) {
    input.warnings.push({
      code: 'audio_asset_missing',
      message: `Narration audio "${audioId}" was not available and may fall back to silent playback.`,
    });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  try {
    const formData = await request.formData();
    const parsedStage = parseJsonField<unknown>(formData.get('stage'), 'stage');
    const parsedScenes = parseJsonField<unknown>(formData.get('scenes'), 'scenes');

    if (!isRecord(parsedStage) || !Array.isArray(parsedScenes)) {
      return apiErrorWithRequestSession(
        request,
        'INVALID_REQUEST',
        400,
        'Invalid stage or scenes payload',
      );
    }

    const classroomId = randomUUID();
    const baseUrl = buildRequestOrigin(request);
    const stage = structuredClone(parsedStage) as unknown as Stage;
    const scenes = structuredClone(parsedScenes) as Scene[];
    const warnings: PublishWarning[] = [];

    stage.id = classroomId;
    stage.updatedAt = Date.now();
    for (const scene of scenes) {
      scene.stageId = classroomId;
      scene.updatedAt = Date.now();
    }

    const wantedMedia = collectMediaPlaceholders(scenes);
    const wantedAudio = collectAudioIds(scenes);
    const { mediaMap, audioMap } = await writeAssets({
      formData,
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
