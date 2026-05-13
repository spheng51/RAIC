import type { Scene, Stage } from '@/lib/types/stage';
import { db } from '@/lib/utils/database';

export const LOCAL_PUBLISH_ASSET_UPLOAD_LIMIT_BYTES = 3_500_000;
const MEDIA_PLACEHOLDER_RE = /^gen_(img|vid)_[\w-]+$/i;

export interface PublishWarning {
  code: string;
  message: string;
}

export interface PublishLocalClassroomResult {
  success: boolean;
  status?: number;
  id?: string;
  url?: string;
  warnings?: PublishWarning[];
  error?: string;
  details?: string;
}

export type PublishLocalClassroomProgress =
  | { phase: 'metadata' }
  | { phase: 'assets'; completed: number; total: number; currentAssetId?: string };

export interface LocalClassroomPublishAsset {
  kind: 'media' | 'audio';
  assetId: string;
  filename: string;
  mimeType: string;
  blob: Blob;
}

export interface LocalClassroomPublishManifest {
  stage: Stage;
  scenes: Scene[];
  assets: LocalClassroomPublishAsset[];
  warnings: PublishWarning[];
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

function mediaElementIdFromRecordId(recordId: string) {
  return recordId.split(':').slice(1).join(':');
}

function rewriteMediaReference(scenes: Scene[], assetId: string, url: string) {
  for (const scene of scenes) {
    if (scene.type !== 'slide') continue;
    const canvas = (
      scene.content as {
        canvas?: { elements?: Array<{ src?: unknown; type?: unknown }> };
      }
    )?.canvas;
    for (const element of canvas?.elements ?? []) {
      if ((element.type === 'image' || element.type === 'video') && element.src === assetId) {
        element.src = url;
      }
    }
  }
}

function rewriteAudioReference(scenes: Scene[], audioId: string, url: string) {
  for (const scene of scenes) {
    for (const action of scene.actions ?? []) {
      const speechAction = action as {
        type?: string;
        audioId?: unknown;
        audioUrl?: string;
      };
      if (speechAction.type === 'speech' && speechAction.audioId === audioId) {
        speechAction.audioUrl = url;
      }
    }
  }
}

function hasAudioUrlForId(scenes: Scene[], audioId: string) {
  return scenes.some((scene) =>
    (scene.actions ?? []).some((action) => {
      const speechAction = action as {
        type?: string;
        audioId?: unknown;
        audioUrl?: unknown;
      };
      return (
        speechAction.type === 'speech' &&
        speechAction.audioId === audioId &&
        typeof speechAction.audioUrl === 'string' &&
        speechAction.audioUrl.trim().length > 0
      );
    }),
  );
}

function assetTooLargeWarning(assetName: string, size: number): PublishWarning {
  return {
    code: 'asset_too_large',
    message: `${assetName} is ${Math.ceil(size / 1024 / 1024)} MB and was skipped for sharing.`,
  };
}

export async function buildLocalClassroomPublishManifest(input: {
  stage: Stage;
  scenes: Scene[];
  maxAssetBytes?: number;
}): Promise<LocalClassroomPublishManifest> {
  const maxAssetBytes = input.maxAssetBytes ?? LOCAL_PUBLISH_ASSET_UPLOAD_LIMIT_BYTES;
  const stage = cloneJson(input.stage);
  const scenes = cloneJson(input.scenes);
  const assets: LocalClassroomPublishAsset[] = [];
  const warnings: PublishWarning[] = [];

  const mediaPlaceholders = collectMediaPlaceholders(scenes);
  const handledMedia = new Set<string>();
  if (mediaPlaceholders.size > 0) {
    const mediaRecords = await db.mediaFiles.where('stageId').equals(input.stage.id).toArray();
    for (const record of mediaRecords) {
      const elementId = mediaElementIdFromRecordId(record.id);
      if (!mediaPlaceholders.has(elementId)) continue;

      handledMedia.add(elementId);
      if (record.ossKey) {
        rewriteMediaReference(scenes, elementId, record.ossKey);
        continue;
      }

      if (record.error) {
        warnings.push({
          code: 'media_asset_missing',
          message: `Generated media "${elementId}" was not available and may be missing for students.`,
        });
        continue;
      }

      const mimeType = record.blob.type || record.mimeType;
      const blob = record.blob.type ? record.blob : new Blob([record.blob], { type: mimeType });
      if (blob.size > maxAssetBytes) {
        warnings.push(assetTooLargeWarning(elementId, blob.size));
        continue;
      }

      const ext = extensionFromMime(mimeType, record.type === 'video' ? '.mp4' : '.png');
      assets.push({
        kind: 'media',
        assetId: elementId,
        filename: `${elementId}${ext}`,
        mimeType,
        blob,
      });
    }
  }

  for (const elementId of mediaPlaceholders) {
    if (handledMedia.has(elementId)) continue;
    warnings.push({
      code: 'media_asset_missing',
      message: `Generated media "${elementId}" was not available and may be missing for students.`,
    });
  }

  const audioIds = collectAudioIds(scenes);
  for (const audioId of audioIds) {
    const record = await db.audioFiles.get(audioId);

    if (record?.ossKey) {
      rewriteAudioReference(scenes, audioId, record.ossKey);
      continue;
    }

    if (!record) {
      if (!hasAudioUrlForId(scenes, audioId)) {
        warnings.push({
          code: 'audio_asset_missing',
          message: `Narration audio "${audioId}" was not available and may fall back to silent playback.`,
        });
      }
      continue;
    }

    const mimeType = record.blob.type || mimeFromAudioFormat(record.format);
    const blob = record.blob.type ? record.blob : new Blob([record.blob], { type: mimeType });
    if (blob.size > maxAssetBytes) {
      warnings.push(assetTooLargeWarning(audioId, blob.size));
      continue;
    }

    const ext = extensionFromMime(mimeType, `.${record.format || 'mp3'}`);
    assets.push({
      kind: 'audio',
      assetId: audioId,
      filename: `${audioId}${ext}`,
      mimeType,
      blob,
    });
  }

  return { stage, scenes, assets, warnings };
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
  onProgress?: (progress: PublishLocalClassroomProgress) => void;
}): Promise<PublishLocalClassroomResult> {
  const manifest = await buildLocalClassroomPublishManifest(input);
  const warnings = [...manifest.warnings];

  input.onProgress?.({ phase: 'metadata' });
  const response = await fetch('/api/classroom/publish-local', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      stage: manifest.stage,
      scenes: manifest.scenes,
    }),
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

  warnings.push(...(body.warnings ?? []));

  if (body.id) {
    for (let index = 0; index < manifest.assets.length; index += 1) {
      const asset = manifest.assets[index];
      input.onProgress?.({
        phase: 'assets',
        completed: index,
        total: manifest.assets.length,
        currentAssetId: asset.assetId,
      });

      const assetFormData = new FormData();
      assetFormData.set('kind', asset.kind);
      assetFormData.set('assetId', asset.assetId);
      assetFormData.set('filename', asset.filename);
      assetFormData.set('mimeType', asset.mimeType);
      assetFormData.set('file', asset.blob, asset.filename);

      const uploadResponse = await fetch(
        `/api/classroom/${encodeURIComponent(body.id)}/publish-local-asset`,
        {
          method: 'POST',
          body: assetFormData,
        },
      );
      const uploadBody = (await uploadResponse.json().catch(() => null)) as {
        warnings?: PublishWarning[];
        error?: string;
        details?: string;
      } | null;

      if (uploadResponse.ok) {
        warnings.push(...(uploadBody?.warnings ?? []));
      } else {
        warnings.push({
          code: 'asset_upload_failed',
          message:
            uploadBody?.details ||
            uploadBody?.error ||
            `${asset.assetId} upload failed with HTTP ${uploadResponse.status}.`,
        });
      }

      input.onProgress?.({
        phase: 'assets',
        completed: index + 1,
        total: manifest.assets.length,
      });
    }
  }

  return { ...body, status: response.status, warnings };
}
