import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toArrayMock = vi.fn();
const getMock = vi.fn();
const putMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('@/lib/utils/database', () => ({
  db: {
    scheduledClassEvents: {
      toArray: toArrayMock,
      get: getMock,
      put: putMock,
      delete: deleteMock,
    },
  },
}));

describe('local scheduled class storage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T17:00:00.000Z'));
    toArrayMock.mockReset();
    getMock.mockReset();
    putMock.mockReset();
    deleteMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists local events sorted by start time', async () => {
    toArrayMock.mockResolvedValue([
      {
        id: 'later',
        title: 'Later',
        startsAt: '2026-05-13T17:00:00.000Z',
        createdAt: '2026-05-11T00:00:00.000Z',
        updatedAt: '2026-05-11T00:00:00.000Z',
      },
      {
        id: 'sooner',
        title: 'Sooner',
        startsAt: '2026-05-12T17:00:00.000Z',
        createdAt: '2026-05-11T00:00:00.000Z',
        updatedAt: '2026-05-11T00:00:00.000Z',
      },
    ]);

    const { listLocalScheduledClassEvents } = await import('@/lib/utils/scheduled-classes-storage');

    await expect(listLocalScheduledClassEvents()).resolves.toMatchObject([
      { id: 'sooner' },
      { id: 'later' },
    ]);
  });

  it('creates, updates, and deletes local events', async () => {
    const {
      createLocalScheduledClassEvent,
      updateLocalScheduledClassEvent,
      deleteLocalScheduledClassEvent,
    } = await import('@/lib/utils/scheduled-classes-storage');

    const created = await createLocalScheduledClassEvent({
      title: 'Lab',
      startsAt: '2026-05-12T17:00:00.000Z',
      durationMinutes: 30,
      classroomId: 'room-1',
    });
    expect(created).toEqual(
      expect.objectContaining({
        title: 'Lab',
        startsAt: '2026-05-12T17:00:00.000Z',
        durationMinutes: 30,
        classroomId: 'room-1',
        createdAt: '2026-05-11T17:00:00.000Z',
      }),
    );
    expect(putMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Lab' }));

    getMock.mockResolvedValue(created);
    const updated = await updateLocalScheduledClassEvent(created.id, {
      title: 'Updated lab',
      startsAt: '2026-05-12T18:00:00.000Z',
    });
    expect(updated).toEqual(expect.objectContaining({ title: 'Updated lab' }));
    expect(updated.durationMinutes).toBeUndefined();
    expect(updated.classroomId).toBeUndefined();
    expect(putMock).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Updated lab' }));

    await deleteLocalScheduledClassEvent(created.id);
    expect(deleteMock).toHaveBeenCalledWith(created.id);
  });
});
