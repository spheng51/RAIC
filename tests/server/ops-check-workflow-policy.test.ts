import { describe, expect, it } from 'vitest';

const { findCiWorkflowActionRuntimeFindings, normalizeArgv, shouldEnforceStrictLocalHandoff } =
  await import('../../scripts/ops-check.mjs');

function workflowWithUses(uses: string[]) {
  return `
name: CI
jobs:
  check:
    steps:
${uses.map((use) => `      - uses: ${use}`).join('\n')}
`;
}

describe('ops CI workflow policy', () => {
  it('accepts Node 24-native CI action majors', () => {
    const findings = findCiWorkflowActionRuntimeFindings(
      workflowWithUses([
        'actions/checkout@v6',
        'pnpm/action-setup@v6',
        'actions/setup-node@v6',
        'actions/upload-artifact@v6',
      ]),
    );

    expect(findings).toEqual([]);
  });

  it('rejects Node 20-targeting CI action majors', () => {
    const findings = findCiWorkflowActionRuntimeFindings(
      workflowWithUses([
        'actions/checkout@v4',
        'pnpm/action-setup@v4',
        'actions/setup-node@v4',
        'actions/upload-artifact@v4',
      ]),
    );

    expect(findings).toEqual([
      '.github/workflows/ci.yml jobs.check.steps[0]: actions/checkout@v4 must use v6+ to keep CI actions on a Node 24-native runtime.',
      '.github/workflows/ci.yml jobs.check.steps[1]: pnpm/action-setup@v4 must use v6+ to keep CI actions on a Node 24-native runtime.',
      '.github/workflows/ci.yml jobs.check.steps[2]: actions/setup-node@v4 must use v6+ to keep CI actions on a Node 24-native runtime.',
      '.github/workflows/ci.yml jobs.check.steps[3]: actions/upload-artifact@v4 must use v6+ to keep CI actions on a Node 24-native runtime.',
    ]);
  });

  it('leaves unrelated actions alone', () => {
    const findings = findCiWorkflowActionRuntimeFindings(
      workflowWithUses(['third-party/example@v1', 'docker://alpine:3.20']),
    );

    expect(findings).toEqual([]);
  });

  it('keeps final drift strict while allowing explicit PR-local drift evidence', () => {
    const finalDrift = normalizeArgv(['drift'], {});
    const ciDrift = normalizeArgv(['drift', '--ci'], {});
    const prLocalDrift = normalizeArgv(['drift', '--pr-local'], {});

    expect(finalDrift).toMatchObject({ mode: 'drift', ci: false, prLocal: false });
    expect(shouldEnforceStrictLocalHandoff(finalDrift)).toBe(true);

    expect(ciDrift).toMatchObject({ mode: 'drift', ci: true, prLocal: false });
    expect(shouldEnforceStrictLocalHandoff(ciDrift)).toBe(false);

    expect(prLocalDrift).toMatchObject({ mode: 'drift', ci: false, prLocal: true });
    expect(shouldEnforceStrictLocalHandoff(prLocalDrift)).toBe(false);
  });
});
