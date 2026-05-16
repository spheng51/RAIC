import { promises as fs } from 'fs';
import { describe, expect, it, vi } from 'vitest';
import { recordBenchmarkArtifact } from '@/lib/server/classroom-intelligence';

const REQUIRED_METRICS = [
  'firstMeaningfulPaintMs',
  'classroomStartToFirstSceneMs',
  'providerRoundtripP95Ms',
  'classroomReuseReconnectMs',
] as const;

const metricsPath = process.env.MILESTONE_BENCHMARK_METRICS_PATH;
const runIfMetricsAvailable = metricsPath ? it : it.skip;

describe('milestone benchmark artifact recording', () => {
  runIfMetricsAvailable('records the multiplayer game review benchmark artifact', async () => {
    vi.stubEnv('DATABASE_URL', '');

    const metrics = JSON.parse(await fs.readFile(metricsPath!, 'utf8')) as Record<string, unknown>;
    for (const metricName of REQUIRED_METRICS) {
      expect(metrics[metricName], metricName).toEqual(expect.any(Number));
    }

    const artifact = await recordBenchmarkArtifact({
      scope: 'multiplayer-game-review',
      source: 'local-playwright-milestone',
      classroomId: 'multiplayer-game-room',
      organizationId: 'org-1',
      userId: 'teacher-1',
      metrics: Object.fromEntries(
        REQUIRED_METRICS.map((metricName) => [metricName, metrics[metricName]]),
      ),
      notes: ['Milestone benchmark captured from the multiplayer game review Playwright flow.'],
      metadata: {
        branch: process.env.MILESTONE_BENCHMARK_BRANCH ?? null,
        commitSha: process.env.MILESTONE_BENCHMARK_COMMIT ?? null,
        command: 'pnpm benchmark:milestone',
      },
    });

    expect(artifact.status).toBe('pass');
  });
});
