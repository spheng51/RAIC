import { promises as fs } from 'fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('MiroFish server helpers', () => {
  const originalEnv = {
    MIROFISH_BASE_URL: process.env.MIROFISH_BASE_URL,
    MIROFISH_API_BASE_URL: process.env.MIROFISH_API_BASE_URL,
    MIROFISH_API_KEY: process.env.MIROFISH_API_KEY,
    MIROFISH_EMBED_SECRET: process.env.MIROFISH_EMBED_SECRET,
  };
  const originalCwd = process.cwd();
  let testRoot = '';

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    testRoot = path.join(
      originalCwd,
      '.vitest-tmp',
      `mirofish-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    vi.spyOn(process, 'cwd').mockReturnValue(testRoot);
    process.env.MIROFISH_BASE_URL = 'https://mirofish.example';
    process.env.MIROFISH_API_BASE_URL = 'https://mirofish.example/api';
    process.env.MIROFISH_API_KEY = 'test-api-key';
    process.env.MIROFISH_EMBED_SECRET = 'test-embed-secret';
  });

  afterEach(async () => {
    vi.useRealTimers();
    process.env.MIROFISH_BASE_URL = originalEnv.MIROFISH_BASE_URL;
    process.env.MIROFISH_API_BASE_URL = originalEnv.MIROFISH_API_BASE_URL;
    process.env.MIROFISH_API_KEY = originalEnv.MIROFISH_API_KEY;
    process.env.MIROFISH_EMBED_SECRET = originalEnv.MIROFISH_EMBED_SECRET;
    vi.restoreAllMocks();
    await fs.rm(testRoot, {
      recursive: true,
      force: true,
    });
  });

  it('builds embed-ready run and report URLs', async () => {
    const { buildMiroFishRunUrl, buildMiroFishReportUrl } = await import('@/lib/server/mirofish');

    expect(buildMiroFishRunUrl('sim-1')).toBe(
      'https://mirofish.example/simulation/sim-1/start?embed=1',
    );
    expect(buildMiroFishReportUrl('report-1')).toBe(
      'https://mirofish.example/report/report-1?embed=1',
    );
  });

  it('keeps classroom embed tokens stable within a two-hour window and rotates after it', async () => {
    const { withMiroFishEmbedToken } = await import('@/lib/server/mirofish');

    vi.setSystemTime(new Date('2026-04-11T00:15:00.000Z'));
    const firstUrl = withMiroFishEmbedToken('https://mirofish.example/simulation/sim-1/start', {
      classroomId: 'room-1',
      simulationId: 'sim-1',
      reportId: 'report-1',
    });

    vi.setSystemTime(new Date('2026-04-11T01:59:59.000Z'));
    const secondUrl = withMiroFishEmbedToken('https://mirofish.example/simulation/sim-1/start', {
      classroomId: 'room-1',
      simulationId: 'sim-1',
      reportId: 'report-1',
    });

    vi.setSystemTime(new Date('2026-04-11T02:00:00.000Z'));
    const rotatedUrl = withMiroFishEmbedToken('https://mirofish.example/simulation/sim-1/start', {
      classroomId: 'room-1',
      simulationId: 'sim-1',
      reportId: 'report-1',
    });

    const firstToken = new URL(firstUrl).searchParams.get('classroomToken');
    const secondToken = new URL(secondUrl).searchParams.get('classroomToken');
    const rotatedToken = new URL(rotatedUrl).searchParams.get('classroomToken');

    expect(new URL(firstUrl).searchParams.get('embed')).toBe('1');
    expect(firstToken).toBeTruthy();
    expect(firstToken).toBe(secondToken);
    expect(rotatedToken).toBeTruthy();
    expect(rotatedToken).not.toBe(firstToken);
  });

  it('builds an export compatibility notice without exposing live classroom tokens', async () => {
    const { buildMiroFishExportNotice } = await import('@/lib/utils/classroom-presentation');

    const notice = buildMiroFishExportNotice({
      provider: 'mirofish',
      simulationId: 'sim-1',
      reportId: 'report-1',
      runUrl: 'https://mirofish.example/simulation/sim-1/start?embed=1&classroomToken=secret',
      reportUrl: 'https://mirofish.example/report/report-1?embed=1&classroomToken=secret-report',
      activeSurface: 'simulation',
      controllerRole: 'teacher',
      status: 'running',
    });

    expect(notice).toContain('Simulation ID: sim-1');
    expect(notice).toContain('Report ID: report-1');
    expect(notice).toContain('not embedded');
    expect(notice).not.toContain('classroomToken');
  });

  it('preserves attached sharedSimulation and agent fields across classroom storage updates', async () => {
    vi.useRealTimers();

    const { persistClassroom, readClassroom, updateClassroom } =
      await import('@/lib/server/classroom-storage');
    const classroomId = `mirofish-contract-${Math.random().toString(36).slice(2, 10)}`;

    const sharedSimulation = {
      provider: 'mirofish' as const,
      simulationId: 'sim-1',
      reportId: 'report-1',
      runUrl: 'https://mirofish.example/simulation/sim-1/start?embed=1',
      reportUrl: 'https://mirofish.example/report/report-1?embed=1',
      activeSurface: 'lesson' as const,
      controllerRole: 'teacher' as const,
      status: 'attached' as const,
    };

    const stage = {
      id: classroomId,
      name: 'MiroFish contract room',
      createdAt: 1,
      updatedAt: 1,
      agentIds: ['default-1', 'default-2'],
      generatedAgentConfigs: [
        {
          id: 'gen-server-1',
          name: 'Generated Teacher',
          role: 'teacher',
          persona: 'Guides the classroom',
          avatar: '/avatars/teacher.png',
          color: '#123456',
          priority: 10,
        },
      ],
      sharedSimulation,
    };

    await persistClassroom(
      {
        id: classroomId,
        stage,
        scenes: [],
      },
      'https://app.example.com',
    );

    const stored = await readClassroom(classroomId);
    expect(stored?.stage.sharedSimulation).toEqual(sharedSimulation);
    expect(stored?.stage.agentIds).toEqual(stage.agentIds);
    expect(stored?.stage.generatedAgentConfigs).toEqual(stage.generatedAgentConfigs);

    await updateClassroom(classroomId, (current) => {
      const { sharedSimulation: _omitted, ...stageWithoutSharedSimulation } = current.stage;
      return {
        ...current,
        stage: {
          ...stageWithoutSharedSimulation,
          name: 'Updated MiroFish contract room',
        },
      };
    });

    const updated = await readClassroom(classroomId);
    expect(updated?.stage.name).toBe('Updated MiroFish contract room');
    expect(updated?.stage.sharedSimulation).toEqual(sharedSimulation);
    expect(updated?.stage.agentIds).toEqual(stage.agentIds);
    expect(updated?.stage.generatedAgentConfigs).toEqual(stage.generatedAgentConfigs);
  });
});
