import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { MiroFishCreationSpec } from '@/lib/types/mirofish-authoring';

const requireRequestRoleMock = vi.fn();
const requireClassroomAccessMock = vi.fn();
const resolveModelFromHeadersWithScopeMock = vi.fn();
const callLLMMock = vi.fn();
const assertMiroFishAuthoringAvailableMock = vi.fn();
const generateMiroFishCreationSpecMock = vi.fn();
const publishMiroFishAuthoringJobMock = vi.fn();
const readMiroFishAuthoringJobStatusMock = vi.fn();
const buildMiroFishCreationBriefPreviewMock = vi.fn();
const buildMiroFishCreationFailureMessageMock = vi.fn();
const createMiroFishCreationJobMock = vi.fn();
const readMiroFishCreationJobMock = vi.fn();
const updateMiroFishCreationJobMock = vi.fn();
const canAccessMiroFishCreationJobMock = vi.fn();
const isValidMiroFishCreationJobIdMock = vi.fn();
const isMiroFishMultiUserEnabledMock = vi.fn();
const validateMiroFishSimulationMock = vi.fn();
const validateMiroFishReportMock = vi.fn();
const buildAttachedMiroFishSharedSimulationMock = vi.fn();
const updateClassroomMock = vi.fn();
const recordAuditEventMock = vi.fn();

vi.mock('@/lib/auth/authorize', () => ({
  requireRequestRole: requireRequestRoleMock,
}));

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModelFromHeadersWithScope: resolveModelFromHeadersWithScopeMock,
}));

vi.mock('@/lib/ai/llm', () => ({
  callLLM: callLLMMock,
}));

vi.mock('@/lib/server/mirofish-authoring', () => ({
  assertMiroFishAuthoringAvailable: assertMiroFishAuthoringAvailableMock,
  generateMiroFishCreationSpec: generateMiroFishCreationSpecMock,
  publishMiroFishAuthoringJob: publishMiroFishAuthoringJobMock,
  readMiroFishAuthoringJobStatus: readMiroFishAuthoringJobStatusMock,
  buildMiroFishCreationBriefPreview: buildMiroFishCreationBriefPreviewMock,
  buildMiroFishCreationFailureMessage: buildMiroFishCreationFailureMessageMock,
}));

vi.mock('@/lib/server/mirofish-authoring-job-store', () => ({
  createMiroFishCreationJob: createMiroFishCreationJobMock,
  readMiroFishCreationJob: readMiroFishCreationJobMock,
  updateMiroFishCreationJob: updateMiroFishCreationJobMock,
  canAccessMiroFishCreationJob: canAccessMiroFishCreationJobMock,
  isValidMiroFishCreationJobId: isValidMiroFishCreationJobIdMock,
}));

vi.mock('@/lib/server/mirofish', () => ({
  isMiroFishMultiUserEnabled: isMiroFishMultiUserEnabledMock,
  validateMiroFishSimulation: validateMiroFishSimulationMock,
  validateMiroFishReport: validateMiroFishReportMock,
  buildAttachedMiroFishSharedSimulation: buildAttachedMiroFishSharedSimulationMock,
}));

vi.mock('@/lib/server/classroom-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/classroom-storage')>();
  return {
    ...actual,
    updateClassroom: updateClassroomMock,
  };
});

vi.mock('@/lib/server/audit-log', () => ({
  recordAuditEvent: recordAuditEventMock,
}));

function buildSpec(overrides: Partial<MiroFishCreationSpec> = {}): MiroFishCreationSpec {
  return {
    title: 'MiroFish Coral Investigation',
    brief: 'Create a collaborative coral investigation for the current scene.',
    goal: 'Create a collaborative coral investigation for the current scene.',
    activityType: 'investigation',
    targetAudience: 'Grade 8 science',
    includeReport: true,
    defaultSurface: 'simulation',
    collaborationMode: 'single-controller',
    teacherInstructions: [
      'Introduce the setup',
      'Facilitate a short compare-and-contrast',
      'Pause for a prediction before the second run',
    ],
    studentTasks: ['Change the salinity', 'Record coral response', 'Compare two conditions'],
    successChecks: ['Students explain one observed pattern', 'Students compare two conditions'],
    reportFocus: ['Summarize the strongest pattern'],
    authoringNotes: 'Keep the simulation compact.',
    sceneContext: {
      sceneId: 'scene-1',
      sceneTitle: 'Coral salinity lab',
      sceneType: 'interactive',
      teacherControls: [],
      misconceptionHooks: [],
    },
    ...overrides,
  };
}

