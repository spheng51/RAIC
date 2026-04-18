import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireRequestRoleMock = vi.fn();
const listBenchmarkArtifactsMock = vi.fn();
const getLatestBenchmarkArtifactSnapshotMock = vi.fn();
const recordBenchmarkArtifactMock = vi.fn();

vi.mock('@/lib/auth/authorize', () => ({
  requireRequestRole: requireRequestRoleMock,
}));

vi.mock('@/lib/server/classroom-intelligence', () => ({
  listBenchmarkArtifacts: listBenchmarkArtifactsMock,
  getLatestBenchmarkArtifactSnapshot: getLatestBenchmarkArtifactSnapshotMock,
  recordBenchmarkArtifact: recordBenchmarkArtifactMock,
}));

const authContext = {
  user: { id: 'system-admin-1' },
  session: { role: 'system_admin', organizationId: 'org-system' },
  organization: { id: 'org-system' },
} as never;

describe('GET /api/admin/ops/benchmarks', () => {
  beforeEach(() => {
    vi.resetModules();
    requireRequestRoleMock.mockReset();
    listBenchmarkArtifactsMock.mockReset();
    getLatestBenchmarkArtifactSnapshotMock.mockReset();
    recordBenchmarkArtifactMock.mockReset();
    requireRequestRoleMock.mockResolvedValue(authContext);
    listBenchmarkArtifactsMock.mockResolvedValue([
      {
        id: 'artifact-1',
        scope: 'classroom-generation',
        source: 'vitest',
        classroomId: 'class-1',
        organizationId: 'org-1',
        userId: 'teacher-1',
        status: 'pass',
        metrics: {
          providerRoundtripP95Ms: { value: 2100, threshold: 3500, status: 'pass' },
        },
        notes: ['Synthetic artifact'],
        metadata: { fixture: true },
        createdAt: '2026-04-17T00:00:00.000Z',
      },
    ]);
    getLatestBenchmarkArtifactSnapshotMock.mockResolvedValue({
      latestArtifactId: 'artifact-1',
      createdAt: '2026-04-17T00:00:00.000Z',
      scope: 'classroom-generation',
      source: 'vitest',
      status: 'pass',
      metrics: {
        providerRoundtripP95Ms: { value: 2100, threshold: 3500, status: 'pass' },
      },
      notes: ['Synthetic artifact'],
      metadata: { fixture: true },
    });
    recordBenchmarkArtifactMock.mockResolvedValue({
      id: 'artifact-live-1',
      scope: 'classroom-generation',
      source: 'playwright-lab-run',
      classroomId: 'class-1',
      organizationId: 'org-system',
      userId: 'system-admin-1',
      status: 'pass',
      metrics: {
        classroomStartToFirstSceneMs: { value: 7200, threshold: 8000, status: 'pass' },
      },
      notes: ['Measured during pre-merge rehearsal'],
      metadata: { benchmarkRunId: 'run-1' },
      createdAt: '2026-04-17T01:00:00.000Z',
    });
  });

  it('returns benchmark artifacts, latest snapshot, and perf budget status for system admins', async () => {
    const { GET } = await import('@/app/api/admin/ops/benchmarks/route');
    const response = await GET(
      new NextRequest('http://localhost/api/admin/ops/benchmarks?scope=classroom-generation&limit=5'),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(listBenchmarkArtifactsMock).toHaveBeenCalledWith({
      scope: 'classroom-generation',
      limit: 5,
    });
    expect(getLatestBenchmarkArtifactSnapshotMock).not.toHaveBeenCalled();
    expect(json.success).toBe(true);
    expect(json.benchmarks.artifacts[0].id).toBe('artifact-1');
    expect(json.benchmarks.latestSnapshot.latestArtifactId).toBe('artifact-1');
    expect(json.benchmarks.perfBudgets.providerRoundtripP95Ms).toBe(3500);
    expect(json.benchmarks.budgetStatus.metrics.providerRoundtripP95Ms.status).toBe('pass');
  });

  it('returns 400 when limit is invalid', async () => {
    const { GET } = await import('@/app/api/admin/ops/benchmarks/route');
    const response = await GET(
      new NextRequest('http://localhost/api/admin/ops/benchmarks?limit=0'),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errorCode).toBe('INVALID_REQUEST');
    expect(listBenchmarkArtifactsMock).not.toHaveBeenCalled();
  });

  it('passes through authorization failures', async () => {
    requireRequestRoleMock.mockResolvedValue(
      NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }),
    );

    const { GET } = await import('@/app/api/admin/ops/benchmarks/route');
    const response = await GET(new NextRequest('http://localhost/api/admin/ops/benchmarks'));

    expect(response.status).toBe(403);
    expect(listBenchmarkArtifactsMock).not.toHaveBeenCalled();
  });

  it('records live benchmark evidence for system admins', async () => {
    const { POST } = await import('@/app/api/admin/ops/benchmarks/route');
    const response = await POST(
      new NextRequest('http://localhost/api/admin/ops/benchmarks', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'classroom-generation',
          source: 'playwright-lab-run',
          classroomId: 'class-1',
          metrics: {
            classroomStartToFirstSceneMs: 7200,
          },
          notes: ['Measured during pre-merge rehearsal'],
          metadata: {
            benchmarkRunId: 'run-1',
          },
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(recordBenchmarkArtifactMock).toHaveBeenCalledWith({
      scope: 'classroom-generation',
      source: 'playwright-lab-run',
      classroomId: 'class-1',
      organizationId: 'org-system',
      userId: 'system-admin-1',
      metrics: {
        classroomStartToFirstSceneMs: 7200,
      },
      notes: ['Measured during pre-merge rehearsal'],
      metadata: {
        benchmarkRunId: 'run-1',
      },
    });
    expect(json.success).toBe(true);
    expect(json.benchmarkArtifact.id).toBe('artifact-live-1');
    expect(json.budgetStatus.metrics.classroomStartToFirstSceneMs.status).toBe('pass');
  });

  it('rejects fixture-derived benchmark captures', async () => {
    const { POST } = await import('@/app/api/admin/ops/benchmarks/route');
    const response = await POST(
      new NextRequest('http://localhost/api/admin/ops/benchmarks', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'classroom-generation',
          source: 'ops-check-fixture',
          metrics: {
            classroomStartToFirstSceneMs: 7200,
          },
          metadata: {
            fixture: true,
          },
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(recordBenchmarkArtifactMock).not.toHaveBeenCalled();
    expect(json.error).toContain('Fixture-derived benchmark evidence');
  });
});
