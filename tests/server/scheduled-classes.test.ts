import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformStore } from '@/lib/db/schema';

const readPlatformStoreMock = vi.fn();
const updatePlatformStoreMock = vi.fn();

vi.mock('@/lib/db/client', () => ({
  isPostgresConfigured: () => false,
  readPlatformStore: readPlatformStoreMock,
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
    readPlatformStoreMock.mockImplementation(async () => store);
    updatePlatformStoreMock.mockImplementation(async (updater) => updater(store));
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
});
