import { describe, expect, it, vi } from 'vitest';
import { prefetchSceneSpeechAudio } from '@/lib/audio/prefetch-scene-tts';
import type { Scene } from '@/lib/types/stage';

function buildScene(): Scene {
  return {
    id: 'scene-1',
    stageId: 'stage-1',
    type: 'slide',
    title: 'Intro',
    order: 1,
    content: {
      type: 'slide',
      canvas: {
        id: 'canvas-1',
        viewportSize: 1000,
        viewportRatio: 0.562,
        theme: {
          backgroundColor: '#ffffff',
          themeColors: ['#5b9bd5'],
          fontColor: '#333333',
          fontName: 'Microsoft YaHei',
        },
        elements: [],
      },
    },
    actions: [
      {
        id: 'speech-1',
        type: 'speech',
        text: 'Hello class',
      },
      {
        id: 'spotlight-1',
        type: 'spotlight',
        elementId: 'text-1',
      },
      {
        id: 'speech-2',
        type: 'speech',
        text: 'Let us begin',
      },
    ],
  };
}

function buildSettings() {
  return {
    ttsEnabled: true,
    ttsProviderId: 'openai-tts',
    ttsVoice: 'alloy',
    ttsSpeed: 1,
    ttsProvidersConfig: {
      'openai-tts': {
        modelId: 'gpt-4o-mini-tts',
      },
    },
  };
}

describe('prefetchSceneSpeechAudio', () => {
  it('stores generated speech audio when TTS succeeds', async () => {
    const scene = buildScene();
    const storeAudioFile = vi.fn(async () => {});
    const warn = vi.fn();
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          success: true,
          base64: 'aGVsbG8=',
          format: 'mp3',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    const result = await prefetchSceneSpeechAudio({
      scene,
      settings: buildSettings(),
      messages: {
        speechFailed: 'Speech generation failed',
      },
      deps: {
        fetchImpl,
        storeAudioFile,
        warn,
        now: () => 1234,
      },
    });

    expect(result).toEqual({
      failedCount: 0,
      warningMessage: null,
    });
    expect(storeAudioFile).toHaveBeenCalledTimes(2);
    expect(scene.actions?.[0]).toMatchObject({ audioId: 'tts_speech-1' });
    expect(scene.actions?.[2]).toMatchObject({ audioId: 'tts_speech-2' });
    expect(storeAudioFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: 'tts_speech-1',
        format: 'mp3',
        createdAt: 1234,
      }),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns a single warning and does not throw when TTS fails', async () => {
    const scene = buildScene();
    const storeAudioFile = vi.fn(async () => {});
    const warn = vi.fn();
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: 'No configuration is available for provider "openai-tts".',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    await expect(
      prefetchSceneSpeechAudio({
        scene,
        settings: buildSettings(),
        messages: {
          speechFailed: 'Speech generation failed',
        },
        deps: {
          fetchImpl,
          storeAudioFile,
          warn,
        },
      }),
    ).resolves.toEqual({
      failedCount: 2,
      warningMessage: 'Speech generation failed',
    });

    expect(storeAudioFile).not.toHaveBeenCalled();
    expect(scene.actions?.[0]).toMatchObject({ audioId: 'tts_speech-1' });
    expect(scene.actions?.[2]).toMatchObject({ audioId: 'tts_speech-2' });
    expect(warn).toHaveBeenCalledWith(
      '[GenerationPreview] Continuing without pre-generated speech audio after TTS failures',
      expect.objectContaining({
        providerId: 'openai-tts',
        failedCount: 2,
        totalCount: 2,
        error: 'No configuration is available for provider "openai-tts".',
      }),
    );
  });
});
