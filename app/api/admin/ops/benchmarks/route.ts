import { type NextRequest, NextResponse } from 'next/server';
import perfBudgets from '@/ops/perf-budgets.json';
import { requireRequestRole } from '@/lib/auth/authorize';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  API_ERROR_CODES,
} from '@/lib/server/api-response';
import {
  getLatestBenchmarkArtifactSnapshot,
  listBenchmarkArtifacts,
  recordBenchmarkArtifact,
  type BenchmarkArtifactSnapshot,
} from '@/lib/server/classroom-intelligence';

type PerfBudgetMetricName = keyof typeof perfBudgets.metricTargets;

interface BenchmarkCaptureBody {
  scope?: string;
  source?: string;
  classroomId?: string | null;
  organizationId?: string | null;
  userId?: string | null;
  metrics?: Record<string, unknown>;
  notes?: unknown;
  metadata?: Record<string, unknown>;
}

function parseLimit(value: string | null): number | undefined {
  if (value == null || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
    throw new Error('limit must be an integer between 1 and 100');
  }

  return parsed;
}

function normalizeScope(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function normalizeRequiredText(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} is required`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }

  return normalized;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeNotes(value: unknown): string[] {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error('notes must be an array of strings');
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeMetrics(value: unknown): Partial<Record<PerfBudgetMetricName, number>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('metrics must be an object with numeric perf values');
  }

  const rawMetrics = value as Record<string, unknown>;
  const metrics: Partial<Record<PerfBudgetMetricName, number>> = {};
  for (const metricName of Object.keys(perfBudgets.metricTargets) as PerfBudgetMetricName[]) {
    const candidate = rawMetrics[metricName];
    if (candidate == null) {
      continue;
    }

    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
      throw new Error(`${metricName} must be a finite number`);
    }

    metrics[metricName] = candidate;
  }

  if (Object.keys(metrics).length === 0) {
    throw new Error('metrics must include at least one perf budget metric');
  }

  return metrics;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (value == null) {
    return {};
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('metadata must be an object');
  }

  return value as Record<string, unknown>;
}

function buildSnapshotFromArtifact(
  artifact: Awaited<ReturnType<typeof listBenchmarkArtifacts>>[number],
): BenchmarkArtifactSnapshot {
  return {
    latestArtifactId: artifact.id,
    createdAt: artifact.createdAt,
    scope: artifact.scope,
    source: artifact.source,
    status: artifact.status,
    metrics: artifact.metrics as BenchmarkArtifactSnapshot['metrics'],
    notes: artifact.notes,
    metadata: artifact.metadata,
  };
}

function buildBudgetStatus(snapshot: BenchmarkArtifactSnapshot | null) {
  const metrics = Object.fromEntries(
    Object.entries(perfBudgets.metricTargets).map(([name, threshold]) => {
      const candidate = snapshot?.metrics?.[name];
      const value =
        candidate &&
        typeof candidate === 'object' &&
        'value' in candidate &&
        typeof candidate.value === 'number'
          ? candidate.value
          : null;

      return [
        name,
        {
          value,
          threshold,
          status: value === null ? 'missing' : value <= threshold ? 'pass' : 'warn',
        },
      ];
    }),
  );

  const statuses = Object.values(metrics).map((metric) => metric.status);
  const overallStatus = statuses.includes('warn')
    ? 'warn'
    : statuses.includes('pass')
      ? 'pass'
      : 'missing';

  return {
    overallStatus,
    metrics,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireRequestRole(request, ['system_admin']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  try {
    const scope = normalizeScope(request.nextUrl.searchParams.get('scope'));
    const limit = parseLimit(request.nextUrl.searchParams.get('limit')) ?? 20;
    const [artifacts, storedSnapshot] = await Promise.all([
      listBenchmarkArtifacts({
        scope,
        limit,
      }),
      scope == null ? getLatestBenchmarkArtifactSnapshot() : Promise.resolve(null),
    ]);

    const latestArtifact = artifacts[0] ?? null;
    const latestSnapshot =
      latestArtifact == null
        ? storedSnapshot
        : storedSnapshot?.latestArtifactId === latestArtifact.id
          ? storedSnapshot
          : buildSnapshotFromArtifact(latestArtifact);

    return apiSuccessWithRequestSession(request, {
      benchmarks: {
        scope,
        limit,
        artifacts,
        latestSnapshot,
        budgetStatus: buildBudgetStatus(latestSnapshot),
        perfBudgets: perfBudgets.metricTargets,
        commandThresholds: perfBudgets.commandThresholds,
      },
    });
  } catch (error) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      error instanceof Error ? error.message : 'Failed to load benchmark operations data',
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRequestRole(request, ['system_admin']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  try {
    const body = (await request.json()) as BenchmarkCaptureBody;
    const scope = normalizeRequiredText(body.scope, 'scope');
    const source = normalizeRequiredText(body.source, 'source');
    const metadata = normalizeMetadata(body.metadata);

    if (metadata.fixture === true || source === 'ops-check-fixture') {
      throw new Error('Fixture-derived benchmark evidence cannot satisfy the live ops gate');
    }

    const artifact = await recordBenchmarkArtifact({
      scope,
      source,
      classroomId: normalizeOptionalText(body.classroomId),
      organizationId:
        normalizeOptionalText(body.organizationId) ?? auth.session.organizationId ?? null,
      userId: normalizeOptionalText(body.userId) ?? auth.user.id,
      metrics: normalizeMetrics(body.metrics),
      notes: normalizeNotes(body.notes),
      metadata,
    });

    return apiSuccessWithRequestSession(request, {
      benchmarkArtifact: artifact,
      budgetStatus: buildBudgetStatus(buildSnapshotFromArtifact(artifact)),
    });
  } catch (error) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      error instanceof Error ? error.message : 'Failed to record benchmark evidence',
    );
  }
}
