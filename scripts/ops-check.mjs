#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';

const STALE_BRANCH_PATTERNS = [
  /palpha1/i,
  /merge[_-]?train/i,
  /post-merge/i,
  /main-health/i,
  /platform-ops/i,
];

const TRACKED_SECRET_FILE_BLOCKLIST = [
  '.env.local',
  /^server-providers(?:-[^/\\]+)?\.ya?ml$/i,
];
const SECRET_FILE_PATHS = [
  '.env.local',
  'server-providers.yml',
  'server-providers-local.yml',
  'server-providers-dev.yml',
  'server-providers-stage.yml',
  'server-providers-production.yml',
];

const SECRET_SCANNERS = [
  { name: 'gitleaks', command: 'gitleaks detect --source . --no-git' },
  { name: 'detect-secrets', command: 'detect-secrets scan .' },
];

const SECRET_VALUE_INDICATORS = [
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\bAIza[0-9A-Za-z-_]{30,}\b/g,
  /\bAKIA[0-9A-Z]{16,}\b/g,
  /\bghp_[A-Za-z0-9]{24,}\b/g,
  /\bgho_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bpk_(?:test|live)_[A-Za-z0-9]{24,}\b/g,
  /\beyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\b/g,
];

const SENSITIVE_ENV_SUFFIX_RE = /(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|PASSPHRASE|ENCRYPTION_KEY|CREDENTIAL|ACCESS_KEY|AUTH_TOKEN)$/i;
const NEXT_PUBLIC_SECRET_RE = /^NEXT_PUBLIC_.*(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|AUTH_TOKEN)/i;
const PLACEHOLDER_VALUE_RE = /^\s*["']?(?:\s*|\$\{[^}]*\}|<[^>]*>|your[^\n]*|replace[^\n]*|placeholder[^\n]*|example[^\n]*|sample[^\n]*|dummy[^\n]*|changeme[^\n]*|to-be-filled[^\n]*|todo[^\n]*|redacted[^\n]*|[^"'\n]*\.\.\.[^"'\n]*|…)\s*["']?$/i;

function normalizeArgv(argv) {
  const args = { mode: null, ci: false, strictRemoteBacklog: false };
  let seenMode = false;

  for (const arg of argv) {
    if (arg === '--ci') {
      args.ci = true;
    } else if (arg === '--strict-remote-backlog') {
      args.strictRemoteBacklog = true;
    } else if (!arg.startsWith('--') && !seenMode) {
      seenMode = true;
      args.mode = arg;
    }
  }

  if (!args.mode) {
    args.mode = 'verify';
  }

  return args;
}

const options = normalizeArgv(process.argv.slice(2));
const PNPM_COMMAND = (() => {
  try {
    execSync(
      process.platform === 'win32' ? 'where.exe pnpm' : 'command -v pnpm',
      { encoding: 'utf8', stdio: 'pipe', shell: true },
    );
    return 'pnpm';
  } catch {
    return 'corepack pnpm';
  }
})();

function fail(message, { details = [] } = {}) {
  console.error(`\n[ops-check] ERROR: ${message}`);
  for (const line of details) {
    console.error(`[ops-check]   ${line}`);
  }
  process.exit(1);
}

function commandExists(commandName) {
  const probe = process.platform === 'win32' ? `where.exe ${commandName}` : `command -v ${commandName}`;
  try {
    execSync(probe, {
      encoding: 'utf8',
      stdio: 'ignore',
      shell: true,
    });
    return true;
  } catch {
    return false;
  }
}

function runSecretScanCommand(command) {
  try {
    execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe',
      shell: true,
    });
    return { found: false, output: '' };
  } catch (error) {
    const output = [
      String(error.stdout || ''),
      String(error.stderr || ''),
      String(error.message || ''),
    ]
      .join('\n')
      .trim();

    if (!output) {
      return {
        found: true,
        output: `command failed without diagnostics: ${command}`,
      };
    }

    return { found: true, output };
  }
}

