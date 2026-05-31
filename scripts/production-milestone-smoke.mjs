#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import process from 'node:process';
import {
  evaluateOptionalProviderFeature,
  findUnconfiguredLlmProbe,
  getFirstEnabledSecretProvider,
  isFriendlyProviderError,
  isRequiredFeature,
  parseRequiredFeatures,
} from './lib/production-smoke-readiness.mjs';

const DEFAULT_BASE_URL = 'https://open-raic.com';
const DEFAULT_MISSING_CLASSROOM_ID = 'missing-milestone-smoke-404';

const baseUrl = normalizeBaseUrl(process.env.RAIC_PRODUCTION_BASE_URL || DEFAULT_BASE_URL);
const missingClassroomId =
  process.env.RAIC_SMOKE_MISSING_CLASSROOM_ID || DEFAULT_MISSING_CLASSROOM_ID;
const allowBlockers = process.argv.includes('--allow-blockers');
const evidencePath = (process.env.RAIC_PRODUCTION_SMOKE_EVIDENCE_PATH || '').trim();
const runStartedAt = new Date().toISOString();

const results = [];

function normalizeBaseUrl(rawValue) {
  const parsed = new URL(rawValue);
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
}

function record(status, label, detail) {
  results.push({ status, label, detail });
  const prefix = status.toUpperCase().padEnd(7);
  console.log(`[production-smoke] ${prefix} ${label}${detail ? ` - ${detail}` : ''}`);
}

function pass(label, detail) {
  record('pass', label, detail);
}

function fail(label, detail) {
  record('fail', label, detail);
}

function block(label, detail) {
  record('block', label, detail);
}

function skip(label, detail) {
  record('skip', label, detail);
}

function recordFeatureEvaluation(label, evaluation) {
  if (evaluation.status === 'pass') {
    pass(label, evaluation.detail);
  } else if (evaluation.status === 'block') {
    block(label, evaluation.detail);
  } else {
    skip(label, evaluation.detail);
  }
}

function buildSummary() {
  const failures = results.filter((result) => result.status === 'fail');
  const blockers = results.filter((result) => result.status === 'block');
  const skipped = results.filter((result) => result.status === 'skip');

  return {
    passed: results.length - failures.length - blockers.length - skipped.length,
    failed: failures.length,
    blocked: blockers.length,
    skipped: skipped.length,
  };
}

function resolveExitCode(summary) {
  if (summary.failed > 0) {
    return 1;
  }

  if (summary.blocked > 0 && !allowBlockers) {
    return 2;
  }

  return 0;
}

