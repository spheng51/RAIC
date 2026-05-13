import { promises as fs } from 'fs';
import path from 'path';
import { CLASSROOMS_DIR, readClassroom, updateClassroom } from '@/lib/server/classroom-storage';
import type { Scene } from '@/lib/types/stage';

export const MAX_PUBLISH_ASSET_BYTES = 100 * 1024 * 1024;
export const MEDIA_FIELD_PREFIX = 'media:';
export const AUDIO_FIELD_PREFIX = 'audio:';

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

export type PublishWarning = {
  code: string;
  message: string;
};

export type PublishAssetKind = 'media' | 'audio';

export function collectMediaPlaceholders(scenes: Scene[]) {
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

export function collectAudioIds(scenes: Scene[]) {
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

export function safeAssetSegment(value: string) {
  return value.replace(/[^\w-]/g, '_').slice(0, 120) || 'asset';
}

export function extensionForFile(file: File, fallback: string) {
  const fromMime = MIME_EXTENSIONS[file.type.toLowerCase()];
  if (fromMime) return fromMime;

  const fromName = path.extname(file.name).toLowerCase();
  if (fromName && /^[.\w-]+$/.test(fromName)) {
    return fromName;
  }

  return fallback;
}

export function mediaServingUrl(baseUrl: string, classroomId: string, subPath: string) {
  return `${baseUrl}/api/classroom-media/${classroomId}/${subPath}`;
}

export async function writeUploadedAsset(input: {
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

export async function writeAssetsFromFormData(input: {
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

export function rewriteSceneAssets(input: {
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

function rewriteSingleSceneAsset(input: {
  scenes: Scene[];
  kind: PublishAssetKind;
  assetId: string;
  url: string;
}) {
  let rewritten = false;

  for (const scene of input.scenes) {
    if (input.kind === 'media' && scene.type === 'slide') {
      const canvas = (
        scene.content as {
          canvas?: { elements?: Array<{ src?: unknown; type?: unknown }> };
        }
      )?.canvas;

      for (const element of canvas?.elements ?? []) {
        if (
          (element.type === 'image' || element.type === 'video') &&
          element.src === input.assetId
        ) {
          element.src = input.url;
          rewritten = true;
        }
      }
    }

    if (input.kind === 'audio') {
      for (const action of scene.actions ?? []) {
        const speechAction = action as {
          type?: string;
          audioId?: unknown;
          audioUrl?: string;
        };
        if (speechAction.type === 'speech' && speechAction.audioId === input.assetId) {
          speechAction.audioUrl = input.url;
          rewritten = true;
        }
      }
    }
  }

  return rewritten;
}

export async function writeSinglePublishAsset(input: {
  classroomId: string;
  baseUrl: string;
  kind: PublishAssetKind;
  assetId: string;
  file: File;
}): Promise<
  | { status: 'written'; url: string }
  | { status: 'classroom_not_found' }
  | { status: 'unreferenced' }
  | { status: 'invalid_asset'; httpStatus: number; warning: PublishWarning }
> {
  const classroom = await readClassroom(input.classroomId);
  if (!classroom) {
    return { status: 'classroom_not_found' };
  }

  const isReferenced =
    input.kind === 'media'
      ? collectMediaPlaceholders(classroom.scenes).has(input.assetId)
      : collectAudioIds(classroom.scenes).has(input.assetId);
  if (!isReferenced) {
    return { status: 'unreferenced' };
  }

  if (input.file.size <= 0) {
    return {
      status: 'invalid_asset',
      httpStatus: 400,
      warning: {
        code: 'empty_asset',
        message: `${input.file.name || input.assetId} was empty and was skipped.`,
      },
    };
  }

  if (input.file.size > MAX_PUBLISH_ASSET_BYTES) {
    return {
      status: 'invalid_asset',
      httpStatus: 413,
      warning: {
        code: 'asset_too_large',
        message: `${input.file.name || input.assetId} is larger than 100 MB and was skipped.`,
      },
    };
  }

  const subDir = input.kind === 'media' ? 'media' : 'audio';
  const fallbackExt =
    input.kind === 'media' && input.assetId.startsWith('gen_vid')
      ? '.mp4'
      : input.kind === 'media'
        ? '.png'
        : '.mp3';
  const filename = `${safeAssetSegment(input.assetId)}${extensionForFile(input.file, fallbackExt)}`;
  const destinationDir = path.join(CLASSROOMS_DIR, input.classroomId, subDir);
  await fs.mkdir(destinationDir, { recursive: true });
  const buffer = Buffer.from(await input.file.arrayBuffer());
  await fs.writeFile(path.join(destinationDir, filename), buffer);

  const url = mediaServingUrl(input.baseUrl, input.classroomId, `${subDir}/${filename}`);
  const updated = await updateClassroom(input.classroomId, (current) => {
    const scenes = structuredClone(current.scenes);
    const rewritten = rewriteSingleSceneAsset({
      scenes,
      kind: input.kind,
      assetId: input.assetId,
      url,
    });

    return rewritten ? { ...current, scenes } : current;
  });

  if (!updated) {
    return { status: 'classroom_not_found' };
  }

  return { status: 'written', url };
}
