#!/usr/bin/env node

import process from 'node:process';
import {
  auditEnvRecords,
  manualFallbackLines,
  parseAuditContexts,
  summarizeAudit,
} from './lib/vercel-env-audit.mjs';

const token = process.env.VERCEL_TOKEN || process.env.VERCEL_API_TOKEN;
const projectId = process.env.VERCEL_PROJECT_ID;
const teamId = process.env.VERCEL_TEAM_ID;
const contexts = parseAuditContexts(process.env.VERCEL_ENV_AUDIT_CONTEXTS || 'production');

function printManualFallback(reason) {
  console.error(`[vercel-env-audit] ${reason}`);
  for (const line of manualFallbackLines({ projectId, teamId, contexts })) {
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
  return Array.isArray(body.envs) ? body.envs : [];
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
  }
}

async function main() {
  if (!projectId) {
    printManualFallback('VERCEL_PROJECT_ID is required for automatic env auditing.');
    process.exitCode = 2;
    return;
  }

  if (!token) {
    printManualFallback('VERCEL_TOKEN or VERCEL_API_TOKEN is required for automatic env auditing.');
    process.exitCode = 2;
    return;
  }

  let envRecords;
  try {
    envRecords = await fetchProjectEnvs();
  } catch (error) {
    printManualFallback(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  const auditResults = auditEnvRecords({ envRecords, contexts });
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
  }
  process.exitCode = 1;
}

await main();
