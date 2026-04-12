import { describe, expect, it } from 'vitest';
import {
  buildLiveClassroomApprovalItems,
  buildLiveClassroomStudentPulse,
  canShowLiveClassroomCockpit,
  getLiveClassroomSurfaceLabel,
} from '@/lib/utils/live-classroom-cockpit';

describe('live classroom cockpit helpers', () => {
  it('shows the cockpit only for non-student web viewers', () => {
    expect(
      canShowLiveClassroomCockpit({
        viewerKind: 'web',
        viewerRole: 'teacher',
      }),
    ).toBe(true);

    expect(
      canShowLiveClassroomCockpit({
        viewerKind: 'web',
        viewerRole: 'org_admin',
      }),
    ).toBe(true);

    expect(
      canShowLiveClassroomCockpit({
        viewerKind: 'classroom',
        viewerRole: 'student',
      }),
    ).toBe(false);
  });

  it('derives pulse metrics from classroom participants', () => {
    const pulse = buildLiveClassroomStudentPulse([
      {
        sessionId: 'teacher-session',
        userId: 'teacher-1',
        displayName: 'Teacher',
        role: 'teacher',
        lastSeenAt: '2026-04-11T00:00:00.000Z',
        isController: false,
      },
      {
        sessionId: 'student-1',
        userId: 'student-1',
        displayName: 'Student One',
        role: 'student',
        lastSeenAt: '2026-04-11T00:00:00.000Z',
        isController: true,
      },
      {
        sessionId: 'student-2',
        userId: 'student-2',
        displayName: 'Student Two',
        role: 'student',
        lastSeenAt: '2026-04-11T00:00:00.000Z',
        isController: false,
      },
    ]);

    expect(pulse.studentCount).toBe(2);
    expect(pulse.teacherCount).toBe(1);
    expect(pulse.controllerCount).toBe(1);
    expect(pulse.activeStudents.map((participant) => participant.displayName)).toEqual([
      'Student One',
      'Student Two',
    ]);
  });

  it('builds the highest-signal approval suggestions for the teacher inbox', () => {
    const approvals = buildLiveClassroomApprovalItems({
      currentSceneId: 'scene-2',
      currentSceneTitle: 'Energy Transfer',
      activeSurface: 'lesson',
      whiteboardOpen: false,
      reportAvailable: true,
      playbackCompleted: true,
      hasNextScene: true,
      hasSharedSimulation: true,
    });

    expect(approvals.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'scene-next-scene-2',
        'scene-replay-scene-2',
        'surface-open-simulation',
        'surface-open-report',
        'whiteboard-open-scene-2',
        'prompt-recap-scene-2',
      ]),
    );
  });

  it('labels lesson + whiteboard as whiteboard for the cockpit live bar', () => {
    expect(getLiveClassroomSurfaceLabel('lesson', true)).toBe('Whiteboard');
    expect(getLiveClassroomSurfaceLabel('lesson', false)).toBe('Lesson');
    expect(getLiveClassroomSurfaceLabel('simulation', false)).toBe('Simulation');
  });
});