function buildAccessContext() {
  return {
    auth: {
      session: {
        id: 'teacher-session',
        role: 'teacher',
        kind: 'web',
        organizationId: 'org-1',
      },
      user: {
        id: 'teacher-1',
      },
      organization: {
        id: 'org-1',
      },
    },
    source: 'web',
    classroom: {
      id: 'room-1',
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      stage: {
        id: 'room-1',
        name: 'Coral Reef Lab',
      },
      scenes: [
        {
          id: 'scene-1',
          title: 'Coral salinity lab',
          type: 'interactive',
        },
      ],
      createdAt: '2026-04-20T00:00:00.000Z',
    },
  };
}

describe('MiroFish creation routes', () => {
  beforeEach(() => {
    vi.resetModules();
    requireRequestRoleMock.mockReset();
    requireClassroomAccessMock.mockReset();
    resolveModelFromHeadersWithScopeMock.mockReset();
    callLLMMock.mockReset();
    assertMiroFishAuthoringAvailableMock.mockReset();
    generateMiroFishCreationSpecMock.mockReset();
    publishMiroFishAuthoringJobMock.mockReset();
    readMiroFishAuthoringJobStatusMock.mockReset();
    buildMiroFishCreationBriefPreviewMock.mockReset();
    buildMiroFishCreationFailureMessageMock.mockReset();
    createMiroFishCreationJobMock.mockReset();
    readMiroFishCreationJobMock.mockReset();
    updateMiroFishCreationJobMock.mockReset();
    canAccessMiroFishCreationJobMock.mockReset();
    isValidMiroFishCreationJobIdMock.mockReset();
    isMiroFishMultiUserEnabledMock.mockReset();
    validateMiroFishSimulationMock.mockReset();
    validateMiroFishReportMock.mockReset();
    buildAttachedMiroFishSharedSimulationMock.mockReset();
    updateClassroomMock.mockReset();
    recordAuditEventMock.mockReset();

    requireRequestRoleMock.mockResolvedValue({
      session: { id: 'teacher-session', role: 'teacher', kind: 'web', organizationId: 'org-1' },
      user: { id: 'teacher-1' },
      organization: { id: 'org-1' },
    });
    requireClassroomAccessMock.mockResolvedValue(buildAccessContext());
    resolveModelFromHeadersWithScopeMock.mockResolvedValue({
      model: 'openai:gpt-5.4-mini',
      modelInfo: { outputWindow: 8192 },
    });
    assertMiroFishAuthoringAvailableMock.mockImplementation(() => undefined);
    isMiroFishMultiUserEnabledMock.mockReturnValue(true);
    buildMiroFishCreationBriefPreviewMock.mockReturnValue('Short coral brief');
    buildMiroFishCreationFailureMessageMock.mockReturnValue('Wrapper publish failed');
    canAccessMiroFishCreationJobMock.mockReturnValue(true);
    isValidMiroFishCreationJobIdMock.mockReturnValue(true);
    validateMiroFishSimulationMock.mockResolvedValue(undefined);
    validateMiroFishReportMock.mockResolvedValue(undefined);
    buildAttachedMiroFishSharedSimulationMock.mockImplementation(
      ({ simulationId, reportId, defaultSurface, collaborationMode, authoring }) => ({
        provider: 'mirofish',
        simulationId,
        reportId,
        runUrl: `https://mirofish.example/simulation/${simulationId}/start?embed=1`,
        reportUrl: reportId ? `https://mirofish.example/report/${reportId}?embed=1` : undefined,
        authoring,
        activeSurface: defaultSurface,
        controllerRole: 'teacher',
        collaborationMode,
        collaborationState: 'inactive',
        allowStudentInteraction: collaborationMode === 'multi-user',
        status: 'attached',
      }),
    );
  });

  it('generates a reviewed plan from classroom context', async () => {
    const spec = buildSpec();
    generateMiroFishCreationSpecMock.mockResolvedValue({
      spec,
      promptPreview: 'Stage: Coral Reef Lab',
    });

    const { POST } = await import('@/app/api/classroom/[id]/mirofish/create-plan/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/mirofish/create-plan', {
        method: 'POST',
        body: JSON.stringify({
          goal: 'Create a coral investigation about salinity changes.',
          activityType: 'investigation',
          targetAudience: 'Grade 8 science',
          currentSceneId: 'scene-1',
          includeReport: true,
          defaultSurface: 'simulation',
          collaborationMode: 'single-controller',
        }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(resolveModelFromHeadersWithScopeMock).toHaveBeenCalled();
    expect(generateMiroFishCreationSpecMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stageName: 'Coral Reef Lab',
        sceneContext: expect.objectContaining({
          sceneId: 'scene-1',
          sceneTitle: 'Coral salinity lab',
          sceneType: 'interactive',
        }),
      }),
    );
    expect(json).toEqual({
      success: true,
      spec,
      promptPreview: 'Stage: Coral Reef Lab',
    });
  });

  it('creates an authoring job and records progress metadata', async () => {
    const spec = buildSpec();
    publishMiroFishAuthoringJobMock.mockResolvedValue({
      jobId: 'external-job-1',
    });

    const { POST } = await import('@/app/api/classroom/[id]/mirofish/create/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/mirofish/create', {
        method: 'POST',
        body: JSON.stringify({
          spec,
        }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(publishMiroFishAuthoringJobMock).toHaveBeenCalledWith({
      spec,
      includeReport: true,
      source: 'raic-classroom',
    });
    expect(createMiroFishCreationJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        classroomId: 'room-1',
        externalJobId: 'external-job-1',
        status: 'queued',
        briefPreview: 'Short coral brief',
      }),
    );
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'classroom.mirofish.creation.started',
        resourceId: 'room-1',
      }),
    );
    expect(json).toEqual({
      success: true,
      jobId: expect.any(String),
    });
  });

  it('returns a feature-disabled error when authoring is unavailable', async () => {
    assertMiroFishAuthoringAvailableMock.mockImplementation(() => {
      throw new Error('MiroFish AI-guided creation is disabled for this deployment');
    });

    const { POST } = await import('@/app/api/classroom/[id]/mirofish/create/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/mirofish/create', {
        method: 'POST',
        body: JSON.stringify({
          spec: buildSpec(),
        }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain('disabled');
    expect(createMiroFishCreationJobMock).not.toHaveBeenCalled();
  });

  it('finalizes a ready authoring job into sharedSimulation state', async () => {
    const spec = buildSpec();
    readMiroFishCreationJobMock.mockResolvedValue({
      id: 'job-1',
      classroomId: 'room-1',
      externalJobId: 'external-job-1',
      status: 'running',
      owner: {
        organizationId: 'org-1',
        userId: 'teacher-1',
        actorRole: 'teacher',
      },
      spec,
      briefPreview: 'Short coral brief',
      attempt: 1,
      maxAttempts: 1,
      canRetry: false,
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
    });
    readMiroFishAuthoringJobStatusMock.mockResolvedValue({
      status: 'ready',
      simulationId: 'sim-created',
      reportId: 'report-created',
    });
    updateClassroomMock.mockImplementation(async (_id, updater) =>
      updater({
        id: 'room-1',
        ownerUserId: 'teacher-1',
        organizationId: 'org-1',
        stage: {
          id: 'room-1',
          name: 'Coral Reef Lab',
        },
        scenes: [],
        createdAt: '2026-04-20T00:00:00.000Z',
      }),
    );

    const { GET } = await import('@/app/api/classroom/[id]/mirofish/create/[jobId]/route');
    const response = await GET(
      new NextRequest('http://localhost/api/classroom/room-1/mirofish/create/job-1'),
      { params: Promise.resolve({ id: 'room-1', jobId: 'job-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(validateMiroFishSimulationMock).toHaveBeenCalledWith('sim-created');
    expect(validateMiroFishReportMock).toHaveBeenCalledWith('report-created');
    expect(updateClassroomMock).toHaveBeenCalledWith('room-1', expect.any(Function));
    expect(updateMiroFishCreationJobMock).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        status: 'ready',
        canRetry: false,
        sharedSimulation: expect.objectContaining({
          simulationId: 'sim-created',
          reportId: 'report-created',
        }),
      }),
    );
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'classroom.mirofish.creation.completed',
        resourceId: 'room-1',
      }),
    );
    expect(json).toEqual({
      success: true,
      status: 'ready',
      sharedSimulation: expect.objectContaining({
        simulationId: 'sim-created',
        reportId: 'report-created',
        authoring: expect.objectContaining({
          source: 'ai-guided',
          briefPreview: 'Short coral brief',
        }),
      }),
    });
  });

  it('records failure details without mutating classroom state when authoring fails', async () => {
    readMiroFishCreationJobMock.mockResolvedValue({
      id: 'job-1',
      classroomId: 'room-1',
      externalJobId: 'external-job-1',
      status: 'running',
      owner: {
        organizationId: 'org-1',
        userId: 'teacher-1',
        actorRole: 'teacher',
      },
      spec: buildSpec(),
      briefPreview: 'Short coral brief',
      attempt: 1,
      maxAttempts: 1,
      canRetry: false,
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
    });
    readMiroFishAuthoringJobStatusMock.mockResolvedValue({
      status: 'failed',
      error: 'Wrapper publish failed',
    });

    const { GET } = await import('@/app/api/classroom/[id]/mirofish/create/[jobId]/route');
    const response = await GET(
      new NextRequest('http://localhost/api/classroom/room-1/mirofish/create/job-1'),
      { params: Promise.resolve({ id: 'room-1', jobId: 'job-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(updateClassroomMock).not.toHaveBeenCalled();
    expect(updateMiroFishCreationJobMock).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        status: 'failed',
        canRetry: true,
        error: 'Wrapper publish failed',
      }),
    );
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'classroom.mirofish.creation.failed',
      }),
    );
    expect(json).toEqual({
      success: true,
      status: 'failed',
      error: 'Wrapper publish failed',
    });
  });
});
