#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, 'test-results', 'milestone-benchmark');
const metricsPath = path.join(outputDir, 'metrics.json');
const snapshotPath = path.join(repoRoot, 'data', 'perf-results', 'latest.json');

function run(command, args, env = {}) {
  execFileSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
}

function readGitValue(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

rmSync(outputDir, { force: true, recursive: true });
mkdirSync(outputDir, { recursive: true });

const benchmarkEnv = {
  MILESTONE_BENCHMARK: '1',
  MILESTONE_BENCHMARK_METRICS_PATH: metricsPath,
  MILESTONE_BENCHMARK_BRANCH: readGitValue(['rev-parse', '--abbrev-ref', 'HEAD']),
  MILESTONE_BENCHMARK_COMMIT: readGitValue(['rev-parse', 'HEAD']),
};

run(
  'corepack',
  ['pnpm', 'exec', 'playwright', 'test', 'e2e/tests/multiplayer-game.spec.ts', '--reporter=line'],
  benchmarkEnv,
);

if (!existsSync(metricsPath)) {
  throw new Error(`Benchmark metrics were not written: ${metricsPath}`);
}

run(
  'corepack',
  ['pnpm', 'exec', 'vitest', 'run', 'tests/benchmarks/record-milestone-benchmark.test.ts'],
  {
    ...benchmarkEnv,
    DATABASE_URL: '',
  },
);

if (!existsSync(snapshotPath)) {
  throw new Error(`Benchmark snapshot was not written: ${snapshotPath}`);
}

const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
console.log(
  JSON.stringify(
    {
      latestArtifactId: snapshot.latestArtifactId,
      scope: snapshot.scope,
      source: snapshot.source,
      status: snapshot.status,
      metrics: snapshot.metrics,
    },
    null,
    2,
  ),
);
