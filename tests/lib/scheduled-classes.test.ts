import { describe, expect, it } from 'vitest';
import {
  getUpcomingScheduledClassEvents,
  normalizeScheduledClassInput,
  sortScheduledClassEvents,
} from '@/lib/utils/scheduled-classes';
import type { ScheduledClassEvent } from '@/lib/types/scheduled-classes';

function event(id: string, startsAt: string): ScheduledClassEvent {
  return {
    id,
    title: `Class ${id}`,
    startsAt,
    createdAt: '2026-05-11T00:00:00.000Z',
    updatedAt: '2026-05-11T00:00:00.000Z',
  };
}

describe('scheduled class utilities', () => {
  it('normalizes valid scheduled class input', () => {
    const result = normalizeScheduledClassInput(
      {
        title: '  Physics lab  ',
        startsAt: '2026-05-12T17:00:00.000Z',
        durationMinutes: 45,
        classroomId: ' room-1 ',
      },
      { requireFutureStart: true, now: new Date('2026-05-11T17:00:00.000Z') },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        title: 'Physics lab',
        startsAt: '2026-05-12T17:00:00.000Z',
        durationMinutes: 45,
        classroomId: 'room-1',
      },
    });
  });

  it('rejects missing title, past starts, and invalid durations', () => {
    expect(
      normalizeScheduledClassInput({
        title: ' ',
        startsAt: '2026-05-12T17:00:00.000Z',
      }),
    ).toEqual({ ok: false, error: 'Class title is required.' });

    expect(
      normalizeScheduledClassInput(
        {
          title: 'Office hours',
          startsAt: '2026-05-10T17:00:00.000Z',
        },
        { requireFutureStart: true, now: new Date('2026-05-11T17:00:00.000Z') },
      ),
    ).toEqual({ ok: false, error: 'Choose a future start time.' });

    expect(
      normalizeScheduledClassInput({
        title: 'Office hours',
        startsAt: '2026-05-12T17:00:00.000Z',
        durationMinutes: 0,
      }),
    ).toEqual({ ok: false, error: 'Duration must be between 1 minute and 24 hours.' });
  });

  it('sorts events and returns at most five upcoming events', () => {
    const events = [
      event('past', '2026-05-10T17:00:00.000Z'),
      event('6', '2026-05-17T17:00:00.000Z'),
      event('2', '2026-05-13T17:00:00.000Z'),
      event('1', '2026-05-12T17:00:00.000Z'),
      event('4', '2026-05-15T17:00:00.000Z'),
      event('3', '2026-05-14T17:00:00.000Z'),
      event('5', '2026-05-16T17:00:00.000Z'),
    ];

    expect(sortScheduledClassEvents(events).map((item) => item.id)).toEqual([
      'past',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
    expect(
      getUpcomingScheduledClassEvents(events, { now: new Date('2026-05-11T17:00:00.000Z') }).map(
        (item) => item.id,
      ),
    ).toEqual(['1', '2', '3', '4', '5']);
  });
});
