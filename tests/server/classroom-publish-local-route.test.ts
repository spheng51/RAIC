import { promises as fs } from 'fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { HandleUploadOptions } from '@vercel/blob/client';

const requireRequestRoleMock = vi.fn();
const requireClassroomAccessMock = vi.fn();
const handleUploadMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/authorize', () => ({
  requireRequestRole: requireRequestRoleMock,
}));

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@vercel/blob/client', () => ({
  handleUpload: handleUploadMock,
}));

function buildStage() {
  return {
    id: 'local-room',
    name: 'Local demo',
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildScenes() {
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
          elements: [{ id: 'image-1', type: 'image', src: 'gen_img_1' }],
        },
      },
      actions: [{ id: 'speech-1', type: 'speech', text: 'Hello', audioId: 'tts_speech-1' }],
      createdAt: 1,
      updatedAt: 1,
    },
  ];
}

describe('POST /api/classroom/publish-local', () => {
  const originalCwd = process.cwd();
  let testRoot = '';

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    requireRequestRoleMock.mockReset();
    requireClassroomAccessMock.mockReset();
    handleUploadMock.mockReset();
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
    formData.set('stage', JSON.stringify(buildStage()));
    formData.set('scenes', JSON.stringify(buildScenes()));
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

  it('publishes metadata-only JSON without uploading binary assets', async () => {
    requireRequestRoleMock.mockResolvedValue({
      session: {
        role: 'teacher',
        organizationId: 'org-1',
      },
      user: { id: 'teacher-1' },
    });

    const { POST } = await import('@/app/api/classroom/publish-local/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/publish-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: buildStage(),
          scenes: buildScenes(),
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.id).toBeTruthy();
    expect(json.warnings).toEqual([]);

    const { readClassroom } = await import('@/lib/server/classroom-storage');
    const classroom = await readClassroom(json.id);
    const scene = classroom?.scenes[0];
    const imageElement = (
      scene?.content as never as { canvas: { elements: Array<{ src: string }> } }
    ).canvas.elements[0];
    const speechAction = scene?.actions?.[0] as { audioUrl?: string };

    expect(imageElement.src).toBe('gen_img_1');
    expect(speechAction.audioUrl).toBeUndefined();
  });

  it('uploads a single publish asset and rewrites the persisted classroom', async () => {
    requireRequestRoleMock.mockResolvedValue({
      session: {
        role: 'teacher',
        organizationId: 'org-1',
      },
      user: { id: 'teacher-1' },
    });

    const { POST: publish } = await import('@/app/api/classroom/publish-local/route');
    const publishResponse = await publish(
      new NextRequest('http://localhost/api/classroom/publish-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: buildStage(),
          scenes: buildScenes(),
        }),
      }),
    );
    const publishBody = await publishResponse.json();

    const { readClassroom } = await import('@/lib/server/classroom-storage');
    const classroom = await readClassroom(publishBody.id);
    requireClassroomAccessMock.mockResolvedValue({
      source: 'web',
      auth: {
        session: { kind: 'web', role: 'teacher', organizationId: 'org-1' },
        user: { id: 'teacher-1' },
      },
      classroom,
    });

    const { POST: upload } = await import('@/app/api/classroom/[id]/publish-local-asset/route');
    const mediaFormData = new FormData();
    mediaFormData.set('kind', 'media');
    mediaFormData.set('assetId', 'gen_img_1');
    mediaFormData.set(
      'file',
      new File([new Uint8Array([1, 2, 3])], 'gen_img_1.png', { type: 'image/png' }),
    );
    const mediaResponse = await upload(
      new NextRequest(`http://localhost/api/classroom/${publishBody.id}/publish-local-asset`, {
        method: 'POST',
        body: mediaFormData,
      }),
      { params: Promise.resolve({ id: publishBody.id }) },
    );

    const audioFormData = new FormData();
    audioFormData.set('kind', 'audio');
    audioFormData.set('assetId', 'tts_speech-1');
    audioFormData.set(
      'file',
      new File([new Uint8Array([4, 5, 6])], 'tts_speech-1.mp3', { type: 'audio/mpeg' }),
    );
    const audioResponse = await upload(
      new NextRequest(`http://localhost/api/classroom/${publishBody.id}/publish-local-asset`, {
        method: 'POST',
        body: audioFormData,
      }),
      { params: Promise.resolve({ id: publishBody.id }) },
    );

    expect(mediaResponse.status).toBe(200);
    expect(audioResponse.status).toBe(200);

    const updated = await readClassroom(publishBody.id);
    const scene = updated?.scenes[0];
    const imageElement = (
      scene?.content as never as { canvas: { elements: Array<{ src: string }> } }
    ).canvas.elements[0];
    const speechAction = scene?.actions?.[0] as { audioUrl?: string };

    expect(imageElement.src).toContain(
      `/api/classroom-media/${publishBody.id}/media/gen_img_1.png`,
    );
    expect(speechAction.audioUrl).toContain(
      `/api/classroom-media/${publishBody.id}/audio/tts_speech-1.mp3`,
    );
  });

  it('attaches a directly uploaded remote asset URL to the persisted classroom', async () => {
    requireRequestRoleMock.mockResolvedValue({
      session: {
        role: 'teacher',
        organizationId: 'org-1',
      },
      user: { id: 'teacher-1' },
    });

    const { POST: publish } = await import('@/app/api/classroom/publish-local/route');
    const publishResponse = await publish(
      new NextRequest('http://localhost/api/classroom/publish-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: buildStage(),
          scenes: buildScenes(),
        }),
      }),
    );
    const publishBody = await publishResponse.json();

    const { readClassroom } = await import('@/lib/server/classroom-storage');
    const classroom = await readClassroom(publishBody.id);
    requireClassroomAccessMock.mockResolvedValue({
      source: 'web',
      auth: {
        session: { kind: 'web', role: 'teacher', organizationId: 'org-1' },
        user: { id: 'teacher-1' },
      },
      classroom,
    });

    const remoteUrl = 'https://blob.example.com/classrooms/room-1/media/gen_img_1.png';
    const { POST: upload } = await import('@/app/api/classroom/[id]/publish-local-asset/route');
    const response = await upload(
      new NextRequest(`http://localhost/api/classroom/${publishBody.id}/publish-local-asset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'media',
          assetId: 'gen_img_1',
          url: remoteUrl,
        }),
      }),
      { params: Promise.resolve({ id: publishBody.id }) },
    );

    expect(response.status).toBe(200);

    const updated = await readClassroom(publishBody.id);
    const imageElement = (
      updated?.scenes[0]?.content as never as { canvas: { elements: Array<{ src: string }> } }
    ).canvas.elements[0];

    expect(imageElement.src).toBe(remoteUrl);
  });

  it('generates direct upload tokens and attaches completed Blob uploads', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test');
    handleUploadMock.mockImplementation(async (options: HandleUploadOptions) => {
      if (options.body.type === 'blob.generate-client-token') {
        const payload = options.body.payload;
        await options.onBeforeGenerateToken(
          payload.pathname,
          payload.clientPayload,
          payload.multipart,
        );
        return { type: 'blob.generate-client-token', clientToken: 'client-token' };
      }

      await options.onUploadCompleted?.(options.body.payload);
      return { type: 'blob.upload-completed', response: 'ok' };
    });

    requireRequestRoleMock.mockResolvedValue({
      session: {
        role: 'teacher',
        organizationId: 'org-1',
      },
      user: { id: 'teacher-1' },
    });

    const { POST: publish } = await import('@/app/api/classroom/publish-local/route');
    const publishResponse = await publish(
      new NextRequest('http://localhost/api/classroom/publish-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: buildStage(),
          scenes: buildScenes(),
        }),
      }),
    );
    const publishBody = await publishResponse.json();

    const { readClassroom } = await import('@/lib/server/classroom-storage');
    const classroom = await readClassroom(publishBody.id);
    requireClassroomAccessMock.mockResolvedValue({
      source: 'web',
      auth: {
        session: { kind: 'web', role: 'teacher', organizationId: 'org-1' },
        user: { id: 'teacher-1' },
      },
      classroom,
    });

    const { publishAssetPathname } = await import('@/lib/server/classroom-publish-assets');
    const clientPayload = JSON.stringify({
      kind: 'media',
      assetId: 'gen_img_1',
      filename: 'gen_img_1.png',
      mimeType: 'image/png',
    });
    const pathname = publishAssetPathname({
      classroomId: publishBody.id,
      kind: 'media',
      assetId: 'gen_img_1',
      filename: 'gen_img_1.png',
    });

    const { POST: directUpload } =
      await import('@/app/api/classroom/[id]/publish-local-asset/direct/route');
    const tokenResponse = await directUpload(
      new NextRequest(
        `http://localhost/api/classroom/${publishBody.id}/publish-local-asset/direct`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'blob.generate-client-token',
            payload: {
              pathname,
              multipart: true,
              clientPayload,
            },
          }),
        },
      ),
      { params: Promise.resolve({ id: publishBody.id }) },
    );
    const tokenBody = await tokenResponse.json();

    expect(tokenResponse.status).toBe(200);
    expect(tokenBody.clientToken).toBe('client-token');

    const remoteUrl = 'https://blob.example.com/classrooms/room-1/media/gen_img_1.png';
    const completedResponse = await directUpload(
      new NextRequest(
        `http://localhost/api/classroom/${publishBody.id}/publish-local-asset/direct`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'blob.upload-completed',
            payload: {
              blob: {
                url: remoteUrl,
              },
              tokenPayload: JSON.stringify({
                classroomId: publishBody.id,
                kind: 'media',
                assetId: 'gen_img_1',
              }),
            },
          }),
        },
      ),
      { params: Promise.resolve({ id: publishBody.id }) },
    );

    expect(completedResponse.status).toBe(200);

    const updated = await readClassroom(publishBody.id);
    const imageElement = (
      updated?.scenes[0]?.content as never as { canvas: { elements: Array<{ src: string }> } }
    ).canvas.elements[0];

    expect(imageElement.src).toBe(remoteUrl);
  });

  it('rejects unauthorized single-asset uploads', async () => {
    requireClassroomAccessMock.mockResolvedValue(
      NextResponse.json(
        {
          success: false,
          errorCode: 'FORBIDDEN',
          error: 'Denied',
        },
        { status: 403 },
      ),
    );

    const { POST } = await import('@/app/api/classroom/[id]/publish-local-asset/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/publish-local-asset', {
        method: 'POST',
        body: new FormData(),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(403);
  });

  it('rejects invalid single-asset upload requests', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      source: 'web',
      auth: {
        session: { kind: 'web', role: 'teacher', organizationId: 'org-1' },
        user: { id: 'teacher-1' },
      },
      classroom: {},
    });

    const { POST } = await import('@/app/api/classroom/[id]/publish-local-asset/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/publish-local-asset', {
        method: 'POST',
        body: new FormData(),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(400);
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