function runGitCommand(command, { parse = false, env = {} } = {}) {
  const result = execSync(command, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    shell: true,
  });

  if (!parse) {
    return result;
  }

  return String(result)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function runCommand(command, { env = {} } = {}) {
  try {
    execSync(command, {
      encoding: 'utf8',
      stdio: 'inherit',
      env: { ...process.env, ...env },
      shell: true,
    });
  } catch {
    fail(`Command failed: ${command}`);
  }
}

function listTrackedFiles() {
  return runGitCommand('git ls-files', { parse: true });
}

function isFileIgnored(path) {
  try {
    execSync(`git check-ignore -q "${path}"`, {
      encoding: 'utf8',
      stdio: 'ignore',
      shell: true,
  });
    return true;
  } catch {
    return false;
  }
}

function isTrackedSecretFile(path) {
  return TRACKED_SECRET_FILE_BLOCKLIST.some((pattern) =>
    typeof pattern === 'string' ? path === pattern : pattern.test(path),
  );
}

function findSecretFindings() {
  const trackedFiles = listTrackedFiles();
  const findings = [];

  for (const file of trackedFiles) {
    if (!file || file.startsWith('.next/') || file.startsWith('.git/')) {
      continue;
    }

    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    if (content.includes('\u0000')) {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const envMatch = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);

      if (envMatch) {
        const [, name, rawValue] = envMatch;
        const value = rawValue.replace(/["']$/g, '').replace(/^["']/, '').trim();
        const isNextPublicSecret =
          NEXT_PUBLIC_SECRET_RE.test(name) && !PLACEHOLDER_VALUE_RE.test(value);

        if (isNextPublicSecret) {
          findings.push({
            file,
            line: i + 1,
            snippet: line.trim(),
            pattern: 'next-public secret key',
          });
          continue;
        }

        if (SENSITIVE_ENV_SUFFIX_RE.test(name) && !PLACEHOLDER_VALUE_RE.test(value)) {
          findings.push({
            file,
            line: i + 1,
            snippet: line.trim(),
            pattern: 'sensitive env assignment',
          });
        }
      }

      for (const pattern of SECRET_VALUE_INDICATORS) {
        const match = line.match(pattern);
        if (match) {
          findings.push({
            file,
            line: i + 1,
            snippet: line.trim(),
            pattern: `secret-style token (${pattern.source})`,
          });
          break;
        }
      }
    }
  }

  return findings;
}

function checkSecretSafety() {
  const trackedFiles = listTrackedFiles();
  const trackedSecretFileLeaks = trackedFiles.filter(isTrackedSecretFile);

  if (trackedSecretFileLeaks.length > 0) {
    fail('Tracked secret-bearing files found in git.', {
      details: [
        'Remove before deploy:',
        ...trackedSecretFileLeaks.map((file) => `- ${file}`),
      ],
    });
  }

  const presentUnignoredSecretFiles = SECRET_FILE_PATHS.filter((path) => {
    if (!existsSync(path)) {
      return false;
    }

    return !isFileIgnored(path);
  });

  if (presentUnignoredSecretFiles.length > 0) {
    fail('Secret-bearing files exist but are not ignored.', {
      details: [
        ...presentUnignoredSecretFiles.map(
          (file) => `- ${file}: add to .gitignore or remove before publish`,
        ),
      ],
    });
  }

  const scannerOutput = [];
  let scannerUsed = false;
  for (const scanner of SECRET_SCANNERS) {
    if (!commandExists(scanner.name)) {
      continue;
    }

    scannerUsed = true;
    const result = runSecretScanCommand(scanner.command);
    if (!result.found) {
      console.log(`[ops-check] ${scanner.name} completed with no findings.`);
      continue;
    }

    scannerOutput.push(
      `[ops-check] ${scanner.name} reported potential findings:`,
      ...result.output
        .split('\n')
        .slice(0, 20)
        .map((line) => `  ${line}`),
    );
    break;
  }

  if (scannerOutput.length > 0) {
    fail('External secret scanner reported potential secret findings.', {
      details: scannerOutput.slice(0, 50),
    });
  }

  if (!scannerUsed) {
    console.log(
      '[ops-check] No optional external scanner found (gitleaks/detect-secrets not installed); using built-in heuristic checks.',
    );
  }

  const findings = findSecretFindings().slice(0, 200);

  if (findings.length === 0) {
    console.log('[ops-check] Secret scan passed.');
    return;
  }

  fail('Potential secret leakage found in tracked files.', {
    details: findings.map(
      (finding) =>
        `${finding.file}:${finding.line}: ${finding.pattern} :: ${finding.snippet.slice(0, 220)}`,
    ),
  });
}

function getWorkingToplevel() {
  return String(runGitCommand('git rev-parse --show-toplevel')).trim();
}

function getCurrentBranch() {
  const branch = String(runGitCommand('git rev-parse --abbrev-ref HEAD')).trim();
  if (!branch || branch === 'HEAD') {
    fail('Repository is in a detached HEAD state. A branch must be checked out.');
  }
  return branch;
}

function getRemoteOrigin() {
  const rawUrl = String(runGitCommand('git remote get-url origin')).trim();
  const match = rawUrl.match(/github\.com[:/](.+?)\/(.+?)\.git$/i);
  if (!match) {
    return null;
  }
  return `${match[1]}/${match[2]}`;
}

function parseWorktrees() {
  const lines = runGitCommand('git worktree list --porcelain', { parse: true });
  return lines.filter((line) => line.startsWith('worktree ')).map((line) => line.slice(9));
}

function listLocalBranches() {
  return runGitCommand('git branch --format "%(refname:short)"', { parse: true });
}

function listRemoteBranches() {
  return runGitCommand('git branch -r --format "%(refname:short)"', { parse: true });
}

function checkDrift() {
  console.log('[ops-check] Starting local branch and environment drift checks.');

  const branch = getCurrentBranch();

  if (!options.ci && branch !== 'main') {
    fail(`Expected local branch to be 'main', found '${branch}'.`);
  }

  const status = runGitCommand('git status --short').trim();
  if (status.length > 0) {
    fail('Working tree is not clean. Commit or stash local changes first.', {
      details: ['Run: git status', 'Clean the working tree before verification.'],
    });
  }

  const statusBranch = runGitCommand('git status --short --branch').trim();
  console.log('[ops-check] git status:', statusBranch || 'clean');

  const localBranches = listLocalBranches();
  const extraBranches = localBranches.filter((name) => name !== 'main');
  if (extraBranches.length > 0) {
    fail('Local branch cleanup required before handoff.', {
      details: [`Remove local branches: ${extraBranches.join(', ')}`],
    });
  }

  const remoteBranches = listRemoteBranches().filter((name) => name !== 'origin');
  const expectedRemoteRefs = new Set(['origin/main', 'origin/HEAD']);
  const unexpectedRemote = remoteBranches.filter((name) => !expectedRemoteRefs.has(name));

  if (options.ci && options.mode === 'drift') {
    console.log(
      '[ops-check] CI mode active: skipping strict remote ref gating to allow ephemeral runner refs.',
    );
  } else if (unexpectedRemote.length > 0) {
    fail('Unexpected remote refs detected.', {
      details: [
        'Allowed remote refs: origin/main, origin/HEAD',
        `Found: ${remoteBranches.join(', ')}`,
      ],
    });
  }

  const worktrees = parseWorktrees();
  const toplevel = getWorkingToplevel();
  const otherWorktrees = worktrees.filter((path) => path !== toplevel);
  if (otherWorktrees.length > 0) {
    fail('Additional git worktrees detected; remove stale worktrees before handoff.', {
      details: ['Run: git worktree list', `Remaining: ${otherWorktrees.join(', ')}`],
    });
  }

  const codexBranches = localBranches.filter((name) => name.startsWith('codex/'));
  if (codexBranches.length > 0) {
    fail('Scratch branches still exist locally.', {
      details: codexBranches,
    });
  }

  console.log('[ops-check] Drift checks passed.');
}

async function checkRemoteBacklog() {
  if (!options.strictRemoteBacklog) {
    console.log('[ops-check] Skipping GitHub backlog scan (enable with --strict-remote-backlog).');
    return;
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    console.log('[ops-check] No GitHub token found. Skipping backlog scan.');
    return;
  }

  const repo = getRemoteOrigin();
  if (!repo) {
    console.log('[ops-check] Unable to parse origin remote URL. Skipping backlog scan.');
    return;
  }

  const [owner, repository] = repo.split('/');
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ops-check-script',
  };

  const shouldMatch = (value) => STALE_BRANCH_PATTERNS.some((pattern) => pattern.test(value ?? ''));

  const [issuesResponse, pullsResponse] = await Promise.all([
    fetch(`https://api.github.com/repos/${owner}/${repository}/issues?state=open&per_page=100`, {
      headers,
    }),
    fetch(`https://api.github.com/repos/${owner}/${repository}/pulls?state=open&per_page=100`, {
      headers,
    }),
  ]);

  if (!issuesResponse.ok) {
    fail(`GitHub API request failed: ${issuesResponse.status} ${issuesResponse.statusText}`);
  }

  if (!pullsResponse.ok) {
    fail(`GitHub API request failed: ${pullsResponse.status} ${pullsResponse.statusText}`);
  }

  const [issues, pulls] = await Promise.all([issuesResponse.json(), pullsResponse.json()]);

  const stalePulls = pulls.filter(
    (item) => shouldMatch(item.title) || shouldMatch(item.head?.ref) || shouldMatch(item.base?.ref),
  );
  const staleIssues = issues.filter(
    (item) => !item.pull_request && (shouldMatch(item.title) || shouldMatch(item.body)),
  );

  const staleItems = [...stalePulls, ...staleIssues];

  if (staleItems.length > 0) {
    fail('Stale merge-train-related open issues/PRs were found.', {
      details: staleItems.map(
        (item) => `- #${item.number}: ${item.title} (${item.pull_request ? 'PR' : 'Issue'})`,
      ),
    });
  }

  console.log('[ops-check] Remote backlog scan passed.');
}