async function writeEvidenceArtifact(summary, exitCode) {
  if (!evidencePath) {
    return;
  }

  const payload = {
    script: 'production-milestone-smoke',
    generatedAt: new Date().toISOString(),
    startedAt: runStartedAt,
    baseUrl,
    allowBlockers,
    preconditions: {
      requiredProductionFeatures: [
        ...parseRequiredFeatures(process.env.RAIC_REQUIRED_PRODUCTION_FEATURES),
      ],
      requiredDiscord: isRequiredFeature('discord'),
      requiredMiroFish: isRequiredFeature('mirofish'),
      missingClassroomId,
    },
    summary,
    results,
    exitCode,
    redaction: {
      policy:
        'production smoke evidence records only feature names, readiness status, and response diagnostics; provider secrets and credentials are never serialized',
    },
  };

  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[production-smoke] Evidence JSON: ${evidencePath}`);
}

async function fetchJson(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  let body = null;

  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  return { response, body };
}

async function checkHealth() {
  const { response, body } = await fetchJson('/api/health');
  if (response.status !== 200 || body?.success !== true) {
    fail('/api/health', `expected HTTP 200 success:true, got HTTP ${response.status}`);
    return;
  }

  const readiness = body.readiness || {};
  const authReady = readiness.auth?.ready === true;
  const encryptionReady = readiness.encryption?.ready === true;
  const storageReady = readiness.storage?.ready === true;
  const postgresMode = readiness.storage?.mode === 'postgres';

  if (authReady && encryptionReady && storageReady && postgresMode) {
    pass('/api/health core readiness', 'auth, encryption, and Postgres storage are ready');
  } else {
    fail(
      '/api/health core readiness',
      `auth=${authReady} encryption=${encryptionReady} storage=${storageReady} mode=${
        readiness.storage?.mode || 'unknown'
      }`,
    );
  }

  if (readiness.mirofish?.ready === true) {
    pass('MiroFish readiness', 'production MiroFish env is configured');
  } else if (isRequiredFeature('mirofish')) {
    block('MiroFish readiness', readiness.mirofish?.reason || 'MiroFish is not ready');
  } else {
    skip('MiroFish readiness', 'MiroFish is not required for this release');
  }

  if (readiness.discord?.ready === true) {
    pass('Discord readiness', 'production Discord scheduled-class env is configured');
  } else if (isRequiredFeature('discord')) {
    block('Discord readiness', readiness.discord?.reason || 'Discord beta is not ready');
  } else {
    skip('Discord readiness', 'Discord beta is not required for this release');
  }
}

async function checkProviderReadiness() {
  const { response: serverProvidersResponse, body: serverProviders } =
    await fetchJson('/api/server-providers');
  if (serverProvidersResponse.status !== 200 || serverProviders?.success !== true) {
    fail(
      '/api/server-providers',
      `expected HTTP 200 success:true, got HTTP ${serverProvidersResponse.status}`,
    );
  } else {
    pass('/api/server-providers', 'endpoint responds');
  }

  const { response, body } = await fetchJson('/api/ai/options');
  if (response.status !== 200 || body?.success !== true) {
    fail('/api/ai/options', `expected HTTP 200 success:true, got HTTP ${response.status}`);
    return;
  }

  const providers = body.providers || {};
  const enabledLlm = getFirstEnabledSecretProvider(providers, 'llm');
  if (enabledLlm) {
    pass('LLM provider readiness', `${enabledLlm.providerId} is enabled with a server secret`);
  } else {
    block(
      'LLM provider readiness',
      'no server-backed LLM provider is enabled with a secret; authenticated classroom generation cannot complete',
    );
    return providers;
  }

  if (enabledLlm.allowedModels.length > 0) {
    pass(
      'LLM model registry',
      `${enabledLlm.providerId} exposes ${enabledLlm.allowedModels.length} allowed model(s)`,
    );
  } else {
    fail('LLM model registry', `${enabledLlm.providerId} is enabled but exposes no models`);
  }

  recordFeatureEvaluation(
    'TTS provider readiness',
    evaluateOptionalProviderFeature({
      groups: providers,
      groupName: 'tts',
      featureName: 'tts',
    }),
  );
  recordFeatureEvaluation(
    'Image provider readiness',
    evaluateOptionalProviderFeature({
      groups: providers,
      groupName: 'image',
      featureName: 'image',
    }),
  );
  recordFeatureEvaluation(
    'Video provider readiness',
    evaluateOptionalProviderFeature({
      groups: providers,
      groupName: 'video',
      featureName: 'video',
    }),
  );
  recordFeatureEvaluation(
    'Web search provider readiness',
    evaluateOptionalProviderFeature({
      groups: providers,
      groupName: 'webSearch',
      featureName: 'websearch',
    }),
  );

  return providers;
}

async function checkFriendlyProviderErrors(providers) {
  const probe = findUnconfiguredLlmProbe(providers);
  if (!probe) {
    skip(
      '/api/verify-model unconfigured-provider behavior',
      'no unconfigured LLM provider is available to probe',
    );
    return;
  }

  const { response, body } = await fetchJson('/api/verify-model', {
    method: 'POST',
    body: JSON.stringify({
      model: `${probe.providerId}:${probe.modelId}`,
      apiKey: '',
      baseUrl: '',
    }),
  });

  if (isFriendlyProviderError(response.status, body)) {
    pass('/api/verify-model unconfigured-provider behavior', body.error);
  } else {
    fail(
      '/api/verify-model unconfigured-provider behavior',
      `expected HTTP 400 provider error, got HTTP ${response.status} ${body?.errorCode || ''}`,
    );
  }
}

async function checkAuthGuard() {
  const { response, body } = await fetchJson('/api/generate-classroom', {
    method: 'POST',
    body: JSON.stringify({
      requirement: 'Create a tiny classroom lesson about Newton second law.',
      enableWebSearch: false,
      enableImageGeneration: false,
      enableVideoGeneration: false,
      enableTTS: false,
    }),
  });

  if (response.status === 401 && body?.errorCode === 'UNAUTHORIZED') {
    pass('/api/generate-classroom unauthenticated guard', body.error);
  } else {
    fail(
      '/api/generate-classroom unauthenticated guard',
      `expected HTTP 401 UNAUTHORIZED, got HTTP ${response.status} ${body?.errorCode || ''}`,
    );
  }
}

async function checkMissingClassroom404s() {
  const paths = [
    `/api/classroom?id=${encodeURIComponent(missingClassroomId)}`,
    `/api/classroom/${encodeURIComponent(missingClassroomId)}/session-context`,
    `/api/classroom/${encodeURIComponent(missingClassroomId)}/collaboration-state`,
    `/api/classroom/${encodeURIComponent(missingClassroomId)}/presentation-state`,
  ];

  for (const path of paths) {
    const { response, body } = await fetchJson(path);
    if (
      response.status === 404 &&
      body?.success === false &&
      body?.error === 'Classroom not found'
    ) {
      pass(`missing classroom ${path}`, 'clean classroom 404');
    } else {
      fail(
        `missing classroom ${path}`,
        `expected HTTP 404 Classroom not found, got HTTP ${response.status} ${JSON.stringify(body)}`,
      );
    }
  }
}

async function main() {
  console.log(`[production-smoke] Base URL: ${baseUrl}`);
  await checkHealth();
  const providers = await checkProviderReadiness();
  await checkFriendlyProviderErrors(providers);
  await checkAuthGuard();
  await checkMissingClassroom404s();

  const summary = buildSummary();
  const exitCode = resolveExitCode(summary);

  console.log(
    `[production-smoke] Summary: ${summary.passed} passed, ${summary.failed} failed, ${summary.blocked} blocked, ${summary.skipped} skipped`,
  );

  try {
    await writeEvidenceArtifact(summary, exitCode);
  } catch (error) {
    console.error(
      `[production-smoke] Failed to write evidence JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
    return;
  }

  process.exitCode = exitCode;
}

await main();
