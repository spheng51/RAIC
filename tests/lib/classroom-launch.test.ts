// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  canUseLocalClassroomFallback,
  clearClassroomLaunchContext,
  getHomePathForLaunchMode,
  isPublicDemoLaunchContext,
  isTeacherServerLaunchContext,
  readClassroomLaunchContext,
  writeClassroomLaunchContext,
} from '@/lib/utils/classroom-launch';

describe('classroom launch helpers', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('stores and restores the launch context from sessionStorage', () => {
    writeClassroomLaunchContext({
      classroomId: 'room-123',
      launchMode: 'teacher-server',
      homePath: '/studio',
    });

    expect(readClassroomLaunchContext()).toEqual({
      classroomId: 'room-123',
      launchMode: 'teacher-server',
      homePath: '/studio',
    });
  });

  it('clears only the matching classroom launch context', () => {
    writeClassroomLaunchContext({
      classroomId: 'room-123',
      launchMode: 'teacher-server',
      homePath: '/studio',
    });

    clearClassroomLaunchContext('room-456');
    expect(readClassroomLaunchContext()?.classroomId).toBe('room-123');

    clearClassroomLaunchContext('room-123');
    expect(readClassroomLaunchContext()).toBeNull();
  });

  it('recognizes when a teacher-backed launch expects a server classroom', () => {
    writeClassroomLaunchContext({
      classroomId: 'room-123',
      launchMode: 'teacher-server',
      homePath: '/studio',
    });

    expect(isTeacherServerLaunchContext(readClassroomLaunchContext(), 'room-123')).toBe(true);
    expect(isTeacherServerLaunchContext(readClassroomLaunchContext(), 'room-456')).toBe(false);
  });

  it('recognizes when a public-demo launch should load from local storage first', () => {
    writeClassroomLaunchContext({
      classroomId: 'room-123',
      launchMode: 'public-demo',
      homePath: '/',
    });

    expect(isPublicDemoLaunchContext(readClassroomLaunchContext(), 'room-123')).toBe(true);
    expect(isPublicDemoLaunchContext(readClassroomLaunchContext(), 'room-456')).toBe(false);
  });

  it('only allows IndexedDB fallback for explicit local/demo contexts', () => {
    expect(
      canUseLocalClassroomFallback({
        expectServerBacked: false,
        hasLocalStage: true,
      }),
    ).toBe(true);
    expect(
      canUseLocalClassroomFallback({
        expectServerBacked: true,
        hasLocalStage: true,
      }),
    ).toBe(false);
    expect(
      canUseLocalClassroomFallback({
        expectServerBacked: false,
        hasLocalStage: false,
      }),
    ).toBe(false);
  });

  it('maps launch modes to the correct home path', () => {
    expect(getHomePathForLaunchMode('public-demo')).toBe('/');
    expect(getHomePathForLaunchMode('teacher-server')).toBe('/studio');
  });
});