function checkVerify() {
  console.log('[ops-check] Starting verification gates in canonical order.');

  const gates = [
    { name: `${PNPM_COMMAND} run secrets:scan`, command: `${PNPM_COMMAND} run secrets:scan` },
    { name: `${PNPM_COMMAND} run check`, command: `${PNPM_COMMAND} run check` },
    { name: `${PNPM_COMMAND} run build`, command: `${PNPM_COMMAND} run build` },
    {
      name: `${PNPM_COMMAND} run test:mirofish:gate`,
      command: `${PNPM_COMMAND} run test:mirofish:gate`,
    },
    {
      name: `${PNPM_COMMAND} run test:mirofish:e2e`,
      command: `${PNPM_COMMAND} run test:mirofish:e2e`,
    },
    { name: `CI=1 ${PNPM_COMMAND} run test:e2e`, command: `${PNPM_COMMAND} run test:e2e`, env: { CI: '1' } },
  ];

  checkDrift();
  checkSecretSafety();

  for (const gate of gates) {
    console.log(`[ops-check] Executing gate: ${gate.name}`);
    runCommand(gate.command, { env: gate.env });
  }

  console.log('[ops-check] All verification gates passed.');
}

if (options.mode === 'drift') {
  checkDrift();
  await checkRemoteBacklog();
  process.exit(0);
}

if (options.mode === 'verify') {
  checkVerify();
  await checkRemoteBacklog();
  process.exit(0);
}

if (options.mode === 'secrets') {
  checkDrift();
  checkSecretSafety();
  process.exit(0);
}

fail(`Unknown mode: ${options.mode}. Use \"drift\", \"verify\", or \"secrets\".`);
