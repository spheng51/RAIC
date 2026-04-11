import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createMockRequest(origin: string, headers?: Record<string, string>) {
  return {
    headers: {
      get(name: string) {
        const normalizedName = name.toLowerCase();
        return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === normalizedName)?.[1] ?? null;
      },
    },
    nextUrl: new URL(origin),
  } as never;
}

describe('classroom-storage helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves classroom JSON paths inside the classroom data directory', async () => {
    const { CLASSROOMS_DIR, resolveClassroomJsonPath } = await import('@/lib/server/classroom-storage');

    expect(resolveClassroomJsonPath('safe-id')).toBe(path.resolve(CLASSROOMS_DIR, 'safe-id.json'));
  });

  it('rejects classroom IDs whose resolved path escapes the classroom data directory', async () => {
    const { resolveClassroomJsonPath } = await import('@/lib/server/classroom-storage');

    expect(() => resolveClassroomJsonPath('../escape')).toThrow('Invalid classroom id');
  });

  it('prefers APP_BASE_URL when building absolute classroom URLs', async () => {
    vi.stubEnv('APP_BASE_URL', 'https://app.example.com/classrooms/root?foo=bar');

    const { buildRequestOrigin } = await import('@/lib/server/classroom-storage');

    const origin = buildRequestOrigin(createMockRequest('http://localhost:3000/api/classroom'));

    expect(origin).toBe('https://app.example.com');
  });

  it('falls back to the request origin when APP_BASE_URL is unset', async () => {
    const { buildRequestOrigin } = await import('@/lib/server/classroom-storage');

    const origin = buildRequestOrigin(createMockRequest('http://localhost:3000/api/classroom'));

    expect(origin).toBe('http://localhost:3000');
  });

  it('ignores forwarded headers when APP_BASE_URL is set', async () => {
    vi.stubEnv('APP_BASE_URL', 'https://app.example.com/root');

    const { buildRequestOrigin } = await import('@/lib/server/classroom-storage');

    const origin = buildRequestOrigin(
      createMockRequest('http://localhost:3000/api/classroom', {
        'x-forwarded-host': 'evil.example.com',
        'x-forwarded-proto': 'https',
      }),
    );

    expect(origin).toBe('https://app.example.com');
  });

  it('ignores forwarded headers when falling back to req.nextUrl.origin', async () => {
    const { buildRequestOrigin } = await import('@/lib/server/classroom-storage');

    const origin = buildRequestOrigin(
      createMockRequest('http://localhost:3000/api/classroom', {
        'x-forwarded-host': 'evil.example.com',
        'x-forwarded-proto': 'https',
      }),
    );

    expect(origin).toBe('http://localhost:3000');
  });
});
