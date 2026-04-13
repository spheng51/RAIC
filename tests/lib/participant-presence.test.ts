import { describe, expect, it } from 'vitest';
import {
  getParticipantActivity,
  getParticipantRelativeActivityText,
  sortParticipantsByPresence,
} from '@/lib/utils/participant-presence';

describe('participant presence utilities', () => {
  it('classifies participants by activity age', () => {
    const nowMs = Date.parse('2026-04-13T12:00:00.000Z');

    expect(getParticipantActivity('2026-04-13T11:59:45.000Z', nowMs)).toBe('active');
    expect(getParticipantActivity('2026-04-13T11:55:30.000Z', nowMs)).toBe('just-left');
    expect(getParticipantActivity('2026-04-13T11:50:00.000Z', nowMs)).toBe('idle');
    expect(getParticipantActivity(null, nowMs)).toBe('idle');
  });

  it('formats relative activity text', () => {
    const nowMs = Date.parse('2026-04-13T12:00:00.000Z');

    expect(getParticipantRelativeActivityText('2026-04-13T11:59:45.000Z', nowMs)).toBe('just now');
    expect(getParticipantRelativeActivityText('2026-04-13T11:58:10.000Z', nowMs)).toBe('1m ago');
    expect(getParticipantRelativeActivityText('2026-04-13T10:55:00.000Z', nowMs)).toBe('1h ago');
    expect(getParticipantRelativeActivityText('2026-04-13T08:30:00.000Z', nowMs)).toBe('3h ago');
  });

  it('sorts by speaking, controller, and activity', () => {
    const nowMs = Date.parse('2026-04-13T12:00:00.000Z');
    const sorted = sortParticipantsByPresence(
      [
        {
          displayName: 'Idle Controller',
          isController: true,
          lastSeenAt: '2026-04-13T11:20:00.000Z',
        },
        {
          displayName: 'Active Student',
          isController: false,
          lastSeenAt: '2026-04-13T11:59:30.000Z',
        },
        {
          displayName: 'Speaking Student',
          isController: false,
          lastSeenAt: '2026-04-13T11:10:00.000Z',
          isSpeaking: true,
        },
        {
          displayName: 'Just Left Controller',
          isController: true,
          lastSeenAt: '2026-04-13T11:56:40.000Z',
        },
      ],
      { nowMs },
    );

    expect(sorted.map((participant) => participant.displayName)).toEqual([
      'Speaking Student',
      'Just Left Controller',
      'Idle Controller',
      'Active Student',
    ]);
  });
});
