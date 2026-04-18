import { describe, expect, it } from 'vitest';
import type { ClassroomPresentationStatePayload } from '@/lib/types/classroom-presentation';
import type { SharedSimulation } from '@/lib/types/stage';
import { mergePresentationStateSharedSimulation } from '@/lib/utils/classroom-presentation';

function buildSharedSimulation(overrides: Partial<SharedSimulation> = {}): SharedSimulation {
  return {
    provider: 'mirofish',
    simulationId: 'sim-1',
    reportId: 'report-1',
    runUrl: 'https://mirofish.example/simulation/sim-1/start?embed=1',
    reportUrl: 'https://mirofish.example/report/report-1?embed=1',
    activeSurface: 'simulation',
    controllerSessionId: 'student-session',
    controllerRole: 'student',
    controlLeaseExpiresAt: '2026-04-17T00:10:00.000Z',
    collaborationMode: 'single-controller',
    collaborationState: 'inactive',
    allowStudentInteraction: false,
    status: 'running',
    ...overrides,
  };
}

function buildPresentationState(
  overrides: Partial<ClassroomPresentationStatePayload> = {},
): ClassroomPresentationStatePayload {
  const sharedSimulation =
    overrides.sharedSimulation ??
    buildSharedSimulation({
      runUrl: 'https://mirofish.example/simulation/sim-1/start?embed=1&classroomToken=teacher',
      reportUrl: 'https://mirofish.example/report/report-1?embed=1&classroomToken=teacher',
    });

  return {
    activeSurface: sharedSimulation.activeSurface,
    controllerSessionId: sharedSimulation.controllerSessionId ?? null,
    controllerRole: sharedSimulation.controllerRole,
    controlLeaseExpiresAt: sharedSimulation.controlLeaseExpiresAt ?? null,
    simulationStatus: sharedSimulation.status,
    reportAvailable: true,
    sharedSimulation,
    runUrl: sharedSimulation.runUrl,
    reportUrl: sharedSimulation.reportUrl ?? null,
    viewerSessionId: 'teacher-session',
    viewerRole: 'teacher',
    viewerKind: 'web',
    viewerCanManageSimulation: true,
    viewerCanControlPresentation: true,
    viewerHasSimulationControl: false,
    participants: [],
    ...overrides,
  };
}

describe('mergePresentationStateSharedSimulation', () => {
  it('restores teacher control without discarding the tokenized iframe URLs', () => {
    const previousState = buildPresentationState();

    const merged = mergePresentationStateSharedSimulation(
      previousState,
      buildSharedSimulation({
        runUrl: 'https://mirofish.example/simulation/sim-1/start?embed=1',
        reportUrl: 'https://mirofish.example/report/report-1?embed=1',
        controllerSessionId: undefined,
        controllerRole: 'teacher',
        controlLeaseExpiresAt: undefined,
      }),
    );

    expect(merged.controllerRole).toBe('teacher');
    expect(merged.controllerSessionId).toBeNull();
    expect(merged.controlLeaseExpiresAt).toBeNull();
    expect(merged.viewerCanControlPresentation).toBe(true);
    expect(merged.viewerHasSimulationControl).toBe(true);
    expect(merged.runUrl).toBe(
      'https://mirofish.example/simulation/sim-1/start?embed=1&classroomToken=teacher',
    );
    expect(merged.sharedSimulation?.runUrl).toBe(
      'https://mirofish.example/simulation/sim-1/start?embed=1&classroomToken=teacher',
    );
    expect(merged.reportUrl).toBe(
      'https://mirofish.example/report/report-1?embed=1&classroomToken=teacher',
    );
  });

  it('keeps classroom viewers read-only when control returns to the teacher', () => {
    const previousState = buildPresentationState({
      viewerSessionId: 'student-session',
      viewerRole: 'student',
      viewerKind: 'classroom',
      viewerCanManageSimulation: false,
      viewerCanControlPresentation: true,
      viewerHasSimulationControl: true,
    });

    const merged = mergePresentationStateSharedSimulation(
      previousState,
      buildSharedSimulation({
        controllerSessionId: undefined,
        controllerRole: 'teacher',
        controlLeaseExpiresAt: undefined,
      }),
    );

    expect(merged.viewerCanControlPresentation).toBe(false);
    expect(merged.viewerHasSimulationControl).toBe(false);
    expect(merged.controllerRole).toBe('teacher');
  });
});
