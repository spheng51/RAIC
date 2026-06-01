#!/usr/bin/env node

import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';
import {
  auditEnvRecords,
  manualFallbackLines,
  parseAuditContexts,
  parseVercelEnvListJson,
  parseRequiredFeatures,
  sanitizeEnvRecords,
  summarizeAudit,
} from './lib/vercel-env-audit.mjs';

const execFileAsync = promisify(execFile);
const token = process.env.VERCEL_TOKEN || process.env.VERCEL_API_TOKEN;
const projectId = process.env.VERCEL_PROJECT_ID;
const teamId = process.env.VERCEL_TEAM_ID;
const contexts = parseAuditContexts(process.env.VERCEL_ENV_AUDIT_CONTEXTS || 'production');
const requiredFeatures = parseRequiredFeatures(
  process.env.VERCEL_ENV_AUDIT_REQUIRED_FEATURES || '',
);
const auditSource = (process.env.VERCEL_ENV_AUDIT_SOURCE || 'auto').trim().toLowerCase();

function printManualFallback(reason) {
  console.error(`[vercel-env-audit] ${reason}`);
  for (const line of manualFallbackLines({
    projectId,
    teamId,
    contexts,
    requiredFeatures: requiredFeatures.join(','),
  })) {
    console.error(line);
  }
}

function buildEnvUrl() {
  const url = new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/env`);
  if (teamId) {
    url.searchParams.set('teamId', teamId);
  }
  return url;
}

async function fetchProjectEnvs() {
  const response = await fetch(buildEnvUrl(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'openraic-vercel-env-audit',
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = body?.error?.message || body?.message || response.statusText;
    throw new Error(`Vercel env listing failed: HTTP ${response.status} ${message}`);
  }

  const body = await response.json();
  return sanitizeEnvRecords(Array.isArray(body.envs) ? body.envs : []);
}

function cliTimeoutMs() {
  const rawValue = Number.parseInt(process.env.VERCEL_ENV_AUDIT_CLI_TIMEOUT_MS || '30000', 10);
  return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 30000;
}

function describeCliFailure(error) {
  if (!error || typeof error !== 'object') {
    return 'command failed';
  }

  const details = [];
  if ('code' in error && error.code !== undefined && error.code !== null) {
    details.push(`exitCode=${String(error.code)}`);
  }
  if ('signal' in error && error.signal) {
    details.push(`signal=${String(error.signal)}`);
  }
  if ('killed' in error && error.killed === true) {
    details.push('timed out or killed');
  }
  return details.length > 0 ? details.join(', ') : 'command failed';
}

async function fetchProjectEnvsFromCli() {
  const { stdout } = await execFileAsync(
    'npx',
    ['-y', 'vercel', 'env', 'ls', '--format', 'json', '--non-interactive'],
    {
      cwd: process.cwd(),
      env: { ...process.env, VERCEL_TELEMETRY_DISABLED: '1' },
      maxBuffer: 1024 * 1024,
      timeout: cliTimeoutMs(),
    },
  );
  return parseVercelEnvListJson(stdout);
}

function printAuditResults(auditResults) {
  for (const result of auditResults) {
    console.log(`[vercel-env-audit] Context: ${result.context}`);
    for (const entry of result.required) {
      const status = entry.present ? 'PASS' : 'MISS';
      console.log(`[vercel-env-audit] ${status} ${entry.key}`);
    }

    if (result.llmProviderReady) {
      console.log(
        `[vercel-env-audit] PASS LLM provider key present (${result.presentLlmProviderKeys.join(
          ', ',
        )})`,
      );
    } else {
      console.log('[vercel-env-audit] MISS LLM provider key present');
    }

    for (const feature of result.requiredFeatureEnvs) {
      console.log(`[vercel-env-audit] Feature: ${feature.label} (${feature.feature})`);
      for (const entry of feature.required) {
        const status = entry.present ? 'PASS' : 'MISS';
        console.log(`[vercel-env-audit] ${status} ${entry.key} (${feature.feature})`);
      }
    }
    for (const feature of result.unknownRequiredFeatures) {
      console.log(`[vercel-env-audit] MISS unknown required feature: ${feature}`);
    }
  }
}

async function main() {
  if (!['auto', 'api', 'cli'].includes(auditSource)) {
    printManualFallback(`Unsupported VERCEL_ENV_AUDIT_SOURCE: ${auditSource}`);
    process.exitCode = 2;
    return;
  }

  if (auditSource === 'api' && !projectId) {
    printManualFallback('VERCEL_PROJECT_ID is required for automatic env auditing.');
    process.exitCode = 2;
    return;
  }

  if (auditSource === 'api' && !token) {
    printManualFallback('VERCEL_TOKEN or VERCEL_API_TOKEN is required for automatic env auditing.');
    process.exitCode = 2;
    return;
  }

  let envRecords;
  let sourceLabel = 'Vercel CLI';
  const shouldUseApi = auditSource !== 'cli' && projectId && token;

  if (shouldUseApi) {
    try {
      envRecords = await fetchProjectEnvs();
      sourceLabel = 'Vercel REST API';
    } catch (error) {
      if (auditSource === 'api') {
        printManualFallback(error instanceof Error ? error.message : String(error));
        process.exitCode = 2;
        return;
      }
      console.error(
        `[vercel-env-audit] Vercel REST API audit unavailable; trying CLI fallback: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (!envRecords) {
    try {
      envRecords = await fetchProjectEnvsFromCli();
    } catch (error) {
      const reason = `Vercel CLI env listing failed: ${describeCliFailure(error)}`;
      printManualFallback(reason);
      process.exitCode = 2;
      return;
    }
  }

  const auditResults = auditEnvRecords({
    envRecords,
    contexts,
    requiredFeatures: requiredFeatures.join(','),
  });
  console.log(`[vercel-env-audit] Source: ${sourceLabel}`);
  printAuditResults(auditResults);

  const summary = summarizeAudit(auditResults);
  if (summary.ok) {
    console.log('[vercel-env-audit] Environment audit passed without exposing secret values.');
    return;
  }

  for (const result of summary.missingContexts) {
    if (result.missingRequiredKeys.length > 0) {
      console.error(
        `[vercel-env-audit] Missing required keys in ${result.context}: ${result.missingRequiredKeys.join(
          ', ',
        )}`,
      );
    }
    if (!result.llmProviderReady) {
      console.error(`[vercel-env-audit] Missing LLM provider key in ${result.context}.`);
    }
    for (const feature of result.requiredFeatureEnvs) {
      if (feature.missingRequiredKeys.length > 0) {
        console.error(
          `[vercel-env-audit] Missing required ${feature.feature} keys in ${
            result.context
          }: ${feature.missingRequiredKeys.join(', ')}`,
        );
      }
    }
    if (result.unknownRequiredFeatures.length > 0) {
      console.error(
        `[vercel-env-audit] Unknown required feature(s): ${result.unknownRequiredFeatures.join(
          ', ',
        )}`,
      );
    }
  }
  process.exitCode = 1;
}

await main();
