import { beforeAll, describe, expect, it } from 'vitest';

type AssessBenchmarkEvidence =
  typeof import('../../scripts/lib/benchmark-evidence.mjs').assessBenchmarkEvidence;

let assessBenchmarkEvidence: AssessBenchmarkEvidence;

beforeAll(async () => {
  ({ assessBenchmarkEvidence } = await import('../../scripts/lib/benchmark-evidence.mjs'));
});

const perfBudgets = {
  metricTargets: {
    firstMeaningfulPaintMs: 2500,
    providerRoundtripP95Ms: 3500,
  },
};

const replaySnapshot = {
  latestArtifactId: 'ops-replay-fixture-2026-04-17',
  source: 'ops-check-fixture',
  metadata: { fixture: true },
  metrics: {
    firstMeaningfulPaintMs: { value: 2140 },
    providerRoundtripP95Ms: { value: 2310 },
  },
};

describe('ops benchmark evidence gating', () => {
  it('requires a live benchmark snapshot in addition to the replay fixture', () => {
    const evidence = assessBenchmarkEvidence({
      perfBudgets,
      replaySnapshot,
      liveSnapshot: null,
      liveSnapshotExists: false,
    });

    expect(evidence.replayFailures).toHaveLength(0);
    expect(evidence.liveSnapshotMissing).toBe(true);
    expect(evidence.liveSnapshotUnreadable).toBe(false);
  });

  it('rejects fixture snapshots in the live evidence slot', () => {
    const evidence = assessBenchmarkEvidence({
      perfBudgets,
      replaySnapshot,
      liveSnapshot: replaySnapshot,
      liveSnapshotExists: true,
    });

    expect(evidence.liveSnapshotFixture).toBe(true);
  });

  it('fails live evidence that regresses perf budgets', () => {
    const evidence = assessBenchmarkEvidence({
      perfBudgets,
      replaySnapshot,
      liveSnapshot: {
        latestArtifactId: 'artifact-2',
        source: 'benchmark-run',
        metadata: {},
        metrics: {
          firstMeaningfulPaintMs: { value: 2200 },
          providerRoundtripP95Ms: { value: 4100 },
        },
      },
      liveSnapshotExists: true,
    });

    expect(evidence.liveSnapshotMissing).toBe(false);
    expect(evidence.liveSnapshotFixture).toBe(false);
    expect(evidence.liveFailures).toEqual(['providerRoundtripP95Ms: 4100ms exceeds budget 3500ms']);
  });

  it('accepts non-fixture live evidence that stays within budget', () => {
    const evidence = assessBenchmarkEvidence({
      perfBudgets,
      replaySnapshot,
      liveSnapshot: {
        latestArtifactId: 'artifact-3',
        source: 'benchmark-run',
        metadata: {},
        metrics: {
          firstMeaningfulPaintMs: { value: 2200 },
          providerRoundtripP95Ms: { value: 2400 },
        },
      },
      liveSnapshotExists: true,
    });

    expect(evidence.liveSnapshotMissing).toBe(false);
    expect(evidence.liveSnapshotUnreadable).toBe(false);
    expect(evidence.liveSnapshotFixture).toBe(false);
    expect(evidence.liveFailures).toHaveLength(0);
  });
});
