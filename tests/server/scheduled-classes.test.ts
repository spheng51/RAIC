import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformStore } from '@/lib/db/schema';

const readPlatformStoreMock = vi.fn();
const updatePlatformStoreMock = vi.fn();
const runPostgresQueryMock = vi.fn();

vi.mock('@/lib/db/client', () => ({
  isPostgresConfigured: () => false,
  readPlatformStore: readPlatformStoreMock,
  runPostgresQuery: runPostgresQueryMock,
  updatePlatformStore: updatePlatformStoreMock,
}));

vi.mock('@/lib/db/repositories/scheduled-classes', () => ({
  deleteScheduledClassEventRecord: vi.fn(),
  listScheduledClassEventRecordsForAccess: vi.fn(),
  readScheduledClassEventRecord: vi.fn(),
  upsertScheduledClassEventRecord: vi.fn(),
}));

function createStore(): PlatformStore {
  return {
    users: [],
    organizations: [],
    memberships: [],
    sessions: [],
    joinTokens: [],
    auditLogs: [],
    organizationAiPolicies: [],
    organizationProviderConfigs: [],
    userProviderOverrides: [],
    classroomSessionContexts: [],
    classroomReflections: [],
    benchmarkArtifacts: [],
    scheduledClassEvents: [],
  };
}

describe('scheduled class server storage', () => {
  let store: PlatformStore;

  beforeEach(() => {
    vi.resetModules();
    store = createStore();
    readPlatformStoreMock.mockReset();
    updatePlatformStoreMock.mockReset();
    runPostgresQueryMock.mockReset();
    readPlatformStoreMock.mockImplementation(async () => store);
    updatePlatformStoreMock.mockImplementation(async (updater) => updater(store));
    runPostgresQueryMock.mockResolvedValue(null);
  });

  it('persists scheduled classes and scopes access by teacher owner', async () => {
    const {
      createScheduledClassForAccess,
      deleteScheduledClassForAccess,
      listScheduledClassesForAccess,
      updateScheduledClassForAccess,
    } = await import('@/lib/server/scheduled-classes');

    const teacherScope = {
      role: 'teacher' as const,
      userId: 'teacher-1',
      organizationId: 'org-1',
    };
    const otherScope = {
      role: 'teacher' as const,
      userId: 'teacher-2',
      organizationId: 'org-1',
    };

    const created = await createScheduledClassForAccess(teacherScope, {
      title: 'Physics lab',
      startsAt: '2099-05-12T17:00:00.000Z',
      durationMinutes: 45,
    });
    await createScheduledClassForAccess(otherScope, {
      title: 'Other lab',
      startsAt: '2099-05-13T17:00:00.000Z',
    });

    await expect(listScheduledClassesForAccess(teacherScope)).resolves.toEqual([
      expect.objectContaining({ id: created.id, title: 'Physics lab' }),
    ]);
    await expect(
      updateScheduledClassForAccess(otherScope, created.id, {
        title: 'Hijacked',
        startsAt: '2099-05-14T17:00:00.000Z',
      }),
    ).resolves.toBeNull();

    await expect(
      updateScheduledClassForAccess(teacherScope, created.id, {
        title: 'Updated physics lab',
        startsAt: '2099-05-14T17:00:00.000Z',
      }),
    ).resolves.toEqual(expect.objectContaining({ title: 'Updated physics lab' }));
    await expect(deleteScheduledClassForAccess(otherScope, created.id)).resolves.toBe(false);
    await expect(deleteScheduledClassForAccess(teacherScope, created.id)).resolves.toBe(true);
  });

  it('creates multiplayer invites and refreshes expiry when scheduled classes change', async () => {
    const { createScheduledClassForAccess, updateScheduledClassForAccess } =
      await import('@/lib/server/scheduled-classes');

    const teacherScope = {
      role: 'teacher' as const,
      userId: 'teacher-1',
      organizationId: 'org-1',
    };

    const created = await createScheduledClassForAccess(
      teacherScope,
      {
        title: 'Physics game',
        startsAt: '2099-05-12T17:00:00.000Z',
        durationMinutes: 45,
        classroomId: 'room-1',
        multiplayerGame: { enabled: true, mode: 'both', linkPolicy: 'always_open' },
      },
      { multiplayerInviteBaseUrl: 'https://example.test/app' },
    );

    expect(created.multiplayerGame).toEqual(
      expect.objectContaining({
        enabled: true,
        mode: 'both',
        linkPolicy: 'always_open',
        inviteExpiresAt: '2099-05-12T18:45:00.000Z',
      }),
    );
    expect(created.multiplayerGame?.inviteUrl).toMatch(/^https:\/\/example\.test\/join\//);
    expect(store.joinTokens).toHaveLength(1);
    expect(store.joinTokens[0]).toEqual(
      expect.objectContaining({
        classroomId: 'room-1',
        displayName: 'Physics game',
        expiresAt: '2099-05-12T18:45:00.000Z',
      }),
    );

    const originalJoinTokenId = created.multiplayerGame?.joinTokenId;
    const originalInviteUrl = created.multiplayerGame?.inviteUrl;
    const updatedTime = await updateScheduledClassForAccess(
      teacherScope,
      created.id,
      {
        title: 'Physics game later',
        startsAt: '2099-05-12T19:00:00.000Z',
        durationMinutes: 30,
        classroomId: 'room-1',
        multiplayerGame: { enabled: true, mode: 'both', linkPolicy: 'always_open' },
      },
      { multiplayerInviteBaseUrl: 'https://example.test/app' },
    );

    expect(updatedTime?.multiplayerGame?.joinTokenId).toBe(originalJoinTokenId);
    expect(updatedTime?.multiplayerGame?.inviteUrl).toBe(originalInviteUrl);
    expect(updatedTime?.multiplayerGame?.inviteExpiresAt).toBe('2099-05-12T20:30:00.000Z');
    expect(store.joinTokens[0].expiresAt).toBe('2099-05-12T20:30:00.000Z');

    const movedClassroom = await updateScheduledClassForAccess(
      teacherScope,
      created.id,
      {
        title: 'Physics game moved',
        startsAt: '2099-05-13T17:00:00.000Z',
        classroomId: 'room-2',
        multiplayerGame: { enabled: true, mode: 'both', linkPolicy: 'always_open' },
      },
      { multiplayerInviteBaseUrl: 'https://example.test/app' },
    );

    expect(movedClassroom?.multiplayerGame?.joinTokenId).not.toBe(originalJoinTokenId);
    expect(store.joinTokens).toHaveLength(2);
    expect(store.joinTokens[1]).toEqual(
      expect.objectContaining({
        classroomId: 'room-2',
        displayName: 'Physics game moved',
        expiresAt: '2099-05-13T19:00:00.000Z',
      }),
    );
  });
});
