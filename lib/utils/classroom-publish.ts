import type { Scene, Stage } from '@/lib/types/stage';
import { db } from '@/lib/utils/database';

const MEDIA_PLACEHOLDER_RE = /^gen_(img|vid)_[\w-]+$/i;

export interface PublishLocalClassroomResult {
  success: boolean;
  status?: number;
  id?: string;
  url?: string;
  warnings?: Array<{ code: string; message: string }>;
  error?: string;
  details?: string;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

function extensionFromMime(mimeType: string, fallback: string) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  if (mimeType === 'video/mp4') return '.mp4';
  if (mimeType === 'video/webm') return '.webm';
  if (mimeType === 'audio/mpeg') return '.mp3';
  if (mimeType === 'audio/wav') return '.wav';
  if (mimeType === 'audio/ogg') return '.ogg';
  if (mimeType === 'audio/aac') return '.aac';
  return fallback;
}

function mimeFromAudioFormat(format: string) {
  const normalized = format.toLowerCase();
  if (normalized === 'mp3' || normalized === 'mpeg') return 'audio/mpeg';
  if (normalized === 'wav') return 'audio/wav';
  if (normalized === 'ogg') return 'audio/ogg';
  if (normalized === 'aac') return 'audio/aac';
  return `audio/${normalized || 'mpeg'}`;
}

export async function buildLocalClassroomPublishForm(input: { stage: Stage; scenes: Scene[] }) {
  const stage = cloneJson(input.stage);
  const scenes = cloneJson(input.scenes);
  const formData = new FormData();
  formData.set('stage', JSON.stringify(stage));
  formData.set('scenes', JSON.stringify(scenes));

  const mediaPlaceholders = collectMediaPlaceholders(scenes);
  if (mediaPlaceholders.size > 0) {
    const mediaRecords = await db.mediaFiles.where('stageId').equals(input.stage.id).toArray();
    for (const record of mediaRecords) {
      if (record.error || !mediaPlaceholders.has(record.id.split(':').slice(1).join(':'))) {
        continue;
      }

      const elementId = record.id.split(':').slice(1).join(':');
      const mimeType = record.blob.type || record.mimeType;
      const blob = record.blob.type ? record.blob : new Blob([record.blob], { type: mimeType });
      const ext = extensionFromMime(mimeType, record.type === 'video' ? '.mp4' : '.png');
      formData.append(`media:${elementId}`, blob, `${elementId}${ext}`);
    }
  }

  const audioIds = collectAudioIds(scenes);
  for (const audioId of audioIds) {
    const record = await db.audioFiles.get(audioId);
    if (!record) continue;

    const mimeType = record.blob.type || mimeFromAudioFormat(record.format);
    const blob = record.blob.type ? record.blob : new Blob([record.blob], { type: mimeType });
    const ext = extensionFromMime(mimeType, `.${record.format || 'mp3'}`);
    formData.append(`audio:${audioId}`, blob, `${audioId}${ext}`);
  }

  return formData;
}

export async function publishLocalClassroom(input: {
  stage: Stage;
  scenes: Scene[];
}): Promise<PublishLocalClassroomResult> {
  const formData = await buildLocalClassroomPublishForm(input);
  const response = await fetch('/api/classroom/publish-local', {
    method: 'POST',
    body: formData,
  });

  const body = (await response.json().catch(() => null)) as PublishLocalClassroomResult | null;
  if (!response.ok || !body) {
    return {
      success: false,
      status: response.status,
      error: body?.error || `Publish failed with HTTP ${response.status}`,
      details: body?.details,
    };
  }

  return { ...body, status: response.status };
}
