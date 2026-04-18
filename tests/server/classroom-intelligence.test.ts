import path from 'node:path';
import { promises as fs } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type DbGlobals = typeof globalThis & {
  __raicPlatformJsonLock?: Promise<void>;
  __raicPlatformSchemaPromise?: Promise<void>;
  __raicPlatformSqlClient?: unknown;
};

type MockPostgresExecutor = {
  unsafe: <T>(query: string, params?: unknown[]) => Promise<T[]>;
  begin?: <T>(handler: (executor: MockPostgresExecutor) => Promise<T>) => Promise<T>;
};

function resetDbGlobals() {
  const globals = globalThis as DbGlobals;
  delete globals.__raicPlatformJsonLock;
  delete globals.__raicPlatformSchemaPromise;
  delete globals.__raicPlatformSqlClient;
}

function setMockPostgresState(client: MockPostgresExecutor) {
  const globals = globalThis as DbGlobals;
  globals.__raicPlatformSqlClient = client;
  globals.__raicPlatformSchemaPromise = Promise.resolve();
}

const originalCwd = process.cwd();
let testRoot = '';

describe('classroom intelligence persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    resetDbGlobals();
    testRoot = path.join(
      originalCwd,
      '.vitest-tmp',
      `classroom-intelligence-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    vi.spyOn(process, 'cwd').mockReturnValue(testRoot);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetDbGlobals();
    vi.restoreAllMocks();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('builds adaptive context from stored progress and reflections in JSON mode', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const {
      buildAdaptiveGenerationContext,
      createClassroomReflection,
      upsertClassroomSessionContext,
    } = await import('@/lib/server/classroom-intelligence');

    await upsertClassroomSessionContext({
      classroomId: 'class-1',
      organizationId: 'org-1',
      userId: 'teacher-1',
      requirement: 'Teach orbital mechanics with simulations',
      stageName: 'Orbital Mechanics',
      language: 'en-US',
      lastCompletedSceneId: 'scene-2',
      lastCompletedSceneTitle: 'Force vectors in orbit',
      completedSceneCount: 2,
      totalSceneCount: 6,
      masteryHints: ['needs stronger intuition for vector decomposition'],
      revisitIntent: 'revisit',
    });

    await createClassroomReflection({
      classroomId: 'class-1',
      organizationId: 'org-1',
      userId: 'teacher-1',
      summary: 'The class needed more guided practice before jumping to transfer tasks.',
      challengingAreas: ['vector decomposition', 'transfer problems'],
      confidenceScore: 2,
      revisitIntent: 'remediate',
    });

    const adaptiveContext = await buildAdaptiveGenerationContext({
      organizationId: 'org-1',
      userId: 'teacher-1',
      requirement: 'Teach orbital mechanics with simulations',
    });

    expect(adaptiveContext).not.toBeNull();
    expect(adaptiveContext?.lastCompletedSceneTitle).toBe('Force vectors in orbit');
    expect(adaptiveContext?.pacingPreference).toBe('remediate');
    expect(adaptiveContext?.revisitIntent).toBe('remediate');
    expect(adaptiveContext?.masteryHints).toEqual(
      expect.arrayContaining(['vector decomposition', 'transfer problems']),
    );
    expect(adaptiveContext?.confidenceScore).toBe(2);
  });

  it('scores benchmark artifacts against the perf budget and writes the latest snapshot', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const snapshotPath = path.join(testRoot, 'data', 'perf-results', 'latest.json');
    const { recordBenchmarkArtifact } = await import('@/lib/server/classroom-intelligence');

    const artifact = await recordBenchmarkArtifact({
      scope: 'classroom-generation',
      source: 'vitest',
      classroomId: 'class-1',
      organizationId: 'org-1',
      userId: 'teacher-1',
      metrics: {
        classroomStartToFirstSceneMs: 7200,
        providerRoundtripP95Ms: 4100,
      },
      notes: ['Synthetic benchmark artifact for regression coverage.'],
    });

    expect(artifact.status).toBe('warn');
    expect(artifact.metrics).toMatchObject({
      classroomStartToFirstSceneMs: {
        status: 'pass',
      },
      providerRoundtripP95Ms: {
        status: 'warn',
      },
    });

    const snapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8')) as {
      latestArtifactId: string;
      status: string;
    };
    expect(snapshot.latestArtifactId).toBe(artifact.id);
    expect(snapshot.status).toBe('warn');
  });

  it('builds adaptive runtime context for a returning teacher session', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const {
      buildAdaptiveRuntimeContext,
      createClassroomReflection,
      upsertClassroomSessionContext,
    } = await import('@/lib/server/classroom-intelligence');

    await upsertClassroomSessionContext({
      classroomId: 'class-1',
      organizationId: 'org-1',
      userId: 'teacher-1',
      stageName: 'Orbital Mechanics',
      language: 'en-US',
      lastCompletedSceneId: 'scene-3',
      lastCompletedSceneTitle: 'Orbital transfer maneuvers',
      completedSceneCount: 3,
      totalSceneCount: 6,
      masteryHints: ['transfer windows'],
    });

    await createClassroomReflection({
      classroomId: 'class-1',
      organizationId: 'org-1',
      userId: 'teacher-1',
      summary: 'Spend more time on transfer windows before introducing Hohmann transfers.',
      challengingAreas: ['burn timing'],
      confidenceScore: 2,
      revisitIntent: 'remediate',
    });

    const adaptiveContext = await buildAdaptiveRuntimeContext({
      classroomId: 'class-1',
      userId: 'teacher-1',
    });

    expect(adaptiveContext).toMatchObject({
      lastCompletedSceneTitle: 'Orbital transfer maneuvers',
      revisitIntent: 'remediate',
      reflectionSummary:
        'Spend more time on transfer windows before introducing Hohmann transfers.',
      confidenceScore: 2,
    });
    expect(adaptiveContext?.masteryHints).toEqual(
      expect.arrayContaining(['transfer windows', 'burn timing']),
    );
  });

  it('uses Postgres-backed classroom intelligence records consistently', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/raic');

    const sessionContextRow = {
      id: 'ctx-1',
      classroom_id: 'class-1',
      organization_id: 'org-1',
      user_id: 'teacher-1',
      requirement_fingerprint: 'req-1',
      requirement_preview: 'Teach orbital mechanics',
      language: 'en-US',
      stage_name: 'Orbital Mechanics',
      last_completed_scene_id: 'scene-2',
      last_completed_scene_title: 'Force vectors',
      completed_scene_count: 2,
      total_scene_count: 6,
      mastery_hints: ['vector decomposition'],
      revisit_intent: 'revisit',
      pacing_preference: 'balance',
      reflection_summary: 'Needs more guided practice.',
      confidence_score: 2,
      created_at: '2026-04-17T00:00:00.000Z',
      updated_at: '2026-04-17T00:00:00.000Z',
    };
    const reflectionRow = {
      id: 'reflection-1',
      classroom_id: 'class-1',
      organization_id: 'org-1',
      user_id: 'teacher-1',
      summary: 'Needs more guided practice.',
      challenging_areas: ['vector decomposition'],
      confidence_score: 2,
      revisit_intent: 'remediate',
      created_at: '2026-04-17T00:00:00.000Z',
    };
    const benchmarkRow = {
      id: 'bench-1',
      scope: 'classroom-generation',
      source: 'vitest',
      classroom_id: 'class-1',
      organization_id: 'org-1',
      user_id: 'teacher-1',
      status: 'pass',
      metrics: {
        classroomStartToFirstSceneMs: { value: 7200, threshold: 8000, status: 'pass' },
      },
      notes: ['Synthetic benchmark'],
      metadata: {},
      created_at: '2026-04-17T00:00:00.000Z',
    };

    const unsafeMock = vi.fn(async (query: string, params?: unknown[]) => {
      const normalized = query.replace(/\s+/g, ' ').trim();

      if (
        normalized.startsWith('SELECT') &&
        normalized.includes('FROM classroom_session_contexts')
      ) {
        return [sessionContextRow];
      }

      if (normalized.startsWith('INSERT INTO classroom_session_contexts')) {
        return [sessionContextRow];
      }

      if (normalized.startsWith('INSERT INTO classroom_reflections')) {
        return [reflectionRow];
      }

      if (normalized.startsWith('SELECT') && normalized.includes('FROM classroom_reflections')) {
        return [reflectionRow];
      }

      if (normalized.startsWith('SELECT') && normalized.includes('FROM benchmark_artifacts')) {
        return [benchmarkRow];
      }

      return [];
    });

    const client: MockPostgresExecutor = {
      unsafe: unsafeMock as MockPostgresExecutor['unsafe'],
      begin: vi.fn(async (handler) => handler(client)),
    };
    setMockPostgresState(client);

    const {
      buildAdaptiveRuntimeContext,
      createClassroomReflection,
      getClassroomSessionContext,
      listBenchmarkArtifacts,
      listClassroomReflections,
      upsertClassroomSessionContext,
    } = await import('@/lib/server/classroom-intelligence');

    const persistedContext = await upsertClassroomSessionContext({
      classroomId: 'class-1',
      organizationId: 'org-1',
      userId: 'teacher-1',
      requirement: 'Teach orbital mechanics',
      stageName: 'Orbital Mechanics',
      language: 'en-US',
      completedSceneCount: 2,
      totalSceneCount: 6,
    });
    const lookedUpContext = await getClassroomSessionContext({
      classroomId: 'class-1',
      userId: 'teacher-1',
    });
    const reflection = await createClassroomReflection({
      classroomId: 'class-1',
      organizationId: 'org-1',
      userId: 'teacher-1',
      summary: 'Needs more guided practice.',
      challengingAreas: ['vector decomposition'],
      confidenceScore: 2,
      revisitIntent: 'remediate',
    });
    const reflections = await listClassroomReflections({
      classroomId: 'class-1',
      userId: 'teacher-1',
      limit: 5,
    });
    const adaptiveContext = await buildAdaptiveRuntimeContext({
      classroomId: 'class-1',
      userId: 'teacher-1',
    });
    const benchmarks = await listBenchmarkArtifacts({
      scope: 'classroom-generation',
      limit: 5,
    });

    expect(persistedContext.classroomId).toBe('class-1');
    expect(lookedUpContext?.lastCompletedSceneTitle).toBe('Force vectors');
    expect(reflection.revisitIntent).toBe('remediate');
    expect(reflections[0]?.summary).toBe('Needs more guided practice.');
    expect(adaptiveContext?.revisitIntent).toBe('remediate');
    expect(benchmarks[0]?.id).toBe('bench-1');
    expect(client.begin).toHaveBeenCalledTimes(3);
    expect(unsafeMock).toHaveBeenCalledWith(expect.stringContaining('FROM classroom_reflections'), [
      'class-1',
      'teacher-1',
      5,
    ]);
  });
});
