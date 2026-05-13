import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scene, Stage } from '@/lib/types/stage';

const dbMocks = vi.hoisted(() => ({
  mediaToArray: vi.fn(),
  audioGet: vi.fn(),
}));

vi.mock('@/lib/utils/database', () => ({
  db: {
    mediaFiles: {
      where: () => ({
        equals: () => ({
          toArray: dbMocks.mediaToArray,
        }),
      }),
    },
    audioFiles: {
      get: dbMocks.audioGet,
    },
  },
}));

function buildStage(): Stage {
  return {
    id: 'local-room',
    name: 'Local room',
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildScenes(): Scene[] {
  return [
    {
      id: 'scene-1',
      stageId: 'local-room',
      type: 'slide',
      title: 'Intro',
      order: 0,
      content: {
        type: 'slide',
        canvas: {
          id: 'slide-1',
          viewportSize: 1000,
          viewportRatio: 0.5625,
          theme: {
            backgroundColor: '#ffffff',
            themeColors: ['#5b9bd5'],
            fontColor: '#333333',
            fontName: 'Inter',
          },
          elements: [
            {
              id: 'image-1',
              type: 'image',
              src: 'gen_img_1',
              fixedRatio: true,
              left: 0,
              top: 0,
              width: 100,
              height: 100,
              rotate: 0,
            },
          ],
        },
      },
      actions: [{ id: 'speech-1', type: 'speech', text: 'Hello', audioId: 'tts_speech-1' }],
      createdAt: 1,
      updatedAt: 1,
    },
  ];
}

function containsBlob(value: unknown): boolean {
  if (value instanceof Blob) return true;
  if (Array.isArray(value)) return value.some((entry) => containsBlob(entry));
  if (value && typeof value === 'object') {
    return Object.values(value).some((entry) => containsBlob(entry));
  }
  return false;
}

describe('buildLocalClassroomPublishManifest', () => {
  beforeEach(() => {
    dbMocks.mediaToArray.mockReset();
    dbMocks.audioGet.mockReset();
  });

  it('keeps metadata JSON free of binary blobs and queues small assets', async () => {
    dbMocks.mediaToArray.mockResolvedValue([
      {
        id: 'local-room:gen_img_1',
        stageId: 'local-room',
        type: 'image',
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
        mimeType: 'image/png',
      },
    ]);
    dbMocks.audioGet.mockResolvedValue({
      id: 'tts_speech-1',
      blob: new Blob([new Uint8Array([4, 5, 6])], { type: 'audio/mpeg' }),
      format: 'mpeg',
    });

    const { buildLocalClassroomPublishManifest } = await import('@/lib/utils/classroom-publish');
    const manifest = await buildLocalClassroomPublishManifest({
      stage: buildStage(),
      scenes: buildScenes(),
    });

    expect(manifest.assets).toHaveLength(2);
    expect(manifest.directAssets).toHaveLength(0);
    expect(containsBlob(manifest.stage)).toBe(false);
    expect(containsBlob(manifest.scenes)).toBe(false);
    expect(manifest.warnings).toEqual([]);
  });

  it('skips oversized assets with warnings', async () => {
    dbMocks.mediaToArray.mockResolvedValue([
      {
        id: 'local-room:gen_img_1',
        stageId: 'local-room',
        type: 'image',
        blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }),
        mimeType: 'image/png',
      },
    ]);
    dbMocks.audioGet.mockResolvedValue(null);

    const { buildLocalClassroomPublishManifest } = await import('@/lib/utils/classroom-publish');
    const manifest = await buildLocalClassroomPublishManifest({
      stage: buildStage(),
      scenes: buildScenes(),
      maxAssetBytes: 3,
    });

    expect(manifest.assets).toHaveLength(0);
    expect(manifest.warnings.map((warning) => warning.code)).toContain('asset_too_large');
    expect(manifest.warnings.map((warning) => warning.code)).toContain('audio_asset_missing');
  });

  it('queues assets above the function payload cap for direct upload when enabled', async () => {
    dbMocks.mediaToArray.mockResolvedValue([
      {
        id: 'local-room:gen_img_1',
        stageId: 'local-room',
        type: 'image',
        blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }),
        mimeType: 'image/png',
      },
    ]);
    dbMocks.audioGet.mockResolvedValue(null);

    const { buildLocalClassroomPublishManifest } = await import('@/lib/utils/classroom-publish');
    const manifest = await buildLocalClassroomPublishManifest({
      stage: buildStage(),
      scenes: buildScenes(),
      maxAssetBytes: 3,
      directUploadAssets: true,
      directMaxAssetBytes: 10,
    });

    expect(manifest.assets).toHaveLength(0);
    expect(manifest.directAssets).toMatchObject([{ kind: 'media', assetId: 'gen_img_1' }]);
    expect(manifest.warnings.map((warning) => warning.code)).not.toContain('asset_too_large');
    expect(manifest.warnings.map((warning) => warning.code)).toContain('audio_asset_missing');
  });

  it('skips assets above the direct upload safety limit', async () => {
    dbMocks.mediaToArray.mockResolvedValue([
      {
        id: 'local-room:gen_img_1',
        stageId: 'local-room',
        type: 'image',
        blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }),
        mimeType: 'image/png',
      },
    ]);
    dbMocks.audioGet.mockResolvedValue(null);

    const { buildLocalClassroomPublishManifest } = await import('@/lib/utils/classroom-publish');
    const manifest = await buildLocalClassroomPublishManifest({
      stage: buildStage(),
      scenes: buildScenes(),
      maxAssetBytes: 3,
      directUploadAssets: true,
      directMaxAssetBytes: 3,
    });

    expect(manifest.assets).toHaveLength(0);
    expect(manifest.directAssets).toHaveLength(0);
    expect(manifest.warnings.map((warning) => warning.code)).toContain('asset_too_large');
  });

  it('preserves existing remote asset URLs without queueing uploads', async () => {
    dbMocks.mediaToArray.mockResolvedValue([
      {
        id: 'local-room:gen_img_1',
        stageId: 'local-room',
        type: 'image',
        blob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
        mimeType: 'image/png',
        ossKey: 'https://cdn.example/media/gen_img_1.png',
      },
    ]);
    dbMocks.audioGet.mockResolvedValue({
      id: 'tts_speech-1',
      blob: new Blob([new Uint8Array([2])], { type: 'audio/mpeg' }),
      format: 'mpeg',
      ossKey: 'https://cdn.example/audio/tts_speech-1.mp3',
    });

    const { buildLocalClassroomPublishManifest } = await import('@/lib/utils/classroom-publish');
    const manifest = await buildLocalClassroomPublishManifest({
      stage: buildStage(),
      scenes: buildScenes(),
    });

    const scene = manifest.scenes[0];
    const imageElement = (
      scene.content as never as { canvas: { elements: Array<{ src: string }> } }
    ).canvas.elements[0];
    const speechAction = scene.actions?.[0] as { audioUrl?: string };

    expect(manifest.assets).toEqual([]);
    expect(manifest.directAssets).toEqual([]);
    expect(imageElement.src).toBe('https://cdn.example/media/gen_img_1.png');
    expect(speechAction.audioUrl).toBe('https://cdn.example/audio/tts_speech-1.mp3');
  });
});
