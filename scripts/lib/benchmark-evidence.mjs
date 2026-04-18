export function extractBenchmarkMetricValue(metric) {
  if (!metric || typeof metric !== 'object') {
    return null;
  }

  if ('value' in metric && typeof metric.value === 'number' && Number.isFinite(metric.value)) {
    return metric.value;
  }

  return null;
}

export function evaluateBenchmarkSnapshot(snapshot, perfBudgets) {
  const failures = [];

  for (const [metricName, threshold] of Object.entries(perfBudgets.metricTargets ?? {})) {
    const value = extractBenchmarkMetricValue(snapshot?.metrics?.[metricName]);

    if (value === null) {
      failures.push(`${metricName}: missing benchmark evidence`);
      continue;
    }

    if (value > threshold) {
      failures.push(`${metricName}: ${value}ms exceeds budget ${threshold}ms`);
    }
  }

  return failures;
}

export function isFixtureBenchmarkSnapshot(snapshot, replaySnapshot = null) {
  if (!snapshot || typeof snapshot !== 'object') {
    return false;
  }

  if (
    snapshot?.metadata &&
    typeof snapshot.metadata === 'object' &&
    snapshot.metadata.fixture === true
  ) {
    return true;
  }

  return (
    replaySnapshot != null &&
    snapshot.latestArtifactId != null &&
    snapshot.latestArtifactId === replaySnapshot.latestArtifactId &&
    snapshot.source === replaySnapshot.source
  );
}

export function assessBenchmarkEvidence({
  perfBudgets,
  replaySnapshot,
  liveSnapshot,
  liveSnapshotExists,
}) {
  const hasValidPerfBudgets =
    !!perfBudgets?.metricTargets && typeof perfBudgets.metricTargets === 'object';

  return {
    hasValidPerfBudgets,
    replayMissing: replaySnapshot == null,
    replayFailures:
      hasValidPerfBudgets && replaySnapshot != null
        ? evaluateBenchmarkSnapshot(replaySnapshot, perfBudgets)
        : [],
    liveSnapshotMissing: !liveSnapshotExists,
    liveSnapshotUnreadable: liveSnapshotExists && liveSnapshot == null,
    liveSnapshotFixture: isFixtureBenchmarkSnapshot(liveSnapshot, replaySnapshot),
    liveFailures:
      hasValidPerfBudgets && liveSnapshot != null
        ? evaluateBenchmarkSnapshot(liveSnapshot, perfBudgets)
        : [],
  };
}
