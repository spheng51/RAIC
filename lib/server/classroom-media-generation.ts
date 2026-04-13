/**
 * Server-side media and TTS generation for classrooms.
 *
 * Generates image/video files and TTS audio for a classroom,
 * writes them to disk, and returns serving URL mappings.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '@/lib/logger';
import { CLASSROOMS_DIR } from '@/lib/server/classroom-storage';
import { generateImage } from '@/lib/media/image-providers';
import { generateVideo, normalizeVideoOptions } from '@/lib/media/video-providers';
import { generateTTS } from '@/lib/audio/tts-providers';
import { DEFAULT_TTS_VOICES, DEFAULT_TTS_MODELS, TTS_PROVIDERS } from '@/lib/audio/constants';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import { isMediaPlaceholder } from '@/lib/store/media-generation';
import { resolveGovernedProviderConfig } from '@/lib/server/ai-governance';
import type { SceneOutline } from '@/lib/types/generation';
import type { Scene } from '@/lib/types/stage';
import type { SpeechAction } from '@/lib/types/action';
import type { ImageProviderId } from '@/lib/media/types';
import type { VideoProviderId } from '@/lib/media/types';
import type { TTSProviderId } from '@/lib/audio/types';
import type { AIProviderFamily } from '@/lib/types/ai-governance';
import { splitLongSpeechActions } from '@/lib/audio/tts-utils';
import type { ImageProviderOverride } from '@/lib/server/classroom-generation';

const log = createLogger('ClassroomMedia');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

const DOWNLOAD_TIMEOUT_MS = 120_000; // 2 minutes
const DOWNLOAD_MAX_SIZE = 100 * 1024 * 1024; // 100 MB

async function downloadToBuffer(url: string): Promise<Buffer> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
  const contentLength = Number(resp.headers.get('content-length') || 0);
  if (contentLength > DOWNLOAD_MAX_SIZE) {
    throw new Error(`File too large: ${contentLength} bytes (max ${DOWNLOAD_MAX_SIZE})`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

function mediaServingUrl(baseUrl: string, classroomId: string, subPath: string): string {
  return `${baseUrl}/api/classroom-media/${classroomId}/${subPath}`;
}

async function resolveFirstBackgroundProvider<T extends string>(input: {
  family: Exclude<AIProviderFamily, 'llm'>;
  providerIds: T[];
  organizationId: string | null;
}) {
  for (const providerId of input.providerIds) {
    try {
      return await resolveGovernedProviderConfig({
        auth: null,
        organizationId: input.organizationId,
        family: input.family,
        providerId,
        mode: 'background',
      });
    } catch {
      continue;
    }
  }

  return null;
}

interface ResolvedImageProviderConfig {
  providerId: ImageProviderId;
  apiKey?: string;
  baseUrl?: string;
  modelId?: string;
}

function resolveImageProviderConfig(
  source: 'request-scoped override' | 'governed background config',
  config: {
    providerId: string;
    apiKey?: string;
    baseUrl?: string;
    modelId?: string;
  },
): ResolvedImageProviderConfig | null {
  if (!(config.providerId in IMAGE_PROVIDERS)) {
    log.warn(
      `Skipping ${source} image provider "${config.providerId}" because it is not supported`,
    );
    return null;
  }

  const providerId = config.providerId as ImageProviderId;
  const providerConfig = IMAGE_PROVIDERS[providerId];
  const apiKey = config.apiKey?.trim();

  if (providerConfig.requiresApiKey && !apiKey) {
    log.warn(
      `Skipping ${source} image provider "${providerId}" because it requires an API key`,
    );
    return null;
  }

  const modelId = config.modelId?.trim() || providerConfig.models[0]?.id;
  if (!modelId) {
    log.warn(`Skipping ${source} image provider "${providerId}" because no model is configured`);
    return null;
  }

  const baseUrl = config.baseUrl?.trim() || providerConfig.defaultBaseUrl;
  if (!baseUrl) {
    log.warn(
      `Skipping ${source} image provider "${providerId}" because no base URL is configured`,
    );
    return null;
  }

  return {
    providerId,
    apiKey,
    baseUrl,
    modelId,
  };
}

async function resolveImageProviderForClassroom(scope: {
  organizationId: string | null;
  imageProviderOverride?: ImageProviderOverride;
}): Promise<ResolvedImageProviderConfig | null> {
  if (scope.imageProviderOverride) {
    const resolvedOverride = resolveImageProviderConfig('request-scoped override', {
      providerId: scope.imageProviderOverride.providerId,
      apiKey: scope.imageProviderOverride.apiKey,
      baseUrl: scope.imageProviderOverride.baseUrl,
      modelId: scope.imageProviderOverride.modelId,
    });

    if (resolvedOverride) {
      log.info(`Using request-scoped image provider override: ${resolvedOverride.providerId}`);
    }

    return resolvedOverride;
  }

  const imageProviderIds = Object.keys(IMAGE_PROVIDERS) as ImageProviderId[];
  const resolvedImageProvider = await resolveFirstBackgroundProvider({
    family: 'image',
    providerIds: imageProviderIds,
    organizationId: scope.organizationId,
  });

  if (!resolvedImageProvider) {
    return null;
  }

  const providerId = resolvedImageProvider.providerId as ImageProviderId;
  const resolvedBackground = resolveImageProviderConfig('governed background config', {
    providerId,
    apiKey: resolvedImageProvider.apiKey,
    baseUrl: resolvedImageProvider.baseUrl,
    modelId: resolvedImageProvider.modelId,
  });

  if (resolvedBackground) {
    log.info(`Using governed image provider: ${resolvedBackground.providerId}`);
  }

  return resolvedBackground;
}

// ---------------------------------------------------------------------------
// Image / Video generation
// ---------------------------------------------------------------------------

export async function generateMediaForClassroom(
  outlines: SceneOutline[],
  classroomId: string,
  baseUrl: string,
  scope: {
    organizationId: string | null;
    imageProviderOverride?: ImageProviderOverride;
  },
): Promise<Record<string, string>> {
  const mediaDir = path.join(CLASSROOMS_DIR, classroomId, 'media');
  await ensureDir(mediaDir);

  // Collect all media generation requests from outlines
  const requests = outlines.flatMap((o) => o.mediaGenerations ?? []);
  if (requests.length === 0) return {};

  const videoProviderIds = Object.keys(VIDEO_PROVIDERS) as VideoProviderId[];
  const resolvedImageProvider = await resolveImageProviderForClassroom(scope);
  const resolvedVideoProvider = await resolveFirstBackgroundProvider({
    family: 'video',
    providerIds: videoProviderIds,
    organizationId: scope.organizationId,
  });

  const mediaMap: Record<string, string> = {};

  // Separate image and video requests, generate each type sequentially
  // but run the two types in parallel (providers often have limited concurrency).
  const imageRequests = requests.filter((r) => r.type === 'image' && !!resolvedImageProvider);
  const videoRequests = requests.filter((r) => r.type === 'video' && !!resolvedVideoProvider);

  const generateImages = async () => {
    if (!resolvedImageProvider) {
      if (requests.some((r) => r.type === 'image')) {
        log.warn('No image provider available for classroom media generation, skipping images');
      }
      return;
    }

    for (const req of imageRequests) {
      try {
        const providerId = resolvedImageProvider.providerId as ImageProviderId;
        const providerConfig = IMAGE_PROVIDERS[providerId];
        const model = resolvedImageProvider.modelId || providerConfig?.models?.[0]?.id;

        const result = await generateImage(
          {
            providerId,
            apiKey: resolvedImageProvider.apiKey,
            baseUrl: resolvedImageProvider.baseUrl,
            model,
          },
          { prompt: req.prompt, aspectRatio: req.aspectRatio || '16:9' },
        );

        let buf: Buffer;
        let ext: string;
        if (result.base64) {
          buf = Buffer.from(result.base64, 'base64');
          ext = 'png';
        } else if (result.url) {
          buf = await downloadToBuffer(result.url);
          const urlExt = path.extname(new URL(result.url).pathname).replace('.', '');
          ext = ['png', 'jpg', 'jpeg', 'webp'].includes(urlExt) ? urlExt : 'png';
        } else {
          log.warn(`Image generation returned no data for ${req.elementId}`);
          continue;
        }

        const filename = `${req.elementId}.${ext}`;
        await fs.writeFile(path.join(mediaDir, filename), buf);
        mediaMap[req.elementId] = mediaServingUrl(baseUrl, classroomId, `media/${filename}`);
        log.info(`Generated image: ${filename}`);
      } catch (err) {
        log.warn(`Image generation failed for ${req.elementId}:`, err);
      }
    }
  };

  const generateVideos = async () => {
    if (!resolvedVideoProvider) {
      return;
    }

    for (const req of videoRequests) {
      try {
        const providerId = resolvedVideoProvider.providerId as VideoProviderId;
        const providerConfig = VIDEO_PROVIDERS[providerId];
        const model = resolvedVideoProvider.modelId || providerConfig?.models?.[0]?.id;

        const normalized = normalizeVideoOptions(providerId, {
          prompt: req.prompt,
          aspectRatio: (req.aspectRatio as '16:9' | '4:3' | '1:1' | '9:16') || '16:9',
        });

        const result = await generateVideo(
          {
            providerId,
            apiKey: resolvedVideoProvider.apiKey,
            baseUrl: resolvedVideoProvider.baseUrl,
            model,
          },
          normalized,
        );

        const buf = await downloadToBuffer(result.url);
        const filename = `${req.elementId}.mp4`;
        await fs.writeFile(path.join(mediaDir, filename), buf);
        mediaMap[req.elementId] = mediaServingUrl(baseUrl, classroomId, `media/${filename}`);
        log.info(`Generated video: ${filename}`);
      } catch (err) {
        log.warn(`Video generation failed for ${req.elementId}:`, err);
      }
    }
  };

  await Promise.all([generateImages(), generateVideos()]);

  return mediaMap;
}

// ---------------------------------------------------------------------------
// Placeholder replacement in scene content
// ---------------------------------------------------------------------------

export function replaceMediaPlaceholders(scenes: Scene[], mediaMap: Record<string, string>): void {
  if (Object.keys(mediaMap).length === 0) return;

  for (const scene of scenes) {
    if (scene.type !== 'slide') continue;
    const canvas = (
      scene.content as {
        canvas?: { elements?: Array<{ id: string; src?: string; type?: string }> };
      }
    )?.canvas;
    if (!canvas?.elements) continue;

    for (const el of canvas.elements) {
      if (
        (el.type === 'image' || el.type === 'video') &&
        typeof el.src === 'string' &&
        isMediaPlaceholder(el.src) &&
        mediaMap[el.src]
      ) {
        el.src = mediaMap[el.src];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// TTS generation
// ---------------------------------------------------------------------------

export async function generateTTSForClassroom(
  scenes: Scene[],
  classroomId: string,
  baseUrl: string,
  scope: {
    organizationId: string | null;
  },
): Promise<void> {
  const audioDir = path.join(CLASSROOMS_DIR, classroomId, 'audio');
  await ensureDir(audioDir);

  // Resolve TTS provider (exclude browser-native-tts)
  const resolvedTTSProvider = await resolveFirstBackgroundProvider({
    family: 'tts',
    providerIds: (Object.keys(TTS_PROVIDERS) as TTSProviderId[]).filter(
      (id) => id !== 'browser-native-tts',
    ),
    organizationId: scope.organizationId,
  });

  if (!resolvedTTSProvider) {
    log.warn('No server TTS provider configured, skipping TTS generation');
    return;
  }

  const providerId = resolvedTTSProvider.providerId as TTSProviderId;
  const ttsBaseUrl = resolvedTTSProvider.baseUrl || TTS_PROVIDERS[providerId]?.defaultBaseUrl;
  const voice = DEFAULT_TTS_VOICES[providerId] || 'default';
  const format = TTS_PROVIDERS[providerId]?.supportedFormats?.[0] || 'mp3';

  for (const scene of scenes) {
    if (!scene.actions) continue;

    // Split long speech actions into multiple shorter ones before TTS generation,
    // mirroring the client-side approach. Each sub-action gets its own audio file.
    scene.actions = splitLongSpeechActions(scene.actions, providerId);

    for (const action of scene.actions) {
      if (action.type !== 'speech' || !(action as SpeechAction).text) continue;
      const speechAction = action as SpeechAction;
      const audioId = `tts_${action.id}`;

      try {
        const result = await generateTTS(
          {
            providerId,
            modelId: resolvedTTSProvider.modelId || DEFAULT_TTS_MODELS[providerId] || '',
            apiKey: resolvedTTSProvider.apiKey,
            baseUrl: ttsBaseUrl,
            voice,
            speed: speechAction.speed,
          },
          speechAction.text,
        );

        const filename = `${audioId}.${format}`;
        await fs.writeFile(path.join(audioDir, filename), result.audio);

        speechAction.audioId = audioId;
        speechAction.audioUrl = mediaServingUrl(baseUrl, classroomId, `audio/${filename}`);
        log.info(`Generated TTS: ${filename} (${result.audio.length} bytes)`);
      } catch (err) {
        log.warn(`TTS generation failed for action ${action.id}:`, err);
      }
    }
  }
}
