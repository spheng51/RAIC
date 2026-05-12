import { promises as fs } from 'fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireRequestRoleMock = vi.fn();

vi.mock('@/lib/auth/authorize', () => ({
  requireRequestRole: requireRequestRoleMock,
}));

describe('POST /api/classroom/publish-local', () => {
  const originalCwd = process.cwd();
  let testRoot = '';

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    requireRequestRoleMock.mockReset();
    testRoot = path.join(
      originalCwd,
      '.vitest-tmp',
      `publish-local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    vi.spyOn(process, 'cwd').mockReturnValue(testRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(testRoot, {
      recursive: true,
      force: true,
    });
  });

  it('publishes a local classroom and rewrites uploaded media and audio assets', async () => {
    requireRequestRoleMock.mockResolvedValue({
      session: {
        role: 'teacher',
        organizationId: 'org-1',
      },
      user: { id: 'teacher-1' },
    });

    const formData = new FormData();
    formData.set(
      'stage',
      JSON.stringify({
        id: 'local-room',
        name: 'Local demo',
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    formData.set(
      'scenes',
      JSON.stringify([
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
              elements: [{ id: 'image-1', type: 'image', src: 'gen_img_1' }],
            },
          },
          actions: [{ id: 'speech-1', type: 'speech', text: 'Hello', audioId: 'tts_speech-1' }],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );
    formData.append(
      'media:gen_img_1',
      new File([new Uint8Array([1, 2, 3])], 'gen_img_1.png', { type: 'image/png' }),
    );
    formData.append(
      'audio:tts_speech-1',
      new File([new Uint8Array([4, 5, 6])], 'tts_speech-1.mp3', { type: 'audio/mpeg' }),
    );

    const { POST } = await import('@/app/api/classroom/publish-local/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/publish-local', {
        method: 'POST',
        body: formData,
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.id).toBeTruthy();
    expect(json.url).toBe(`http://localhost/classroom/${json.id}`);
    expect(json.warnings).toEqual([]);

    const { readClassroom } = await import('@/lib/server/classroom-storage');
    const classroom = await readClassroom(json.id);
    const scene = classroom?.scenes[0];
    const imageElement = (
      scene?.content as never as { canvas: { elements: Array<{ src: string }> } }
    ).canvas.elements[0];
    const speechAction = scene?.actions?.[0] as { audioUrl?: string };

    expect(classroom?.ownerUserId).toBe('teacher-1');
    expect(classroom?.organizationId).toBe('org-1');
    expect(imageElement.src).toContain(`/api/classroom-media/${json.id}/media/gen_img_1.png`);
    expect(speechAction.audioUrl).toContain(
      `/api/classroom-media/${json.id}/audio/tts_speech-1.mp3`,
    );
  });

  it('requires teacher auth', async () => {
    requireRequestRoleMock.mockResolvedValue(
      NextResponse.json(
        {
          success: false,
          errorCode: 'UNAUTHORIZED',
          error: 'Authentication required',
        },
        { status: 401 },
      ),
    );

    const { POST } = await import('@/app/api/classroom/publish-local/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/publish-local', {
        method: 'POST',
        body: new FormData(),
      }),
    );

    expect(response.status).toBe(401);
  });
});
