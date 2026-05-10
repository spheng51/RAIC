/**
 * Sora (OpenAI) Video Generation Adapter
 *
 * Async task pattern: submit -> poll -> download MP4 as a data URL.
 *
 * REST endpoints:
 * - Submit:   POST /v1/videos
 * - Poll:     GET  /v1/videos/{video_id}
 * - Download: GET  /v1/videos/{video_id}/content
 *
 * Supported models:
 * - sora-2
 * - sora-2-pro
 *
 * API docs: https://developers.openai.com/api/docs/guides/video-generation
 */

import type {
  VideoGenerationConfig,
  VideoGenerationOptions,
  VideoGenerationResult,
} from '../types';

const DEFAULT_MODEL = 'sora-2';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_ATTEMPTS = 60;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

function getSize(options: VideoGenerationOptions): { size: string; width: number; height: number } {
  const use1080p = options.resolution === '1080p';
  switch (options.aspectRatio) {
    case '9:16':
      return use1080p
        ? { size: '1080x1920', width: 1080, height: 1920 }
        : { size: '720x1280', width: 720, height: 1280 };
    case '1:1':
      return use1080p
        ? { size: '1080x1080', width: 1080, height: 1080 }
        : { size: '720x720', width: 720, height: 720 };
    default:
      return use1080p
        ? { size: '1920x1080', width: 1920, height: 1080 }
        : { size: '1280x720', width: 1280, height: 720 };
  }
}

async function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64');
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

interface SoraVideoJob {
  id: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'expired' | string;
  progress?: number;
  model?: string;
  seconds?: string | number;
  size?: string;
  error?: {
    message?: string;
  };
}

async function submitVideoGeneration(
  baseUrl: string,
  apiKey: string,
  model: string,
  options: VideoGenerationOptions,
): Promise<SoraVideoJob> {
  const { size } = getSize(options);
  const body = {
    model,
    prompt: options.prompt,
    size,
    seconds: String(options.duration || 8),
  };

  const response = await fetch(`${baseUrl}/videos`, {
    method: 'POST',
    headers: apiHeaders(apiKey),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sora submit failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<SoraVideoJob>;
}

async function pollVideoStatus(
  baseUrl: string,
  apiKey: string,
  videoId: string,
): Promise<SoraVideoJob> {
  const response = await fetch(`${baseUrl}/videos/${videoId}`, {
    method: 'GET',
    headers: apiHeaders(apiKey),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sora poll failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<SoraVideoJob>;
}

async function downloadVideoContent(
  baseUrl: string,
  apiKey: string,
  videoId: string,
): Promise<string> {
  const response = await fetch(`${baseUrl}/videos/${videoId}/content`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sora download failed (${response.status}): ${text}`);
  }

  const mimeType = response.headers.get('content-type') || 'video/mp4';
  const base64 = await arrayBufferToBase64(await response.arrayBuffer());
  return `data:${mimeType};base64,${base64}`;
}

export async function testSoraConnectivity(
  config: VideoGenerationConfig,
): Promise<{ success: boolean; message: string }> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });

    if (response.ok) {
      return { success: true, message: 'Connected to Sora' };
    }

    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        message: `Sora auth failed (${response.status}). Check your OpenAI API key.` ,
      };
    }
    return { success: false, message: `Sora connectivity failed (${response.status}): ${text}` };
  } catch (err) {
    return { success: false, message: `Sora connectivity error: ${err}` };
  }
}

export async function generateWithSora(
  config: VideoGenerationConfig,
  options: VideoGenerationOptions,
): Promise<VideoGenerationResult> {
  const model = config.model || DEFAULT_MODEL;
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const { width, height } = getSize(options);

  let current = await submitVideoGeneration(baseUrl, config.apiKey, model, options);
  if (!current.id) {
    throw new Error('Sora returned a video job without an id');
  }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    if (current.status === 'completed') {
      return {
        url: await downloadVideoContent(baseUrl, config.apiKey, current.id),
        duration: Number(current.seconds || options.duration || 8),
        width,
        height,
      };
    }

    if (current.status === 'failed' || current.status === 'expired') {
      throw new Error(`Sora generation failed: ${current.error?.message || current.status}`);
    }

    await delay(POLL_INTERVAL_MS);
    current = await pollVideoStatus(baseUrl, config.apiKey, current.id);
  }

  throw new Error(
    `Sora video generation timed out after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s (video: ${current.id})`,
  );
}
